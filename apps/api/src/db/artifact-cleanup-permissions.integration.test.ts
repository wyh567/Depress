import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createArtifactCleanupRepository } from "./artifact-cleanup-repository";
import { runMigrations } from "./migrate";

const adminDatabaseUrl = process.env["DEPRESS_POSTGRES_ADMIN_TEST_URL"];
const describeDatabase = adminDatabaseUrl ? describe : describe.skip;
const CLEANUP_ROLE = "depress_cleanup";
const CLEANUP_PASSWORD = "t04d-cleanup-role-test-password";
const OWNER_ID = "artifact-cleanup-permission-owner";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_ID = "33333333-3333-4333-8333-333333333331";
const SECOND_ID = "33333333-3333-4333-8333-333333333332";
const OLD_TOKEN = "44444444-4444-4444-8444-444444444444";
const NEW_TOKEN = "55555555-5555-4555-8555-555555555555";
const SNAPSHOT_HASH = "d".repeat(64);

// Mirrors the effective-ACL probe inside artifact-cleanup-grants.sql so the
// test observes the same PUBLIC state the guard decides on.
const PUBLIC_CREATE_SQL = `
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespaces
    CROSS JOIN LATERAL aclexplode(
      COALESCE(namespaces.nspacl, acldefault('n', namespaces.nspowner))
    ) AS schema_acl
    WHERE namespaces.nspname = 'public'
      AND schema_acl.grantee = 0
      AND schema_acl.privilege_type = 'CREATE'
  ) AS unsafe
`;

function readGrantScript(): Promise<string> {
  return readFile(
    new URL("../../../../deploy/postgres/artifact-cleanup-grants.sql", import.meta.url),
    "utf8",
  );
}

describeDatabase("artifact cleanup PostgreSQL least privilege", () => {
  let admin: Pool;
  let cleanup: Pool;
  let grantScript: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminDatabaseUrl });
    await runMigrations(admin);
    await admin.query(
      `CREATE ROLE depress_cleanup
       LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
       PASSWORD '${CLEANUP_PASSWORD}'`,
    );
    grantScript = await readGrantScript();
    await admin.query(grantScript);

    const cleanupUrl = new URL(adminDatabaseUrl!);
    cleanupUrl.username = CLEANUP_ROLE;
    cleanupUrl.password = CLEANUP_PASSWORD;
    cleanup = new Pool({ connectionString: cleanupUrl.toString(), max: 4 });
  });

  beforeEach(async () => {
    await admin.query(
      `TRUNCATE compile_outbox, compile_jobs, documents, projects, "user"
       CASCADE`,
    );
    await admin.query(
      `INSERT INTO "user" (
         id, name, email, "emailVerified", "createdAt", "updatedAt"
       ) VALUES ($1, 'Cleanup Permission Owner', 'cleanup-permission@example.test',
         true, now(), now())`,
      [OWNER_ID],
    );
    await admin.query(
      `INSERT INTO projects (id, owner_user_id, name, is_default)
       VALUES ($1, $2, 'Cleanup Permission Project', true)`,
      [PROJECT_ID, OWNER_ID],
    );
    await admin.query(
      `INSERT INTO documents (
         id, project_id, envelope_json, revision, content_hash
       ) VALUES ($1, $2, '{"schemaVersion":1}'::jsonb, 1, $3)`,
      [DOCUMENT_ID, PROJECT_ID, SNAPSHOT_HASH],
    );
    await admin.query(
      `INSERT INTO compile_jobs (
         id, project_id, document_id, requested_revision, template_id, format,
         input_snapshot, snapshot_hash, status, artifact_key,
         artifact_byte_length, expires_at, artifact_cleanup_token,
         artifact_cleanup_started_at
       ) VALUES
         ($1, $3, $4, 1, 'ieee', 'pdf', '{}'::jsonb, $5, 'succeeded',
          $6, 100, now() - interval '1 day', NULL, NULL),
         ($2, $3, $4, 1, 'ieee', 'pdf', '{}'::jsonb, $5, 'succeeded',
          $7, 200, now() - interval '2 days', $8,
          now() - interval '15 minutes')`,
      [
        FIRST_ID,
        SECOND_ID,
        PROJECT_ID,
        DOCUMENT_ID,
        SNAPSHOT_HASH,
        `artifacts/${FIRST_ID}.pdf`,
        `artifacts/${SECOND_ID}.pdf`,
        OLD_TOKEN,
      ],
    );
  });

  afterAll(async () => {
    await cleanup?.end();
    if (admin) {
      await admin.query(`DROP OWNED BY depress_cleanup`);
      await admin.query(`DROP ROLE depress_cleanup`);
      await admin.end();
    }
  });

  it("runs claim, stale reclaim, and token-owned finalize with only lifecycle grants", async () => {
    const repository = createArtifactCleanupRepository(cleanup, {
      createClaimToken: () => NEW_TOKEN,
    });

    const claimed = await repository.claimExpiredArtifacts();

    expect(claimed.map((row) => row.jobId)).toEqual([SECOND_ID, FIRST_ID]);
    expect(claimed.every((row) => row.claimToken === NEW_TOKEN)).toBe(true);
    await expect(
      repository.finalizeArtifactDeletion(FIRST_ID, NEW_TOKEN),
    ).resolves.toBe(true);
    await expect(
      repository.finalizeArtifactDeletion(SECOND_ID, NEW_TOKEN),
    ).resolves.toBe(true);

    const lifecycle = await admin.query<{
      id: string;
      artifact_deleted_at: Date;
      artifact_cleanup_token: string | null;
      artifact_cleanup_started_at: Date | null;
      artifact_key: string;
      artifact_byte_length: number;
      expires_at: Date;
    }>(
      `SELECT id, artifact_deleted_at, artifact_cleanup_token,
              artifact_cleanup_started_at, artifact_key,
              artifact_byte_length, expires_at
       FROM compile_jobs
       ORDER BY id`,
    );
    expect(lifecycle.rows).toHaveLength(2);
    expect(
      lifecycle.rows.every(
        (row) =>
          row.artifact_deleted_at instanceof Date &&
          row.artifact_cleanup_token === null &&
          row.artifact_cleanup_started_at === null &&
          row.artifact_key === `artifacts/${row.id}.pdf` &&
          row.artifact_byte_length > 0 &&
          row.expires_at instanceof Date,
      ),
    ).toBe(true);
  });

  it("denies job creation/deletion, unrelated mutation/read, schema creation, auth, and outbox access", async () => {
    async function expectPermissionDenied(sql: string): Promise<void> {
      await expect(cleanup.query(sql)).rejects.toMatchObject({ code: "42501" });
    }

    await expectPermissionDenied("INSERT INTO compile_jobs DEFAULT VALUES");
    await expectPermissionDenied(
      `DELETE FROM compile_jobs WHERE id = '${FIRST_ID}'`,
    );
    await expectPermissionDenied(
      `UPDATE compile_jobs SET template_id = 'ieee' WHERE id = '${FIRST_ID}'`,
    );
    await expectPermissionDenied("SELECT input_snapshot FROM compile_jobs");
    await expectPermissionDenied('SELECT id FROM "user"');
    await expectPermissionDenied("SELECT id FROM compile_outbox");
    await expectPermissionDenied(
      "CREATE TABLE public.cleanup_forbidden (id integer)",
    );

    const columns = await admin.query<{
      privilege_type: string;
      column_name: string;
    }>(
      `SELECT privilege_type, column_name
       FROM information_schema.column_privileges
       WHERE table_schema = 'public'
         AND table_name = 'compile_jobs'
         AND grantee = $1
       ORDER BY privilege_type, column_name`,
      [CLEANUP_ROLE],
    );
    expect(columns.rows).toEqual([
      { privilege_type: "SELECT", column_name: "artifact_byte_length" },
      { privilege_type: "SELECT", column_name: "artifact_cleanup_started_at" },
      { privilege_type: "SELECT", column_name: "artifact_cleanup_token" },
      { privilege_type: "SELECT", column_name: "artifact_deleted_at" },
      { privilege_type: "SELECT", column_name: "artifact_key" },
      { privilege_type: "SELECT", column_name: "expires_at" },
      { privilege_type: "SELECT", column_name: "id" },
      { privilege_type: "SELECT", column_name: "status" },
      { privilege_type: "UPDATE", column_name: "artifact_cleanup_started_at" },
      { privilege_type: "UPDATE", column_name: "artifact_cleanup_token" },
      { privilege_type: "UPDATE", column_name: "artifact_deleted_at" },
    ]);
    const broad = await admin.query(
      `SELECT privilege_type
       FROM information_schema.table_privileges
       WHERE table_schema = 'public' AND grantee = $1`,
      [CLEANUP_ROLE],
    );
    expect(broad.rows).toEqual([]);
  });

  it("refuses installation when PUBLIC still holds CREATE on schema public", async () => {
    // A PostgreSQL 15+ server that was upgraded from 14 keeps the historical
    // public-schema ACL, so the server-version gate alone cannot close this.
    // Reproduce that ACL deliberately and require the grant script to abort.
    const safeBefore = await admin.query<{ unsafe: boolean }>(PUBLIC_CREATE_SQL);
    expect(safeBefore.rows[0]!.unsafe).toBe(false);

    await admin.query("GRANT CREATE ON SCHEMA public TO PUBLIC");
    try {
      const unsafe = await admin.query<{ unsafe: boolean }>(PUBLIC_CREATE_SQL);
      expect(unsafe.rows[0]!.unsafe).toBe(true);

      await expect(admin.query(grantScript)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining(
          "PUBLIC holds CREATE on schema public",
        ),
      });
    } finally {
      await admin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    }

    const restored = await admin.query<{ unsafe: boolean }>(PUBLIC_CREATE_SQL);
    expect(restored.rows[0]!.unsafe).toBe(false);
    // The aborted installation must leave the reviewed grants untouched.
    await expect(admin.query(grantScript)).resolves.toBeDefined();
  });
});
