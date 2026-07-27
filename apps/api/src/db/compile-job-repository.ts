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

export function hashCompileSnapshot(snapshot: unknown): {
  snapshot: CompileSnapshot;
  canonical: string;
  hash: string;
} {
  const parsed = CompileSnapshotSchema.parse(snapshot);
  const canonical = canonicalJson(parsed);
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

export function createCompileJobRepository(
  pool: Pool,
  options: CompileJobRepositoryOptions = {},
) {
  const createId = options.createId ?? randomUUID;

  return {
    async createForOwner(input: {
      ownerUserId: string;
      request: CompileJobCreateRequest;
    }): Promise<CreatedCompileJob> {
      const request = CompileJobCreateRequestSchema.parse(input.request);
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
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

        const hashed = hashCompileSnapshot(snapshot);
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
        return {
          resource: toResource(inserted.rows[0]!),
          snapshot: hashed.snapshot,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
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
