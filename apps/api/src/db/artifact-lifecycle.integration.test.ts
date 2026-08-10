import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";

const databaseUrl = process.env["DEPRESS_POSTGRES_TEST_URL"];
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);
const MIGRATIONS = [
  "0001_mentor_mvp_foundation.sql",
  "0002_better_auth.sql",
  "0003_project_owner_fk.sql",
  "0004_compile_jobs_outbox.sql",
  "0005_compile_job_processing_ownership.sql",
  "0006_artifact_lifecycle.sql",
] as const;
const OWNER_ID = "artifact-lifecycle-owner";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const SUCCEEDED_ID = "33333333-3333-4333-8333-333333333331";
const ACCEPTED_ID = "33333333-3333-4333-8333-333333333332";
const QUEUED_ID = "33333333-3333-4333-8333-333333333333";
const PROCESSING_ID = "33333333-3333-4333-8333-333333333334";
const FAILED_ID = "33333333-3333-4333-8333-333333333335";
const SNAPSHOT_HASH = "a".repeat(64);
const HISTORICAL_UPDATED_AT = new Date("2026-01-15T12:34:56.000Z");

describeDatabase("artifact lifecycle migration", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
  });

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedFoundation() {
    await pool.query(
      `INSERT INTO "user" (
         id, name, email, "emailVerified", "createdAt", "updatedAt"
       ) VALUES ($1, 'Lifecycle Owner', 'lifecycle@example.test', true, now(), now())`,
      [OWNER_ID],
    );
    await pool.query(
      `INSERT INTO projects (id, owner_user_id, name, is_default)
       VALUES ($1, $2, 'Lifecycle Project', true)`,
      [PROJECT_ID, OWNER_ID],
    );
    await pool.query(
      `INSERT INTO documents (
         id, project_id, envelope_json, revision, content_hash
       ) VALUES ($1, $2, '{"schemaVersion":1}'::jsonb, 1, $3)`,
      [DOCUMENT_ID, PROJECT_ID, SNAPSHOT_HASH],
    );
  }

  async function seedPreLifecycleRows() {
    await seedFoundation();
    await pool.query(
      `INSERT INTO compile_jobs (
         id, project_id, document_id, requested_revision, template_id, format,
         input_snapshot, snapshot_hash, status, error_code, artifact_key,
         processing_token, processing_started_at, artifact_byte_length,
         updated_at
       ) VALUES
         ($1, $6, $7, 1, 'ieee', 'pdf', '{}'::jsonb, $8, 'succeeded', NULL,
          'artifacts/historical.pdf', NULL, NULL, 321, $9),
         ($2, $6, $7, 1, 'ieee', 'pdf', '{}'::jsonb, $8, 'accepted', NULL,
          NULL, NULL, NULL, NULL, now()),
         ($3, $6, $7, 1, 'ieee', 'pdf', '{}'::jsonb, $8, 'queued', NULL,
          NULL, NULL, NULL, NULL, now()),
         ($4, $6, $7, 1, 'ieee', 'pdf', '{}'::jsonb, $8, 'processing', NULL,
          NULL, '44444444-4444-4444-8444-444444444444', now(), NULL, now()),
         ($5, $6, $7, 1, 'ieee', 'pdf', '{}'::jsonb, $8, 'failed',
          'COMPILE_FAILED', NULL, NULL, NULL, NULL, now())`,
      [
        SUCCEEDED_ID,
        ACCEPTED_ID,
        QUEUED_ID,
        PROCESSING_ID,
        FAILED_ID,
        PROJECT_ID,
        DOCUMENT_ID,
        SNAPSHOT_HASH,
        HISTORICAL_UPDATED_AT,
      ],
    );
  }

  async function expectCheckViolation(
    sql: string,
    parameters: readonly unknown[] = [],
  ) {
    await expect(pool.query(sql, [...parameters])).rejects.toMatchObject({
      code: "23514",
    });
  }

  it("upgrades 0001-0005 data using each succeeded row's historical updated_at", async () => {
    const stagedDirectory = await mkdtemp(
      join(tmpdir(), "depress-t04c1-migrations-"),
    );
    try {
      for (const name of MIGRATIONS.slice(0, 5)) {
        await copyFile(join(migrationsDirectory, name), join(stagedDirectory, name));
      }
      expect((await runMigrations(pool, stagedDirectory)).applied).toEqual(
        MIGRATIONS.slice(0, 5),
      );
      await seedPreLifecycleRows();
      await copyFile(
        join(migrationsDirectory, MIGRATIONS[5]),
        join(stagedDirectory, MIGRATIONS[5]),
      );
      expect((await runMigrations(pool, stagedDirectory)).applied).toEqual([
        MIGRATIONS[5],
      ]);
      expect((await runMigrations(pool, stagedDirectory)).applied).toEqual([]);

      const rows = await pool.query<{
        id: string;
        status: string;
        expires_at: Date | null;
        artifact_cleanup_token: string | null;
        artifact_cleanup_started_at: Date | null;
        artifact_deleted_at: Date | null;
        artifact_key: string | null;
        artifact_byte_length: number | null;
      }>(
        `SELECT id, status, expires_at, artifact_cleanup_token,
                artifact_cleanup_started_at, artifact_deleted_at,
                artifact_key, artifact_byte_length
         FROM compile_jobs
         ORDER BY id`,
      );
      const succeeded = rows.rows.find((row) => row.id === SUCCEEDED_ID)!;
      expect(succeeded.expires_at?.toISOString()).toBe(
        "2026-01-22T12:34:56.000Z",
      );
      expect(succeeded).toMatchObject({
        artifact_cleanup_token: null,
        artifact_cleanup_started_at: null,
        artifact_deleted_at: null,
        artifact_key: "artifacts/historical.pdf",
        artifact_byte_length: 321,
      });
      expect(
        rows.rows
          .filter((row) => row.status !== "succeeded")
          .every(
            (row) =>
              row.expires_at === null &&
              row.artifact_cleanup_token === null &&
              row.artifact_cleanup_started_at === null &&
              row.artifact_deleted_at === null,
          ),
      ).toBe(true);
    } finally {
      await rm(stagedDirectory, { recursive: true, force: true });
    }
  });

  it("applies all six migrations on a fresh database with lifecycle schema", async () => {
    expect((await runMigrations(pool)).applied).toEqual([...MIGRATIONS]);
    expect((await runMigrations(pool)).applied).toEqual([]);

    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`,
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      "account",
      "compile_jobs",
      "compile_outbox",
      "documents",
      "project_references",
      "projects",
      "schema_migrations",
      "session",
      "user",
      "verification",
    ]);

    const columns = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'compile_jobs'
         AND column_name IN (
           'expires_at', 'artifact_cleanup_token',
           'artifact_cleanup_started_at', 'artifact_deleted_at'
         )
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      {
        column_name: "artifact_cleanup_started_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      },
      {
        column_name: "artifact_cleanup_token",
        data_type: "uuid",
        is_nullable: "YES",
      },
      {
        column_name: "artifact_deleted_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      },
      {
        column_name: "expires_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      },
    ]);

    const constraints = await pool.query<{ conname: string }>(
      `SELECT conname
       FROM pg_constraint
       WHERE conrelid = 'compile_jobs'::regclass
       ORDER BY conname`,
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
        "compile_jobs_artifact_cleanup_claim_check",
        "compile_jobs_artifact_deleted_check",
        "compile_jobs_artifact_expiry_check",
        "compile_jobs_artifact_cleanup_pair_check",
        "compile_jobs_succeeded_artifact_check",
      ]),
    );
    const index = await pool.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'compile_jobs_artifact_cleanup_candidates_idx'`,
    );
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]!.indexdef).toContain("expires_at");
    expect(index.rows[0]!.indexdef).toContain("artifact_cleanup_started_at");
    expect(index.rows[0]!.indexdef).toContain("status = 'succeeded'");
    expect(index.rows[0]!.indexdef).toContain("artifact_deleted_at IS NULL");
  });

  it("rejects invalid lifecycle states while retaining valid states", async () => {
    await runMigrations(pool);
    await seedFoundation();
    await pool.query(
      `INSERT INTO compile_jobs (
         id, project_id, document_id, requested_revision, template_id, format,
         input_snapshot, snapshot_hash, status
       ) VALUES ($1, $2, $3, 1, 'ieee', 'pdf', '{}'::jsonb, $4, 'accepted')`,
      [ACCEPTED_ID, PROJECT_ID, DOCUMENT_ID, SNAPSHOT_HASH],
    );
    await pool.query(
      `INSERT INTO compile_jobs (
         id, project_id, document_id, requested_revision, template_id, format,
         input_snapshot, snapshot_hash, status, artifact_key,
         artifact_byte_length, expires_at
       ) VALUES (
         $1, $2, $3, 1, 'ieee', 'pdf', '{}'::jsonb, $4, 'succeeded',
         'artifacts/valid.pdf', 100, now() + interval '7 days'
       )`,
      [SUCCEEDED_ID, PROJECT_ID, DOCUMENT_ID, SNAPSHOT_HASH],
    );

    await expectCheckViolation(
      "UPDATE compile_jobs SET expires_at = NULL WHERE id = $1",
      [SUCCEEDED_ID],
    );
    await expectCheckViolation(
      "UPDATE compile_jobs SET expires_at = now() WHERE id = $1",
      [ACCEPTED_ID],
    );
    await expectCheckViolation(
      "UPDATE compile_jobs SET artifact_cleanup_token = $2 WHERE id = $1",
      [SUCCEEDED_ID, "55555555-5555-4555-8555-555555555555"],
    );
    await expectCheckViolation(
      "UPDATE compile_jobs SET artifact_cleanup_started_at = now() WHERE id = $1",
      [SUCCEEDED_ID],
    );
    await expectCheckViolation(
      `UPDATE compile_jobs
       SET artifact_cleanup_token = $2, artifact_cleanup_started_at = now()
       WHERE id = $1`,
      [ACCEPTED_ID, "55555555-5555-4555-8555-555555555555"],
    );
    await expectCheckViolation(
      "UPDATE compile_jobs SET artifact_deleted_at = now() WHERE id = $1",
      [ACCEPTED_ID],
    );

    await pool.query(
      `UPDATE compile_jobs
       SET artifact_cleanup_token = $2, artifact_cleanup_started_at = now()
       WHERE id = $1`,
      [SUCCEEDED_ID, "55555555-5555-4555-8555-555555555555"],
    );
    await expectCheckViolation(
      "UPDATE compile_jobs SET artifact_deleted_at = now() WHERE id = $1",
      [SUCCEEDED_ID],
    );
    await pool.query(
      `UPDATE compile_jobs
       SET artifact_cleanup_token = NULL, artifact_cleanup_started_at = NULL,
           artifact_deleted_at = now()
       WHERE id = $1`,
      [SUCCEEDED_ID],
    );
    const valid = await pool.query<{
      accepted_expiry: Date | null;
      deleted: boolean;
    }>(
      `SELECT
         (SELECT expires_at FROM compile_jobs WHERE id = $1) AS accepted_expiry,
         (SELECT artifact_deleted_at IS NOT NULL FROM compile_jobs WHERE id = $2) AS deleted`,
      [ACCEPTED_ID, SUCCEEDED_ID],
    );
    expect(valid.rows[0]).toEqual({ accepted_expiry: null, deleted: true });
  });
});
