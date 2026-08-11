import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createArtifactCleanupRepository } from "./artifact-cleanup-repository";
import { runMigrations } from "./migrate";
import {
  PERMISSION_TEST_FLAG,
  requireDisposableApplicationDatabase,
  requireDisposablePostgresTarget,
} from "./test-support/disposable-postgres-target";

const adminDatabaseUrl = process.env["DEPRESS_POSTGRES_ADMIN_TEST_URL"];
// This suite creates and drops the production-named depress_cleanup role, so it
// runs only when both the target and the explicit permission-test opt-in are
// present, and only after the disposable-target guard clears the server.
const describeDatabase =
  adminDatabaseUrl && process.env[PERMISSION_TEST_FLAG] === "1" ? describe : describe.skip;
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
  const databaseName = `depress_cleanup_perm_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  // Ownership state for teardown. Every flag here is set ONLY after the
  // corresponding creation has actually succeeded, and afterAll consults only
  // this state - never DROP ... IF EXISTS, and never a resource this suite did
  // not itself observe being created. `maintenanceReady` gates the very first
  // PostgreSQL connection teardown is allowed to make: if the disposable-target
  // guard in beforeAll throws, maintenanceReady stays false and afterAll must
  // perform zero PostgreSQL cleanup.
  let maintenanceReady = false;
  let maintenanceUrl: string;
  let createdDatabase = false;
  let createdCleanupRole = false;
  // `admin` is the privileged pool against the disposable application database.
  // The maintenance database from DEPRESS_POSTGRES_ADMIN_TEST_URL never receives
  // migrations; it is used only through withMaintenanceClient for CREATE/DROP
  // DATABASE and DROP ROLE.
  let admin: Pool | undefined;
  let cleanup: Pool | undefined;
  let grantScript: string;

  async function withMaintenanceClient<T>(
    run: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({ connectionString: maintenanceUrl });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.end();
    }
  }

  // Test bodies only ever run after beforeAll has completed successfully, so
  // pools are assigned by then. Accessors keep that invariant explicit; afterAll
  // reads the raw optional variables directly.
  function requireAdminPool(): Pool {
    if (!admin) throw new Error("admin pool is not initialized");
    return admin;
  }

  function requireCleanupPool(): Pool {
    if (!cleanup) throw new Error("cleanup pool is not initialized");
    return cleanup;
  }

  beforeAll(async () => {
    // Must precede every mutation, including CREATE DATABASE and CREATE ROLE.
    // maintenanceReady/maintenanceUrl are only set AFTER this guard succeeds,
    // so a thrown guard leaves afterAll with nothing it is permitted to clean
    // up: it never opens a maintenance connection unless this line completed.
    await requireDisposablePostgresTarget({ connectionString: adminDatabaseUrl! });
    maintenanceUrl = adminDatabaseUrl!;
    maintenanceReady = true;

    await withMaintenanceClient(async (client) => {
      await client.query(`CREATE DATABASE ${databaseName}`);
    });
    // Only recorded once CREATE DATABASE has actually returned successfully.
    createdDatabase = true;

    const applicationUrl = new URL(adminDatabaseUrl!);
    applicationUrl.pathname = `/${databaseName}`;
    // The freshly created database is a second target: validate its disposable
    // identity and confirm it carries no application tables before migrating it.
    await requireDisposableApplicationDatabase({
      connectionString: applicationUrl.toString(),
    });
    admin = new Pool({ connectionString: applicationUrl.toString() });
    await runMigrations(admin);

    await admin.query(
      `CREATE ROLE ${CLEANUP_ROLE}
       LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
       PASSWORD '${CLEANUP_PASSWORD}'`,
    );
    // Recorded only after this exact CREATE ROLE succeeds, so a failure here
    // leaves createdCleanupRole false and afterAll must not DROP ROLE.
    createdCleanupRole = true;

    grantScript = await readGrantScript();
    await admin.query(grantScript);

    const cleanupUrl = new URL(adminDatabaseUrl!);
    cleanupUrl.username = CLEANUP_ROLE;
    cleanupUrl.password = CLEANUP_PASSWORD;
    cleanupUrl.pathname = `/${databaseName}`;
    cleanup = new Pool({ connectionString: cleanupUrl.toString(), max: 4 });
  });

  beforeEach(async () => {
    const adminPool = requireAdminPool();
    await adminPool.query(
      `TRUNCATE compile_outbox, compile_jobs, documents, projects, "user"
       CASCADE`,
    );
    await adminPool.query(
      `INSERT INTO "user" (
         id, name, email, "emailVerified", "createdAt", "updatedAt"
       ) VALUES ($1, 'Cleanup Permission Owner', 'cleanup-permission@example.test',
         true, now(), now())`,
      [OWNER_ID],
    );
    await adminPool.query(
      `INSERT INTO projects (id, owner_user_id, name, is_default)
       VALUES ($1, $2, 'Cleanup Permission Project', true)`,
      [PROJECT_ID, OWNER_ID],
    );
    await adminPool.query(
      `INSERT INTO documents (
         id, project_id, envelope_json, revision, content_hash
       ) VALUES ($1, $2, '{"schemaVersion":1}'::jsonb, 1, $3)`,
      [DOCUMENT_ID, PROJECT_ID, SNAPSHOT_HASH],
    );
    await adminPool.query(
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
    await admin?.end();

    // No PostgreSQL cleanup is permitted unless the disposable-target guard
    // actually succeeded: maintenanceReady is the single gate proving a
    // guard-validated connection string exists. Without it, `maintenanceUrl`
    // may be unset or unvalidated, so withMaintenanceClient must never run.
    if (!maintenanceReady) return;

    await withMaintenanceClient(async (client) => {
      // Drop the disposable application database first so database-local ACLs
      // and objects disappear before the cluster-global cleanup role is removed.
      if (createdDatabase) {
        await client.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
      }
      // Only drop the role this exact test run created - never a role that
      // merely happens to exist, and never via IF EXISTS as a substitute for
      // ownership tracking.
      if (createdCleanupRole) {
        await client.query(`DROP ROLE ${CLEANUP_ROLE}`);
      }
    });
  });

  it("runs claim, stale reclaim, and token-owned finalize with only lifecycle grants", async () => {
    const repository = createArtifactCleanupRepository(requireCleanupPool(), {
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

    const lifecycle = await requireAdminPool().query<{
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
    const cleanupPool = requireCleanupPool();
    async function expectPermissionDenied(sql: string): Promise<void> {
      await expect(cleanupPool.query(sql)).rejects.toMatchObject({ code: "42501" });
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

    const columns = await requireAdminPool().query<{
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
    const broad = await requireAdminPool().query(
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
    const adminPool = requireAdminPool();
    const safeBefore = await adminPool.query<{ unsafe: boolean }>(PUBLIC_CREATE_SQL);
    expect(safeBefore.rows[0]!.unsafe).toBe(false);

    await adminPool.query("GRANT CREATE ON SCHEMA public TO PUBLIC");
    try {
      const unsafe = await adminPool.query<{ unsafe: boolean }>(PUBLIC_CREATE_SQL);
      expect(unsafe.rows[0]!.unsafe).toBe(true);

      await expect(adminPool.query(grantScript)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining(
          "PUBLIC holds CREATE on schema public",
        ),
      });
    } finally {
      await adminPool.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    }

    const restored = await adminPool.query<{ unsafe: boolean }>(PUBLIC_CREATE_SQL);
    expect(restored.rows[0]!.unsafe).toBe(false);
    // The aborted installation must leave the reviewed grants untouched.
    await expect(adminPool.query(grantScript)).resolves.toBeDefined();
  });
});
