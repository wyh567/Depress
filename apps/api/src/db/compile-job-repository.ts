import { createHash, randomUUID } from "node:crypto";
import {
  CompileJobCreateRequestSchema,
  CompileRequestSchema,
  CompileSnapshotSchema,
  CslItemSchema,
  PersistedCompileJobResourceSchema,
  PersistedCompileJobStatusSchema,
  projectPersistedDocumentToAst,
  type CompileJobCreateRequest,
  type CompileSnapshot,
  type PersistedCompileJobResource,
  type PersistedCompileJobStatus,
} from "@depress/ast";
import type { Pool, PoolClient } from "pg";
import {
  DEFAULT_COMPILE_ACTIVE_JOB_LIMIT,
  DEFAULT_COMPILE_SNAPSHOT_MAX_BYTES,
} from "../compile-safety";

export class CompileDocumentNotFoundError extends Error {
  constructor() {
    super("COMPILE_DOCUMENT_NOT_FOUND");
    this.name = "CompileDocumentNotFoundError";
  }
}

export class CompileRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super("COMPILE_REVISION_CONFLICT");
    this.name = "CompileRevisionConflictError";
  }
}

export class CompileProjectionError extends Error {
  constructor() {
    super("COMPILE_PROJECTION_INVALID");
    this.name = "CompileProjectionError";
  }
}

export class CompileJobLimitError extends Error {
  constructor() {
    super("COMPILE_JOB_LIMIT");
    this.name = "CompileJobLimitError";
  }
}

export class CompileInputTooLargeError extends Error {
  constructor() {
    super("COMPILE_INPUT_TOO_LARGE");
    this.name = "CompileInputTooLargeError";
  }
}

interface ProjectRow {
  id: string;
}

interface DocumentRow {
  id: string;
  project_id: string;
  envelope_json: unknown;
  revision: number;
}

interface ReferenceRow {
  item_json: unknown;
}

interface CompileJobRow {
  id: string;
  document_id: string;
  requested_revision: number;
  template_id: string;
  format: string;
  snapshot_hash: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface CompileJobArtifactRow {
  status: string;
  artifact_key: string | null;
}

export interface CompileJobArtifactState {
  status: PersistedCompileJobStatus;
  artifactKey: string | null;
}

export interface CreatedCompileJob {
  resource: PersistedCompileJobResource;
  snapshot: CompileSnapshot;
}

export interface CompileJobRepositoryOptions {
  createId?: () => string;
  beforeOutboxInsert?: (client: PoolClient) => void | Promise<void>;
  activeJobLimit?: number;
  snapshotMaxBytes?: number;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new CompileProjectionError();
}

export function hashCompileSnapshot(
  snapshot: unknown,
  maxBytes = DEFAULT_COMPILE_SNAPSHOT_MAX_BYTES,
): {
  snapshot: CompileSnapshot;
  canonical: string;
  hash: string;
} {
  const parsed = CompileSnapshotSchema.parse(snapshot);
  const canonical = canonicalJson(parsed);
  if (Buffer.byteLength(canonical, "utf8") > maxBytes) {
    throw new CompileInputTooLargeError();
  }
  return {
    snapshot: parsed,
    canonical,
    hash: createHash("sha256").update(canonical).digest("hex"),
  };
}

function toResource(row: CompileJobRow): PersistedCompileJobResource {
  return PersistedCompileJobResourceSchema.parse({
    jobId: row.id,
    documentId: row.document_id,
    revision: row.requested_revision,
    templateId: row.template_id,
    format: row.format,
    snapshotHash: row.snapshot_hash,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

const OWNER_SESSION_GATE_SQL =
  "SELECT pg_advisory_lock(hashtextextended($1, 0))";
const OWNER_TRANSACTION_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))";
const OWNER_SESSION_GATE_UNLOCK_SQL =
  "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked";

type SessionGateState =
  | "not-attempted"
  | "acquisition-unconfirmed"
  | "held"
  | "release-unconfirmed"
  | "released";

async function releaseOwnerSessionGate(
  client: PoolClient,
  ownerLockKey: string,
): Promise<void> {
  const result = await client.query<{ unlocked: boolean }>(
    OWNER_SESSION_GATE_UNLOCK_SQL,
    [ownerLockKey],
  );
  if (result.rows[0]?.unlocked !== true) {
    throw new Error("Compile owner session gate release was not confirmed");
  }
}

export function createCompileJobRepository(
  pool: Pool,
  options: CompileJobRepositoryOptions = {},
) {
  const createId = options.createId ?? randomUUID;
  const activeJobLimit =
    options.activeJobLimit ?? DEFAULT_COMPILE_ACTIVE_JOB_LIMIT;
  const snapshotMaxBytes =
    options.snapshotMaxBytes ?? DEFAULT_COMPILE_SNAPSHOT_MAX_BYTES;

  return {
    async createForOwner(input: {
      ownerUserId: string;
      request: CompileJobCreateRequest;
    }): Promise<CreatedCompileJob> {
      const request = CompileJobCreateRequestSchema.parse(input.request);
      const client = await pool.connect();
      const ownerLockKey = `compile-active-job:${input.ownerUserId}`;
      let sessionGateState: SessionGateState = "not-attempted";
      let transactionMayBeOpen = false;
      let discardClient = false;
      try {
        sessionGateState = "acquisition-unconfirmed";
        await client.query(OWNER_SESSION_GATE_SQL, [ownerLockKey]);
        sessionGateState = "held";

        transactionMayBeOpen = true;
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");

        // This must remain the first query after BEGIN. The pre-transaction
        // session gate ensures a waiter starts its fixed snapshot only after
        // the preceding same-owner transaction commits.
        await client.query(OWNER_TRANSACTION_LOCK_SQL, [ownerLockKey]);
        sessionGateState = "release-unconfirmed";
        await releaseOwnerSessionGate(client, ownerLockKey);
        sessionGateState = "released";

        const projectResult = await client.query<ProjectRow>(
          `
            SELECT id
            FROM projects
            WHERE owner_user_id = $1 AND is_default = true
          `,
          [input.ownerUserId],
        );
        const project = projectResult.rows[0];
        if (!project) throw new CompileDocumentNotFoundError();

        const documentResult = await client.query<DocumentRow>(
          `
            SELECT id, project_id, envelope_json, revision
            FROM documents
            WHERE id = $1 AND project_id = $2
            FOR SHARE
          `,
          [request.documentId, project.id],
        );
        const document = documentResult.rows[0];
        if (!document) throw new CompileDocumentNotFoundError();
        if (document.revision !== request.revision) {
          throw new CompileRevisionConflictError(document.revision);
        }

        const referenceResult = await client.query<ReferenceRow>(
          `
            SELECT item_json
            FROM project_references
            WHERE project_id = $1
            ORDER BY cite_key
          `,
          [project.id],
        );

        let snapshot: CompileSnapshot;
        try {
          const ast = projectPersistedDocumentToAst(document.envelope_json);
          const references = referenceResult.rows.map((row) =>
            CslItemSchema.parse(row.item_json),
          );
          const compileRequest = CompileRequestSchema.parse({
            ast,
            references,
            templateId: request.templateId,
            format: request.format,
          });
          snapshot = CompileSnapshotSchema.parse({
            schemaVersion: 1,
            documentId: document.id,
            revision: document.revision,
            projectId: document.project_id,
            compileRequest,
          });
        } catch {
          throw new CompileProjectionError();
        }

        const hashed = hashCompileSnapshot(snapshot, snapshotMaxBytes);
        const activeResult = await client.query<{ count: string }>(
          `
            SELECT count(*)::text AS count
            FROM compile_jobs AS jobs
            JOIN projects ON projects.id = jobs.project_id
            WHERE projects.owner_user_id = $1
              AND jobs.status IN ('accepted', 'queued', 'processing')
          `,
          [input.ownerUserId],
        );
        if (Number(activeResult.rows[0]!.count) >= activeJobLimit) {
          throw new CompileJobLimitError();
        }
        const jobId = createId();
        const outboxId = createId();
        const inserted = await client.query<CompileJobRow>(
          `
            INSERT INTO compile_jobs (
              id, project_id, document_id, requested_revision,
              template_id, format, input_snapshot, snapshot_hash, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'accepted')
            RETURNING
              id, document_id, requested_revision, template_id, format,
              snapshot_hash, status, created_at, updated_at
          `,
          [
            jobId,
            project.id,
            document.id,
            document.revision,
            request.templateId,
            request.format,
            hashed.canonical,
            hashed.hash,
          ],
        );
        await options.beforeOutboxInsert?.(client);
        await client.query(
          `
            INSERT INTO compile_outbox (id, job_id, snapshot_hash)
            VALUES ($1, $2, $3)
          `,
          [outboxId, jobId, hashed.hash],
        );
        await client.query("COMMIT");
        transactionMayBeOpen = false;
        return {
          resource: toResource(inserted.rows[0]!),
          snapshot: hashed.snapshot,
        };
      } catch (error) {
        if (transactionMayBeOpen) {
          try {
            await client.query("ROLLBACK");
            transactionMayBeOpen = false;
          } catch {
            discardClient = true;
          }
        }

        if (sessionGateState === "held" && !discardClient) {
          sessionGateState = "release-unconfirmed";
          try {
            await releaseOwnerSessionGate(client, ownerLockKey);
            sessionGateState = "released";
          } catch {
            discardClient = true;
          }
        } else if (
          sessionGateState === "acquisition-unconfirmed" ||
          sessionGateState === "release-unconfirmed"
        ) {
          discardClient = true;
        }

        throw error;
      } finally {
        if (discardClient) {
          client.release(true);
        } else {
          client.release();
        }
      }
    },

    async getForOwner(
      ownerUserId: string,
      jobId: string,
    ): Promise<PersistedCompileJobResource | undefined> {
      const result = await pool.query<CompileJobRow>(
        `
          SELECT
            jobs.id, jobs.document_id, jobs.requested_revision,
            jobs.template_id, jobs.format, jobs.snapshot_hash,
            jobs.status, jobs.created_at, jobs.updated_at
          FROM compile_jobs AS jobs
          JOIN projects ON projects.id = jobs.project_id
          WHERE jobs.id = $1 AND projects.owner_user_id = $2
        `,
        [jobId, ownerUserId],
      );
      const row = result.rows[0];
      return row ? toResource(row) : undefined;
    },

    async getArtifactForOwner(
      ownerUserId: string,
      jobId: string,
    ): Promise<CompileJobArtifactState | undefined> {
      const result = await pool.query<CompileJobArtifactRow>(
        `
          SELECT jobs.status, jobs.artifact_key
          FROM compile_jobs AS jobs
          JOIN projects ON projects.id = jobs.project_id
          WHERE jobs.id = $1 AND projects.owner_user_id = $2
        `,
        [jobId, ownerUserId],
      );
      const row = result.rows[0];
      return row
        ? {
            status: PersistedCompileJobStatusSchema.parse(row.status),
            artifactKey: row.artifact_key,
          }
        : undefined;
    },
  };
}

export type CompileJobRepository = ReturnType<
  typeof createCompileJobRepository
>;
