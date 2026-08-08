import { CslItemSchema, type CslItem } from "@depress/ast";
import type { Pool } from "pg";

export interface ProjectReferenceRecord {
  projectId: string;
  citeKey: string;
  item: CslItem;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateReferenceResult =
  | { status: "created"; reference: ProjectReferenceRecord }
  | { status: "duplicate" };

interface ReferenceRow {
  project_id: string;
  cite_key: string;
  item_json: unknown;
  created_at: Date;
  updated_at: Date;
}

function parseReference(row: ReferenceRow): ProjectReferenceRecord {
  const item = CslItemSchema.parse(row.item_json);
  if (item.id !== row.cite_key) {
    throw new Error("REFERENCE_IDENTITY_CHECK_FAILED");
  }
  return {
    projectId: row.project_id,
    citeKey: row.cite_key,
    item,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createReferenceRepository(pool: Pool) {
  return {
    async create(input: {
      projectId: string;
      item: unknown;
    }): Promise<CreateReferenceResult> {
      const item = CslItemSchema.parse(input.item);
      const result = await pool.query<ReferenceRow>(
        `
          INSERT INTO project_references (
            project_id, cite_key, item_json
          )
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (project_id, cite_key) DO NOTHING
          RETURNING
            project_id, cite_key, item_json, created_at, updated_at
        `,
        [input.projectId, item.id, JSON.stringify(item)]
      );
      const created = result.rows[0];
      return created
        ? { status: "created", reference: parseReference(created) }
        : { status: "duplicate" };
    },

    async upsert(input: { projectId: string; item: unknown }): Promise<ProjectReferenceRecord> {
      const item = CslItemSchema.parse(input.item);
      const result = await pool.query<ReferenceRow>(
        `
          INSERT INTO project_references (
            project_id, cite_key, item_json
          )
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (project_id, cite_key)
          DO UPDATE SET
            item_json = EXCLUDED.item_json,
            updated_at = now()
          RETURNING
            project_id, cite_key, item_json, created_at, updated_at
        `,
        [input.projectId, item.id, JSON.stringify(item)]
      );
      return parseReference(result.rows[0]!);
    },

    async list(projectId: string): Promise<ProjectReferenceRecord[]> {
      const result = await pool.query<ReferenceRow>(
        `
          SELECT project_id, cite_key, item_json, created_at, updated_at
          FROM project_references
          WHERE project_id = $1
          ORDER BY cite_key
        `,
        [projectId]
      );
      return result.rows.map(parseReference);
    },

    async update(input: {
      projectId: string;
      citeKey: string;
      item: unknown;
    }): Promise<ProjectReferenceRecord | undefined> {
      const item = CslItemSchema.parse(input.item);
      if (item.id !== input.citeKey) {
        throw new Error("REFERENCE_IDENTITY_MISMATCH");
      }
      const result = await pool.query<ReferenceRow>(
        `
          UPDATE project_references
          SET item_json = $1::jsonb, updated_at = now()
          WHERE project_id = $2 AND cite_key = $3
          RETURNING
            project_id, cite_key, item_json, created_at, updated_at
        `,
        [JSON.stringify(item), input.projectId, input.citeKey]
      );
      const updated = result.rows[0];
      return updated ? parseReference(updated) : undefined;
    },

    async remove(projectId: string, citeKey: string): Promise<boolean> {
      const result = await pool.query(
        `
          DELETE FROM project_references
          WHERE project_id = $1 AND cite_key = $2
        `,
        [projectId, citeKey]
      );
      return result.rowCount === 1;
    },
  };
}

export type ReferenceRepository = ReturnType<typeof createReferenceRepository>;
