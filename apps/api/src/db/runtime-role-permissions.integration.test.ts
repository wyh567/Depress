import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PersistedDocumentEnvelope } from "@depress/ast";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createMentorAuth } from "../auth/auth";
import { seedMentorAccount } from "../auth/seed-mentor";
import { createInMemoryCompilePointerQueue } from "../queue/compile-pointer-queue";
import { publishCompileOutbox } from "../services/compile-outbox-publisher";
import { createCompileExecutionRepository } from "./compile-execution-repository";
import { createCompileJobRepository } from "./compile-job-repository";
import { createDocumentRepository } from "./document-repository";
import { runMigrations } from "./migrate";
import { createProjectRepository } from "./project-repository";
import { createReferenceRepository } from "./reference-repository";
import {
  PERMISSION_TEST_FLAG,
  requireDisposableApplicationDatabase,
  requireDisposablePostgresTarget,
} from "./test-support/disposable-postgres-target";

const adminDatabaseUrl = process.env["DEPRESS_POSTGRES_ADMIN_TEST_URL"];
// This suite creates and drops the production-named runtime roles, so it runs
// only when both the target and the explicit permission-test opt-in are
// present, and only after the disposable-target guard clears the server.
const describeDatabase =
  adminDatabaseUrl && process.env[PERMISSION_TEST_FLAG] === "1" ? describe : describe.skip;

const API_ROLE = "depress_api";
const OUTBOX_ROLE = "depress_outbox";
const WORKER_ROLE = "depress_pointer_worker";
const CLEANUP_ROLE = "depress_cleanup";
const CLEANUP_ROLE_PASSWORD = "r1-cleanup-role-isolation-password";
const RUNTIME_ROLES = [API_ROLE, OUTBOX_ROLE, WORKER_ROLE] as const;
const ROLE_PASSWORDS: Record<string, string> = {
  [API_ROLE]: "r1-api-role-test-password",
  [OUTBOX_ROLE]: "r1-outbox-role-test-password",
  [WORKER_ROLE]: "r1-pointer-worker-role-test-password",
};

const INSUFFICIENT_PRIVILEGE = "42501";
const AUTH_ORIGIN = "http://localhost:3000";
const AUTH_SECRET = "r1-runtime-role-permission-secret-at-least-32-chars";
const MENTOR = {
  email: "runtime-permissions@example.test",
  password: "runtime-permission-password",
  name: "Runtime Permission Mentor",
};
const REFERENCE = {
  id: "smith2026",
  type: "article-journal" as const,
  title: "Runtime permission reference",
  author: [{ family: "Smith", given: "A." }],
  issued: { "date-parts": [[2026]] },
};
const ENVELOPE: PersistedDocumentEnvelope = {
  schemaVersion: 1,
  editor: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Runtime permissions" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Citation " },
          { type: "citation", attrs: { citeKey: REFERENCE.id } },
        ],
      },
    ],
  },
  metadata: { title: "Runtime permissions", keywords: ["least-privilege"] },
};

// The reviewed contract, restated independently of the SQL artifact. The sweep
// below asserts the installed privileges equal exactly this, so an accidental
// widening in either file fails the suite.
const API_COLUMN_GRANTS = {
  projects: {
    SELECT: ["id", "owner_user_id", "name", "is_default", "created_at", "updated_at"],
    INSERT: ["id", "owner_user_id", "name", "is_default"],
  },
  documents: {
    SELECT: [
      "id",
      "project_id",
      "envelope_json",
      "revision",
      "content_hash",
      "created_at",
      "updated_at",
    ],
    INSERT: ["id", "project_id", "envelope_json", "revision", "content_hash"],
    UPDATE: ["envelope_json", "content_hash", "revision", "updated_at"],
  },
  project_references: {
    SELECT: ["project_id", "cite_key", "item_json", "created_at", "updated_at"],
    INSERT: ["project_id", "cite_key", "item_json"],
    UPDATE: ["item_json", "updated_at"],
  },
  compile_jobs: {
    SELECT: [
      "id",
      "project_id",
      "document_id",
      "requested_revision",
      "template_id",
      "format",
      "snapshot_hash",
      "status",
      "created_at",
      "updated_at",
      "artifact_key",
      "expires_at",
      "artifact_deleted_at",
    ],
    INSERT: [
      "id",
      "project_id",
      "document_id",
      "requested_revision",
      "template_id",
      "format",
      "input_snapshot",
      "snapshot_hash",
      "status",
    ],
  },
  compile_outbox: {
    INSERT: ["id", "job_id", "snapshot_hash"],
  },
  user: {
    SELECT: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
    INSERT: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
    UPDATE: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
  },
  session: {
    SELECT: [
      "id",
      "expiresAt",
      "token",
      "createdAt",
      "updatedAt",
      "ipAddress",
      "userAgent",
      "userId",
    ],
    INSERT: [
      "id",
      "expiresAt",
      "token",
      "createdAt",
      "updatedAt",
      "ipAddress",
      "userAgent",
      "userId",
    ],
    UPDATE: [
      "id",
      "expiresAt",
      "token",
      "createdAt",
      "updatedAt",
      "ipAddress",
      "userAgent",
      "userId",
    ],
  },
  account: {
    SELECT: [
      "id",
      "accountId",
      "providerId",
      "userId",
      "accessToken",
      "refreshToken",
      "idToken",
      "accessTokenExpiresAt",
      "refreshTokenExpiresAt",
      "scope",
      "password",
      "createdAt",
      "updatedAt",
    ],
    INSERT: [
      "id",
      "accountId",
      "providerId",
      "userId",
      "accessToken",
      "refreshToken",
      "idToken",
      "accessTokenExpiresAt",
      "refreshTokenExpiresAt",
      "scope",
      "password",
      "createdAt",
      "updatedAt",
    ],
    UPDATE: [
      "id",
      "accountId",
      "providerId",
      "userId",
      "accessToken",
      "refreshToken",
      "idToken",
      "accessTokenExpiresAt",
      "refreshTokenExpiresAt",
      "scope",
      "password",
      "createdAt",
      "updatedAt",
    ],
  },
  verification: {
    SELECT: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
    INSERT: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
    UPDATE: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
  },
} as const;

const OUTBOX_COLUMN_GRANTS = {
  compile_outbox: {
    SELECT: ["id", "job_id", "snapshot_hash", "created_at", "published_at", "attempt_count"],
    UPDATE: ["published_at", "attempt_count", "last_error_code"],
  },
  compile_jobs: {
    SELECT: ["id", "status"],
    UPDATE: ["status", "updated_at"],
  },
} as const;

const WORKER_COLUMN_GRANTS = {
  compile_jobs: {
    SELECT: [
      "id",
      "input_snapshot",
      "snapshot_hash",
      "status",
      "processing_started_at",
      "processing_token",
    ],
    UPDATE: [
      "status",
      "error_code",
      "processing_token",
      "processing_started_at",
      "updated_at",
      "artifact_key",
      "artifact_byte_length",
      "expires_at",
    ],
  },
} as const;

const EXPECTED_TABLE_GRANTS: Record<string, readonly string[]> = {
  [API_ROLE]: ["project_references:DELETE", "session:DELETE", "verification:DELETE"],
  [OUTBOX_ROLE]: [],
  [WORKER_ROLE]: [],
};

type ColumnGrantShape = Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;

function flattenColumnGrants(shape: ColumnGrantShape): string[] {
  const flattened: string[] = [];
  for (const [table, privileges] of Object.entries(shape)) {
    for (const [privilege, columns] of Object.entries(privileges)) {
      for (const column of columns) {
        flattened.push(`${table}.${column}:${privilege}`);
      }
    }
  }
  return flattened.sort();
}

const EXPECTED_COLUMN_GRANTS: Record<string, readonly string[]> = {
  [API_ROLE]: flattenColumnGrants(API_COLUMN_GRANTS),
  [OUTBOX_ROLE]: flattenColumnGrants(OUTBOX_COLUMN_GRANTS),
  [WORKER_ROLE]: flattenColumnGrants(WORKER_COLUMN_GRANTS),
};

function readGrantScript(): Promise<string> {
  return readFile(
    new URL("../../../../deploy/postgres/runtime-role-grants.sql", import.meta.url),
    "utf8",
  );
}

function readCleanupGrantScript(): Promise<string> {
  return readFile(
    new URL("../../../../deploy/postgres/artifact-cleanup-grants.sql", import.meta.url),
    "utf8",
  );
}

function roleUrl(baseUrl: string, database: string, role: string): string {
  const url = new URL(baseUrl);
  url.username = role;
  url.password = ROLE_PASSWORDS[role]!;
  url.pathname = `/${database}`;
  return url.toString();
}

describeDatabase("runtime role PostgreSQL least privilege", () => {
  const databaseName = `depress_runtime_perm_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  // Ownership state for teardown. Every flag/set here is set ONLY after the
  // corresponding creation has actually succeeded, and afterAll consults only
  // this state - never DROP ... IF EXISTS, and never a resource this suite did
  // not itself observe being created. `maintenanceReady` gates the very first
  // PostgreSQL connection teardown is allowed to make: if the disposable-target
  // guard in beforeAll throws, maintenanceReady stays false and afterAll must
  // perform zero PostgreSQL cleanup.
  let maintenanceReady = false;
  let maintenanceUrl: string;
  let createdDatabase = false;
  const createdRoles = new Set<string>();
  let admin: Pool | undefined;
  let api: Pool | undefined;
  let outbox: Pool | undefined;
  let worker: Pool | undefined;
  let grantScript: string;
  let adminRole: string;
  let mentorUserId: string;
  let projectId: string;
  let documentId: string;

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

  // Test bodies only ever run after beforeAll has completed successfully (a
  // thrown beforeAll skips every `it` in this describe block), so pools are
  // always assigned by the time any of them executes. These accessors keep that
  // invariant explicit at every call site instead of non-null-asserting optional
  // pools dozens of times, while afterAll (which can run after a failed
  // beforeAll) reads the raw optional variables directly.
  function requireAdminPool(): Pool {
    if (!admin) throw new Error("admin pool is not initialized");
    return admin;
  }

  function requireApiPool(): Pool {
    if (!api) throw new Error("api pool is not initialized");
    return api;
  }

  function requireOutboxPool(): Pool {
    if (!outbox) throw new Error("outbox pool is not initialized");
    return outbox;
  }

  function requireWorkerPool(): Pool {
    if (!worker) throw new Error("worker pool is not initialized");
    return worker;
  }

  async function columnGrantsFor(role: string): Promise<string[]> {
    const result = await requireAdminPool().query<{
      table_name: string;
      column_name: string;
      privilege_type: string;
    }>(
      `
        SELECT relations.relname AS table_name,
               attributes.attname AS column_name,
               column_acl.privilege_type
        FROM pg_catalog.pg_attribute AS attributes
        JOIN pg_catalog.pg_class AS relations ON relations.oid = attributes.attrelid
        JOIN pg_catalog.pg_namespace AS namespaces
          ON namespaces.oid = relations.relnamespace
        CROSS JOIN LATERAL aclexplode(attributes.attacl) AS column_acl
        WHERE namespaces.nspname = 'public'
          AND attributes.attnum > 0
          AND NOT attributes.attisdropped
          AND column_acl.grantee = (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
          )
      `,
      [role],
    );
    return result.rows
      .map((row) => `${row.table_name}.${row.column_name}:${row.privilege_type}`)
      .sort();
  }

  async function tableGrantsFor(role: string): Promise<string[]> {
    const result = await requireAdminPool().query<{ table_name: string; privilege_type: string }>(
      `
        SELECT relations.relname AS table_name, table_acl.privilege_type
        FROM pg_catalog.pg_class AS relations
        JOIN pg_catalog.pg_namespace AS namespaces
          ON namespaces.oid = relations.relnamespace
        CROSS JOIN LATERAL aclexplode(relations.relacl) AS table_acl
        WHERE namespaces.nspname = 'public'
          AND relations.relkind IN ('r', 'p')
          AND table_acl.grantee = (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
          )
      `,
      [role],
    );
    return result.rows
      .map((row) => `${row.table_name}:${row.privilege_type}`)
      .sort();
  }

  async function expectDenied(
    pool: Pool,
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<void> {
    await expect(pool.query(sql, [...params])).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    });
  }

  async function databasePrivilegesFor(role: string): Promise<string[]> {
    const result = await requireAdminPool().query<{ privilege_type: string }>(
      `
        SELECT database_acl.privilege_type
        FROM pg_catalog.pg_database AS databases
        CROSS JOIN LATERAL aclexplode(databases.datacl) AS database_acl
        WHERE databases.datname = current_database()
          AND database_acl.grantee = (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
          )
      `,
      [role],
    );
    return result.rows.map((row) => row.privilege_type).sort();
  }

  async function schemaPrivilegesFor(role: string): Promise<string[]> {
    const result = await requireAdminPool().query<{ privilege_type: string }>(
      `
        SELECT schema_acl.privilege_type
        FROM pg_catalog.pg_namespace AS namespaces
        CROSS JOIN LATERAL aclexplode(namespaces.nspacl) AS schema_acl
        WHERE namespaces.nspname = 'public'
          AND schema_acl.grantee = (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
          )
      `,
      [role],
    );
    return result.rows.map((row) => row.privilege_type).sort();
  }

  function createAuthApp(pool: Pool) {
    const auth = createMentorAuth(pool, {
      secret: AUTH_SECRET,
      origin: AUTH_ORIGIN,
      isProduction: false,
    });
    return buildApp({ auth, authOrigin: AUTH_ORIGIN });
  }

  function cookieFrom(response: {
    headers: Record<string, string | string[] | number | undefined>;
  }): string {
    const value = response.headers["set-cookie"];
    if (typeof value === "number") throw new Error("Invalid Set-Cookie header");
    const first = Array.isArray(value) ? value[0] : value;
    if (!first) throw new Error("Expected an authentication cookie");
    return first.split(";", 1)[0]!;
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

    const adminUrl = new URL(adminDatabaseUrl!);
    adminUrl.pathname = `/${databaseName}`;
    // The freshly created database is a second target: validate its disposable
    // identity and confirm it carries no application tables before migrating it.
    await requireDisposableApplicationDatabase({ connectionString: adminUrl.toString() });
    admin = new Pool({ connectionString: adminUrl.toString() });
    const identity = await admin.query<{ current_user: string }>("SELECT current_user");
    adminRole = identity.rows[0]!.current_user;
    await runMigrations(admin);

    // The reviewed target state requires PUBLIC to hold no database-level
    // privilege. Performing it here proves the guard's precondition is
    // satisfiable; the installer itself never touches the PUBLIC ACL.
    await admin.query(
      `REVOKE CONNECT, TEMPORARY ON DATABASE ${databaseName} FROM PUBLIC`,
    );

    for (const role of RUNTIME_ROLES) {
      await admin.query(
        `CREATE ROLE ${role}
         LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
         PASSWORD '${ROLE_PASSWORDS[role]!}'`,
      );
      // Recorded individually and only after this exact CREATE ROLE succeeds,
      // so a failure partway through the loop leaves earlier roles marked as
      // owned (eligible for teardown) and later, uncreated roles unmarked.
      createdRoles.add(role);
    }

    grantScript = await readGrantScript();
    await admin.query(grantScript);

    api = new Pool({ connectionString: roleUrl(adminDatabaseUrl!, databaseName, API_ROLE), max: 4 });
    outbox = new Pool({
      connectionString: roleUrl(adminDatabaseUrl!, databaseName, OUTBOX_ROLE),
      max: 2,
    });
    worker = new Pool({
      connectionString: roleUrl(adminDatabaseUrl!, databaseName, WORKER_ROLE),
      max: 2,
    });
  }, 60_000);

  afterAll(async () => {
    await Promise.all([api?.end(), outbox?.end(), worker?.end()]);
    await admin?.end();

    // No PostgreSQL cleanup is permitted unless the disposable-target guard
    // actually succeeded: maintenanceReady is the single gate proving a
    // guard-validated connection string exists. Without it, `maintenanceUrl`
    // may be unset or unvalidated, so withMaintenanceClient must never run.
    if (!maintenanceReady) return;

    await withMaintenanceClient(async (client) => {
      // Only drop the database this exact test run created.
      if (createdDatabase) {
        await client.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
      }
      // Only drop roles this exact test run created - never a role that
      // merely happens to exist, and never via IF EXISTS as a substitute for
      // ownership tracking.
      for (const role of createdRoles) {
        await client.query(`DROP ROLE ${role}`);
      }
    });
  });

  beforeEach(async () => {
    await requireAdminPool().query(
      `TRUNCATE compile_outbox, compile_jobs, project_references, documents,
       projects, "verification", "session", "account", "user" CASCADE`,
    );
    const seeded = await seedMentorAccount(
      requireApiPool(),
      { secret: AUTH_SECRET, origin: AUTH_ORIGIN, isProduction: false },
      MENTOR,
    );
    mentorUserId = seeded.userId;
    projectId = seeded.defaultProjectId;
    const document = await createDocumentRepository(requireApiPool()).create({
      projectId,
      envelope: ENVELOPE,
    });
    documentId = document.id;
    await createReferenceRepository(requireApiPool()).upsert({
      projectId,
      item: REFERENCE,
    });
  });

  describe("installed contract", () => {
    it("validated against PostgreSQL 16 or newer", async () => {
      const result = await requireAdminPool().query<{ server_version_num: string }>(
        "SELECT current_setting('server_version_num') AS server_version_num",
      );
      expect(Number(result.rows[0]!.server_version_num)).toBeGreaterThanOrEqual(160000);
    });

    it("installs exactly the reviewed column and table privileges", async () => {
      for (const role of RUNTIME_ROLES) {
        expect(await columnGrantsFor(role)).toEqual([...EXPECTED_COLUMN_GRANTS[role]!]);
        expect(await tableGrantsFor(role)).toEqual([...EXPECTED_TABLE_GRANTS[role]!]);
      }
    });

    it("grants CONNECT and schema USAGE but never CREATE or TEMPORARY", async () => {
      for (const role of RUNTIME_ROLES) {
        const result = await requireAdminPool().query<{
          can_connect: boolean;
          can_temp: boolean;
          can_use: boolean;
          can_create: boolean;
        }>(
          `
            SELECT has_database_privilege($1, current_database(), 'CONNECT') AS can_connect,
                   has_database_privilege($1, current_database(), 'TEMPORARY') AS can_temp,
                   has_schema_privilege($1, 'public', 'USAGE') AS can_use,
                   has_schema_privilege($1, 'public', 'CREATE') AS can_create
          `,
          [role],
        );
        expect(result.rows[0]).toEqual({
          can_connect: true,
          can_temp: false,
          can_use: true,
          can_create: false,
        });
      }
    });

    it("leaves runtime roles without memberships, ownership, or schema_migrations access", async () => {
      const memberships = await requireAdminPool().query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM pg_catalog.pg_auth_members AS memberships
          JOIN pg_catalog.pg_roles AS members ON members.oid = memberships.member
          WHERE members.rolname = ANY($1::text[])
        `,
        [[...RUNTIME_ROLES]],
      );
      expect(memberships.rows[0]!.count).toBe("0");

      const owned = await requireAdminPool().query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM pg_catalog.pg_class AS relations
          JOIN pg_catalog.pg_namespace AS namespaces
            ON namespaces.oid = relations.relnamespace
          JOIN pg_catalog.pg_roles AS owners ON owners.oid = relations.relowner
          WHERE namespaces.nspname = 'public' AND owners.rolname = ANY($1::text[])
        `,
        [[...RUNTIME_ROLES]],
      );
      expect(owned.rows[0]!.count).toBe("0");

      for (const pool of [requireApiPool(), requireOutboxPool(), requireWorkerPool()]) {
        await expectDenied(pool, "SELECT name FROM schema_migrations");
      }
    });
  });

  describe("depress_api positive runtime operations", () => {
    it("runs the supported Better Auth mentor flows", async () => {
      const app = createAuthApp(requireApiPool());
      try {
        const signedIn = await app.inject({
          method: "POST",
          url: "/api/auth/sign-in/email",
          headers: { origin: AUTH_ORIGIN },
          payload: { email: MENTOR.email, password: MENTOR.password, rememberMe: true },
        });
        expect(signedIn.statusCode).toBe(200);
        const cookie = cookieFrom(signedIn);

        const session = await app.inject({
          method: "GET",
          url: "/api/auth/get-session",
          headers: { cookie },
        });
        expect(session.statusCode).toBe(200);

        const probe = await app.inject({
          method: "GET",
          url: "/api/protected-probe",
          headers: { cookie },
        });
        expect(probe.statusCode).toBe(200);
        expect(probe.json()).toEqual({ userId: mentorUserId });

        const listed = await app.inject({
          method: "GET",
          url: "/api/auth/list-sessions",
          headers: { cookie },
        });
        expect(listed.statusCode).toBe(200);

        const renamed = await app.inject({
          method: "POST",
          url: "/api/auth/update-user",
          headers: { cookie, origin: AUTH_ORIGIN },
          payload: { name: "Renamed Mentor" },
        });
        expect(renamed.statusCode).toBe(200);

        const changed = await app.inject({
          method: "POST",
          url: "/api/auth/change-password",
          headers: { cookie, origin: AUTH_ORIGIN },
          payload: {
            currentPassword: MENTOR.password,
            newPassword: "runtime-permission-password-2",
            revokeOtherSessions: true,
          },
        });
        expect(changed.statusCode).toBe(200);

        const signedOut = await app.inject({
          method: "POST",
          url: "/api/auth/sign-out",
          headers: { cookie, origin: AUTH_ORIGIN },
        });
        expect(signedOut.statusCode).toBe(200);

        const afterLogout = await app.inject({
          method: "GET",
          url: "/api/protected-probe",
          headers: { cookie },
        });
        expect(afterLogout.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it("runs project, document, and reference runtime paths", async () => {
      const projects = createProjectRepository(requireApiPool());
      const documents = createDocumentRepository(requireApiPool());
      const references = createReferenceRepository(requireApiPool());

      const project = await projects.getOrCreateDefaultProject(mentorUserId);
      expect(project.id).toBe(projectId);

      const listed = await documents.list(projectId);
      expect(listed).toHaveLength(1);
      const fetched = await documents.get({ projectId, documentId });
      expect(fetched?.revision).toBe(1);

      const saved = await documents.save({
        projectId,
        documentId,
        expectedRevision: 1,
        envelope: ENVELOPE,
      });
      expect(saved.status).toBe("saved");
      const conflict = await documents.save({
        projectId,
        documentId,
        expectedRevision: 1,
        envelope: ENVELOPE,
      });
      expect(conflict.status).toBe("conflict");

      const created = await references.create({
        projectId,
        item: { ...REFERENCE, id: "second2026" },
      });
      expect(created.status).toBe("created");
      const duplicate = await references.create({
        projectId,
        item: { ...REFERENCE, id: "second2026" },
      });
      expect(duplicate.status).toBe("duplicate");
      const updated = await references.update({
        projectId,
        citeKey: "second2026",
        item: { ...REFERENCE, id: "second2026", title: "Updated" },
      });
      expect(updated?.item.title).toBe("Updated");
      expect(await references.list(projectId)).toHaveLength(2);
      expect(await references.remove(projectId, "second2026")).toBe(true);
    });

    it("creates a compile job with its advisory-lock quota gate and outbox row", async () => {
      const jobs = createCompileJobRepository(requireApiPool());
      const created = await jobs.createForOwner({
        ownerUserId: mentorUserId,
        request: { documentId, revision: 1, templateId: "ieee", format: "pdf" },
      });
      expect(created.resource.status).toBe("accepted");

      const read = await jobs.getForOwner(mentorUserId, created.resource.jobId);
      expect(read?.jobId).toBe(created.resource.jobId);

      const artifact = await jobs.getArtifactForOwner(
        mentorUserId,
        created.resource.jobId,
      );
      expect(artifact).toMatchObject({ status: "accepted", artifactKey: null });

      const outboxRows = await requireAdminPool().query<{ count: string }>(
        "SELECT count(*)::text AS count FROM compile_outbox",
      );
      expect(outboxRows.rows[0]!.count).toBe("1");
    });
  });

  describe("depress_outbox positive runtime operations", () => {
    it("claims, publishes, and records queue failures", async () => {
      const jobs = createCompileJobRepository(requireApiPool());
      const created = await jobs.createForOwner({
        ownerUserId: mentorUserId,
        request: { documentId, revision: 1, templateId: "ieee", format: "pdf" },
      });

      const queue = createInMemoryCompilePointerQueue();
      const published = await publishCompileOutbox({ pool: requireOutboxPool(), queue, batchSize: 25 });
      expect(published).toMatchObject({ selected: 1, published: 1, failed: 0 });
      expect(queue.payloads).toHaveLength(1);

      const job = await requireAdminPool().query<{ status: string }>(
        "SELECT status FROM compile_jobs WHERE id = $1",
        [created.resource.jobId],
      );
      expect(job.rows[0]!.status).toBe("queued");

      await requireAdminPool().query("UPDATE compile_outbox SET published_at = NULL");
      const failing = {
        enqueue: async () => {
          throw new Error("queue unavailable");
        },
      };
      const failed = await publishCompileOutbox({ pool: requireOutboxPool(), queue: failing, batchSize: 25 });
      expect(failed).toMatchObject({ selected: 1, published: 0, failed: 1 });

      const outboxRow = await requireAdminPool().query<{
        attempt_count: number;
        last_error_code: string | null;
      }>("SELECT attempt_count, last_error_code FROM compile_outbox");
      expect(outboxRow.rows[0]).toMatchObject({ last_error_code: "QUEUE_UNAVAILABLE" });
    });
  });

  describe("depress_pointer_worker positive runtime operations", () => {
    it("loads, claims, succeeds, and fails compile jobs", async () => {
      const jobs = createCompileJobRepository(requireApiPool());
      const created = await jobs.createForOwner({
        ownerUserId: mentorUserId,
        request: { documentId, revision: 1, templateId: "ieee", format: "pdf" },
      });
      const jobId = created.resource.jobId;
      await publishCompileOutbox({
        pool: requireOutboxPool(),
        queue: createInMemoryCompilePointerQueue(),
        batchSize: 25,
      });

      const execution = createCompileExecutionRepository(requireWorkerPool());
      const loaded = await execution.load(jobId);
      expect(loaded).toMatchObject({ id: jobId, status: "queued" });

      const token = randomUUID();
      expect(await execution.claim(jobId, token, new Date(Date.now() - 30_000))).toBe(true);
      expect(
        await execution.succeed(jobId, token, `artifacts/${jobId}.pdf`, 2048),
      ).toBe(true);

      const succeeded = await requireAdminPool().query<{
        status: string;
        artifact_key: string;
        expires_at: Date;
      }>("SELECT status, artifact_key, expires_at FROM compile_jobs WHERE id = $1", [
        jobId,
      ]);
      expect(succeeded.rows[0]).toMatchObject({
        status: "succeeded",
        artifact_key: `artifacts/${jobId}.pdf`,
      });
      expect(succeeded.rows[0]!.expires_at).toBeInstanceOf(Date);
    });

    it("fails a queued job and an owned processing job", async () => {
      const jobs = createCompileJobRepository(requireApiPool());
      const created = await jobs.createForOwner({
        ownerUserId: mentorUserId,
        request: { documentId, revision: 1, templateId: "ieee", format: "pdf" },
      });
      const jobId = created.resource.jobId;
      await publishCompileOutbox({
        pool: requireOutboxPool(),
        queue: createInMemoryCompilePointerQueue(),
        batchSize: 25,
      });

      const execution = createCompileExecutionRepository(requireWorkerPool());
      expect(await execution.failQueued(jobId, "SNAPSHOT_INVALID")).toBe(true);

      await requireAdminPool().query(
        `UPDATE compile_jobs
         SET status = 'queued', error_code = NULL, updated_at = now()
         WHERE id = $1`,
        [jobId],
      );
      const token = randomUUID();
      expect(await execution.claim(jobId, token, new Date(Date.now() - 30_000))).toBe(true);
      expect(await execution.failOwned(jobId, token, "COMPILE_FAILED")).toBe(true);
      expect(await execution.failOwned(jobId, randomUUID(), "COMPILE_FAILED")).toBe(false);
    });
  });

  describe("negative permission boundaries", () => {
    it("denies depress_api every privilege outside its contract", async () => {
      await expectDenied(requireApiPool(), "UPDATE compile_jobs SET status = 'succeeded'");
      await expectDenied(requireApiPool(), "SELECT input_snapshot FROM compile_jobs");
      await expectDenied(requireApiPool(), "SELECT error_code FROM compile_jobs");
      await expectDenied(requireApiPool(), "SELECT processing_token FROM compile_jobs");
      await expectDenied(requireApiPool(), "SELECT artifact_cleanup_token FROM compile_jobs");
      await expectDenied(requireApiPool(), "DELETE FROM compile_jobs");
      await expectDenied(requireApiPool(), "SELECT id FROM compile_outbox");
      await expectDenied(requireApiPool(), "UPDATE compile_outbox SET published_at = now()");
      await expectDenied(requireApiPool(), "DELETE FROM compile_outbox");
      await expectDenied(requireApiPool(), "UPDATE projects SET name = 'renamed'");
      await expectDenied(requireApiPool(), "DELETE FROM projects");
      await expectDenied(requireApiPool(), "UPDATE documents SET project_id = project_id");
      await expectDenied(requireApiPool(), "DELETE FROM documents");
      await expectDenied(requireApiPool(), `DELETE FROM "user"`);
      await expectDenied(requireApiPool(), `DELETE FROM "account"`);
    });

    it("denies depress_outbox any access to auth, project, or document data", async () => {
      await expectDenied(requireOutboxPool(), `SELECT id FROM "user"`);
      await expectDenied(requireOutboxPool(), `SELECT id FROM "session"`);
      await expectDenied(requireOutboxPool(), `SELECT id FROM "account"`);
      await expectDenied(requireOutboxPool(), `SELECT id FROM "verification"`);
      await expectDenied(requireOutboxPool(), "SELECT id FROM projects");
      await expectDenied(requireOutboxPool(), "SELECT id FROM documents");
      await expectDenied(requireOutboxPool(), "SELECT cite_key FROM project_references");
      await expectDenied(requireOutboxPool(), "UPDATE projects SET name = 'renamed'");
      await expectDenied(requireOutboxPool(), "UPDATE documents SET envelope_json = envelope_json");
      await expectDenied(requireOutboxPool(), "DELETE FROM project_references");
      await expectDenied(
        requireOutboxPool(),
        "INSERT INTO compile_outbox (id, job_id, snapshot_hash) VALUES ($1, $1, $2)",
        [randomUUID(), "a".repeat(64)],
      );
      await expectDenied(requireOutboxPool(), "DELETE FROM compile_outbox");
      await expectDenied(requireOutboxPool(), "SELECT input_snapshot FROM compile_jobs");
      await expectDenied(requireOutboxPool(), "UPDATE compile_jobs SET artifact_key = 'forged'");
      await expectDenied(requireOutboxPool(), "DELETE FROM compile_jobs");
    });

    it("denies depress_pointer_worker everything except its compile_jobs columns", async () => {
      await expectDenied(requireWorkerPool(), `SELECT id FROM "user"`);
      await expectDenied(requireWorkerPool(), `SELECT token FROM "session"`);
      await expectDenied(requireWorkerPool(), `SELECT password FROM "account"`);
      await expectDenied(requireWorkerPool(), `SELECT value FROM "verification"`);
      await expectDenied(requireWorkerPool(), "SELECT id FROM projects");
      await expectDenied(requireWorkerPool(), "SELECT envelope_json FROM documents");
      await expectDenied(requireWorkerPool(), "SELECT item_json FROM project_references");
      await expectDenied(requireWorkerPool(), "SELECT id FROM compile_outbox");
      await expectDenied(requireWorkerPool(), "UPDATE documents SET envelope_json = envelope_json");
      await expectDenied(requireWorkerPool(), "DELETE FROM compile_jobs");
      await expectDenied(
        requireWorkerPool(),
        "UPDATE compile_jobs SET artifact_cleanup_token = NULL",
      );
      await expectDenied(requireWorkerPool(), "UPDATE compile_jobs SET artifact_deleted_at = now()");
      await expectDenied(requireWorkerPool(), "SELECT artifact_cleanup_started_at FROM compile_jobs");
      await expectDenied(requireWorkerPool(), "SELECT project_id FROM compile_jobs");
    });

    it("denies every runtime role any DDL, truncation, or schema authority", async () => {
      for (const pool of [requireApiPool(), requireOutboxPool(), requireWorkerPool()]) {
        await expectDenied(pool, "CREATE TABLE public.permission_probe (id integer)");
        await expectDenied(pool, "ALTER TABLE compile_jobs ADD COLUMN permission_probe text");
        await expectDenied(pool, "DROP TABLE compile_outbox");
        await expectDenied(pool, "TRUNCATE compile_jobs");
        await expectDenied(pool, "CREATE INDEX permission_probe_idx ON compile_jobs (id)");
      }
    });
  });

  describe("disposable target guard", () => {
    it("refuses a migrated database as a fresh application target", async () => {
      // This database has already been migrated, so its application fingerprint
      // must now cause a refusal. This is the protection that stops a suite from
      // mutating an existing DePress database.
      const migratedUrl = new URL(adminDatabaseUrl!);
      migratedUrl.pathname = `/${databaseName}`;
      await expect(
        requireDisposableApplicationDatabase({ connectionString: migratedUrl.toString() }),
      ).rejects.toThrow(/already contains DePress application table\(s\)/);
    });

    it("refuses the production database name before connecting", async () => {
      const productionUrl = new URL(adminDatabaseUrl!);
      productionUrl.pathname = "/depress";
      await expect(
        requireDisposablePostgresTarget({ connectionString: productionUrl.toString() }),
      ).rejects.toThrow(/production database name/);
      await expect(
        requireDisposableApplicationDatabase({ connectionString: productionUrl.toString() }),
      ).rejects.toThrow(/production database name/);
    });

    it("refuses the cluster while any DePress production role exists", async () => {
      // The three runtime roles exist for this suite, so the administrative
      // guard must now refuse the cluster it originally admitted.
      await expect(
        requireDisposablePostgresTarget({ connectionString: adminDatabaseUrl! }),
      ).rejects.toThrow(/already has DePress role\(s\)/);
    });

    it("refuses each individual production role fingerprint", async () => {
      // Proves the fingerprint is the complete role set rather than only the
      // roles a given suite creates. Each probe role is dropped only if this
      // iteration positively recorded creating it - never via IF EXISTS, and
      // never if CREATE ROLE failed because the role already existed.
      for (const role of ["depress_db_owner", "depress_migration", CLEANUP_ROLE]) {
        let createdProbeRole = false;
        try {
          await withMaintenanceClient(async (client) => {
            await client.query(`CREATE ROLE ${role} NOLOGIN`);
          });
          createdProbeRole = true;
          await expect(
            requireDisposablePostgresTarget({ connectionString: adminDatabaseUrl! }),
          ).rejects.toThrow(new RegExp(`already has DePress role\\(s\\).*${role}`));
        } finally {
          if (createdProbeRole) {
            await withMaintenanceClient(async (client) => {
              await client.query(`DROP ROLE ${role}`);
            });
          }
        }
      }
    });
  });

  describe("installer guards", () => {
    it("is rerunnable and removes privileges that drifted after installation", async () => {
      await requireAdminPool().query("GRANT DELETE ON TABLE compile_jobs TO depress_api");
      await requireAdminPool().query(`GRANT SELECT (input_snapshot) ON TABLE compile_jobs TO depress_api`);
      expect(await tableGrantsFor(API_ROLE)).toContain("compile_jobs:DELETE");

      await requireAdminPool().query(grantScript);

      expect(await columnGrantsFor(API_ROLE)).toEqual([...EXPECTED_COLUMN_GRANTS[API_ROLE]!]);
      expect(await tableGrantsFor(API_ROLE)).toEqual([...EXPECTED_TABLE_GRANTS[API_ROLE]!]);
    });

    it("refuses to install while PUBLIC holds CREATE on schema public", async () => {
      await requireAdminPool().query("GRANT CREATE ON SCHEMA public TO PUBLIC");
      try {
        await expect(requireAdminPool().query(grantScript)).rejects.toThrow(
          /PUBLIC holds CREATE on schema public/,
        );
      } finally {
        await requireAdminPool().query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
      }
      expect(await columnGrantsFor(API_ROLE)).toEqual([...EXPECTED_COLUMN_GRANTS[API_ROLE]!]);
    });

    it("refuses to install while PUBLIC holds database CONNECT or TEMPORARY", async () => {
      await requireAdminPool().query(`GRANT CONNECT ON DATABASE ${databaseName} TO PUBLIC`);
      try {
        await expect(requireAdminPool().query(grantScript)).rejects.toThrow(
          /PUBLIC holds .* on database/,
        );
      } finally {
        await requireAdminPool().query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${databaseName} FROM PUBLIC`);
      }
      await requireAdminPool().query(grantScript);
      expect(await columnGrantsFor(API_ROLE)).toEqual([...EXPECTED_COLUMN_GRANTS[API_ROLE]!]);
    });

    it("refuses to install when a table no longer matches the reviewed column shape", async () => {
      await requireAdminPool().query("ALTER TABLE compile_jobs ADD COLUMN permission_probe text");
      try {
        await expect(requireAdminPool().query(grantScript)).rejects.toThrow(
          /does not match the reviewed column shape/,
        );
      } finally {
        await requireAdminPool().query("ALTER TABLE compile_jobs DROP COLUMN permission_probe");
      }
      await requireAdminPool().query(grantScript);
    });

    it("refuses to install for a role that holds a membership", async () => {
      await requireAdminPool().query("CREATE ROLE depress_permission_probe_group NOLOGIN");
      await requireAdminPool().query("GRANT depress_permission_probe_group TO depress_outbox");
      try {
        await expect(requireAdminPool().query(grantScript)).rejects.toThrow(/role membership/);
      } finally {
        await requireAdminPool().query("REVOKE depress_permission_probe_group FROM depress_outbox");
        await requireAdminPool().query("DROP ROLE depress_permission_probe_group");
      }
      await requireAdminPool().query(grantScript);
    });

    it("refuses to install before the reviewed migrations are applied", async () => {
      await requireAdminPool().query("DELETE FROM schema_migrations WHERE name = $1", [
        "0006_artifact_lifecycle.sql",
      ]);
      try {
        await expect(requireAdminPool().query(grantScript)).rejects.toThrow(
          /reviewed migration\(s\) not applied/,
        );
      } finally {
        await requireAdminPool().query(
          "INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
          ["0006_artifact_lifecycle.sql"],
        );
      }
      await requireAdminPool().query(grantScript);
    });

    it("refuses to install for a role that owns the current database", async () => {
      // Checked per role, because a single owning runtime role is enough to
      // make the whole contract unenforceable.
      for (const role of RUNTIME_ROLES) {
        await requireAdminPool().query(`ALTER DATABASE ${databaseName} OWNER TO ${role}`);
        try {
          await expect(requireAdminPool().query(grantScript)).rejects.toThrow(
            new RegExp(`runtime role ${role} owns database`),
          );
          // The refusal must abort before any privilege is touched.
          expect(await columnGrantsFor(API_ROLE)).toEqual([
            ...EXPECTED_COLUMN_GRANTS[API_ROLE]!,
          ]);
        } finally {
          await requireAdminPool().query(`ALTER DATABASE ${databaseName} OWNER TO ${adminRole}`);
        }
      }
      await requireAdminPool().query(grantScript);
    });

    it("refuses to install for a role that owns schema public", async () => {
      for (const role of RUNTIME_ROLES) {
        await requireAdminPool().query(`ALTER SCHEMA public OWNER TO ${role}`);
        try {
          await expect(requireAdminPool().query(grantScript)).rejects.toThrow(
            new RegExp(`runtime role ${role} owns schema public`),
          );
          expect(await columnGrantsFor(API_ROLE)).toEqual([
            ...EXPECTED_COLUMN_GRANTS[API_ROLE]!,
          ]);
        } finally {
          await requireAdminPool().query(`ALTER SCHEMA public OWNER TO ${adminRole}`);
        }
      }
      await requireAdminPool().query(grantScript);
    });

    it("leaves depress_cleanup's installed contract untouched", async () => {
      // The SQL file legitimately names depress_cleanup in its comments to
      // document the boundary, so this is a catalog assertion rather than a
      // text match. Install the cleanup contract, rerun the runtime installer,
      // and prove the cleanup role's effective privileges are byte-identical.
      await requireAdminPool().query(
        `CREATE ROLE ${CLEANUP_ROLE}
         LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
         PASSWORD '${CLEANUP_ROLE_PASSWORD}'`,
      );
      try {
        const cleanupScript = await readCleanupGrantScript();
        await requireAdminPool().query(cleanupScript);

        const before = {
          columns: await columnGrantsFor(CLEANUP_ROLE),
          tables: await tableGrantsFor(CLEANUP_ROLE),
          database: await databasePrivilegesFor(CLEANUP_ROLE),
          schema: await schemaPrivilegesFor(CLEANUP_ROLE),
        };
        // The cleanup contract must be non-empty, otherwise an unchanged-but-
        // empty result would make this assertion vacuous.
        expect(before.columns.length).toBeGreaterThan(0);

        await requireAdminPool().query(grantScript);

        expect(await columnGrantsFor(CLEANUP_ROLE)).toEqual(before.columns);
        expect(await tableGrantsFor(CLEANUP_ROLE)).toEqual(before.tables);
        expect(await databasePrivilegesFor(CLEANUP_ROLE)).toEqual(before.database);
        expect(await schemaPrivilegesFor(CLEANUP_ROLE)).toEqual(before.schema);
      } finally {
        await requireAdminPool().query(`DROP OWNED BY ${CLEANUP_ROLE}`);
        await requireAdminPool().query(`DROP ROLE ${CLEANUP_ROLE}`);
      }
    });
  });
});
