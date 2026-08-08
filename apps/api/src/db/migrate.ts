import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const DEFAULT_MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const MIGRATION_FILE = /^\d+_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK_ID = 1_104_202_604;

export interface MigrationResult {
  applied: string[];
}

export async function runMigrations(
  pool: Pool,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY
): Promise<MigrationResult> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => MIGRATION_FILE.test(file))
    .sort();
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const existing = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations WHERE name = $1",
        [file]
      );
      if (existing.rowCount === 1) continue;

      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      applied.push(file);
    }

    await client.query("COMMIT");
    return { applied };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
