import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface ProjectRecord {
  id: string;
  ownerUserId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectRow {
  id: string;
  owner_user_id: string;
  name: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

function parseProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireUserId(ownerUserId: string): string {
  const value = ownerUserId.trim();
  if (!value) throw new Error("OWNER_USER_ID_REQUIRED");
  return value;
}

export function createProjectRepository(pool: Pool) {
  return {
    async getOrCreateDefaultProject(ownerUserId: string): Promise<ProjectRecord> {
      const userId = requireUserId(ownerUserId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `
            INSERT INTO projects (id, owner_user_id, name, is_default)
            VALUES ($1, $2, 'Default Project', true)
            ON CONFLICT (owner_user_id) WHERE is_default
            DO NOTHING
          `,
          [randomUUID(), userId]
        );
        const result = await client.query<ProjectRow>(
          `
            SELECT id, owner_user_id, name, is_default, created_at, updated_at
            FROM projects
            WHERE owner_user_id = $1 AND is_default
          `,
          [userId]
        );
        if (result.rows.length !== 1) {
          throw new Error("DEFAULT_PROJECT_INVARIANT_FAILED");
        }
        await client.query("COMMIT");
        return parseProject(result.rows[0]!);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;
