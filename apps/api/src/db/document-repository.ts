import { randomUUID } from "node:crypto";
import type { PersistedDocumentEnvelope } from "@depress/ast";
import type { Pool } from "pg";
import { parseAndHashDocumentEnvelope } from "./content-hash";

export interface DocumentRecord {
  id: string;
  projectId: string;
  envelope: PersistedDocumentEnvelope;
  revision: number;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

interface DocumentRow {
  id: string;
  project_id: string;
  envelope_json: unknown;
  revision: number;
  content_hash: string;
  created_at: Date;
  updated_at: Date;
}

export type SaveDocumentResult =
  | { status: "saved"; document: DocumentRecord }
  | { status: "conflict"; currentRevision: number }
  | { status: "not_found" };

function parseDocument(row: DocumentRow): DocumentRecord {
  const parsed = parseAndHashDocumentEnvelope(row.envelope_json);
  if (parsed.contentHash !== row.content_hash) {
    throw new Error("DOCUMENT_INTEGRITY_CHECK_FAILED");
  }
  return {
    id: row.id,
    projectId: row.project_id,
    envelope: parsed.envelope,
    revision: row.revision,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DOCUMENT_COLUMNS = `
  id,
  project_id,
  envelope_json,
  revision::integer AS revision,
  content_hash,
  created_at,
  updated_at
`;

export function createDocumentRepository(pool: Pool) {
  return {
    async create(input: { projectId: string; envelope: unknown }): Promise<DocumentRecord> {
      const parsed = parseAndHashDocumentEnvelope(input.envelope);
      const result = await pool.query<DocumentRow>(
        `
          INSERT INTO documents (
            id, project_id, envelope_json, revision, content_hash
          )
          VALUES ($1, $2, $3::jsonb, 1, $4)
          RETURNING ${DOCUMENT_COLUMNS}
        `,
        [randomUUID(), input.projectId, JSON.stringify(parsed.envelope), parsed.contentHash]
      );
      return parseDocument(result.rows[0]!);
    },

    async list(projectId: string): Promise<DocumentRecord[]> {
      const result = await pool.query<DocumentRow>(
        `
          SELECT ${DOCUMENT_COLUMNS}
          FROM documents
          WHERE project_id = $1
          ORDER BY updated_at DESC, id
        `,
        [projectId]
      );
      return result.rows.map(parseDocument);
    },

    async get(input: {
      projectId: string;
      documentId: string;
    }): Promise<DocumentRecord | undefined> {
      const result = await pool.query<DocumentRow>(
        `
          SELECT ${DOCUMENT_COLUMNS}
          FROM documents
          WHERE id = $1 AND project_id = $2
        `,
        [input.documentId, input.projectId]
      );
      const row = result.rows[0];
      return row ? parseDocument(row) : undefined;
    },

    async save(input: {
      projectId: string;
      documentId: string;
      expectedRevision: number;
      envelope: unknown;
    }): Promise<SaveDocumentResult> {
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision <= 0) {
        throw new Error("EXPECTED_REVISION_INVALID");
      }
      const parsed = parseAndHashDocumentEnvelope(input.envelope);
      const result = await pool.query<DocumentRow>(
        `
          UPDATE documents
          SET
            envelope_json = $1::jsonb,
            content_hash = $2,
            revision = revision + 1,
            updated_at = now()
          WHERE id = $3
            AND project_id = $4
            AND revision = $5
          RETURNING ${DOCUMENT_COLUMNS}
        `,
        [
          JSON.stringify(parsed.envelope),
          parsed.contentHash,
          input.documentId,
          input.projectId,
          input.expectedRevision,
        ]
      );
      const saved = result.rows[0];
      if (saved) return { status: "saved", document: parseDocument(saved) };

      const current = await pool.query<{ revision: number }>(
        `
          SELECT revision::integer AS revision
          FROM documents
          WHERE id = $1 AND project_id = $2
        `,
        [input.documentId, input.projectId]
      );
      const existing = current.rows[0];
      return existing
        ? { status: "conflict", currentRevision: existing.revision }
        : { status: "not_found" };
    },
  };
}

export type DocumentRepository = ReturnType<typeof createDocumentRepository>;
