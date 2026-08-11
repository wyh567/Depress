import { Client } from "pg";

/**
 * Fail-closed guard for the opt-in permission integration suites.
 *
 * These suites create and drop production-named PostgreSQL roles and apply
 * migrations, so a mistargeted connection string would be destructive against a
 * provisioned DePress database. No single signal is trusted: the guard layers an
 * explicit opt-in, a loopback-only host, an exact validation server version, a
 * database-name rule, a cluster role fingerprint, and an application table
 * fingerprint, and every layer must pass before the caller performs its first
 * mutation.
 *
 * Two kinds of target exist and are validated separately, because a suite may
 * connect administratively to one database and then apply migrations to another:
 *
 * - ADMIN CONNECTION DATABASE (`requireDisposablePostgresTarget`)
 *   The database the administrative connection attaches to, for example
 *   `postgres`. It may be a maintenance database, so it is never required to
 *   carry a disposable application name and is never fingerprinted for
 *   application tables. It must still be a loopback PostgreSQL 16 server, must
 *   not be the production database, must not authenticate as a DePress role, and
 *   must belong to a cluster that has no provisioned DePress role.
 *
 * - DISPOSABLE APPLICATION DATABASE (`requireDisposableApplicationDatabase`)
 *   The database that actually receives migrations, application tables, and
 *   privilege installation. It must additionally announce a disposable identity
 *   in its own name and must contain no DePress application table yet.
 *
 * A suite that uses its administrative connection database as the application
 * target calls both functions before mutating anything. A consequence of the
 * application fingerprint layer is that such a suite is single-shot per database:
 * once it has applied migrations, the same database is refused on a later run.
 * That is deliberate; use a fresh disposable database or container.
 */

export const PERMISSION_TEST_FLAG = "DEPRESS_POSTGRES_PERMISSION_TEST";

/** An empty host is a local socket connection. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", ""]);

/** The production database name, per deploy/ and docker-compose.yml. */
const PRODUCTION_DATABASE_NAME = "depress";

/**
 * A database that receives migrations and production-named roles must announce a
 * disposable identity in its own name. This matches the name the runtime
 * permission suite generates for itself (`depress_runtime_perm_<hex>`, carrying
 * the `perm` marker) rather than an unrelated convention, and an operator
 * supplied target must carry one of the same markers.
 */
const DISPOSABLE_DATABASE_MARKER =
  /(?:^|_)(?:perm|permission|permissions|test|tests|tmp|temp|scratch|disposable)(?:_|$)/;

/**
 * Every DePress role whose presence means the cluster is provisioned or
 * production-like. This is deliberately the complete set rather than only the
 * roles a given suite intends to create: a partially provisioned cluster is
 * still not a disposable target.
 */
const PROVISIONED_DEPRESS_ROLES = [
  "depress_db_owner",
  "depress_migration",
  "depress_api",
  "depress_outbox",
  "depress_pointer_worker",
  "depress_cleanup",
] as const;

/**
 * Catalog fingerprint of a database that already carries DePress application
 * state. Existence is checked through the catalog only; no application row is
 * ever read.
 */
const APPLICATION_FINGERPRINT_TABLES = [
  "schema_migrations",
  "projects",
  "documents",
  "project_references",
  "user",
  "session",
  "account",
  "verification",
  "compile_jobs",
  "compile_outbox",
] as const;

/** The permission contract is validated against PostgreSQL 16 only. */
const MINIMUM_SERVER_VERSION_NUM = 160_000;
const UNSUPPORTED_SERVER_VERSION_NUM = 170_000;

export class ProductionLikeTestTargetError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to run a permission test against a production-like PostgreSQL target: ${reason}`,
    );
    this.name = "ProductionLikeTestTargetError";
  }
}

export interface PostgresTargetOptions {
  /** Connection string under test. */
  connectionString: string;
}

/** Database name carried by a connection string, empty when it omits one. */
export function databaseNameFromConnectionString(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new ProductionLikeTestTargetError(
      "the connection string is not a parsable URL, so its target cannot be verified",
    );
  }
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

export function assertPermissionTestOptIn(): void {
  if (process.env[PERMISSION_TEST_FLAG] !== "1") {
    throw new ProductionLikeTestTargetError(
      `${PERMISSION_TEST_FLAG}=1 is not set. Permission suites create and drop production-named roles and must be opted into explicitly against a disposable server.`,
    );
  }
}

export function assertLoopbackHost(connectionString: string): void {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    throw new ProductionLikeTestTargetError(
      "the connection string is not a parsable URL, so its host cannot be verified",
    );
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new ProductionLikeTestTargetError(
      `host ${host} is not loopback. Permission suites may only target a disposable local PostgreSQL server.`,
    );
  }
}

/** Refuses the production database name for any target kind. */
export function assertNotProductionDatabaseName(databaseName: string, context: string): void {
  if (databaseName === PRODUCTION_DATABASE_NAME) {
    throw new ProductionLikeTestTargetError(
      `${context} names database "${PRODUCTION_DATABASE_NAME}", which is the production database name. Permission suites may never target it.`,
    );
  }
}

/** Refuses an application target that does not announce a disposable identity. */
export function assertDisposableDatabaseName(databaseName: string, context: string): void {
  assertNotProductionDatabaseName(databaseName, context);
  if (!databaseName) {
    throw new ProductionLikeTestTargetError(
      `${context} does not name a database, so its disposable identity cannot be verified. Name a disposable database explicitly.`,
    );
  }
  if (!DISPOSABLE_DATABASE_MARKER.test(databaseName)) {
    throw new ProductionLikeTestTargetError(
      `${context} names database "${databaseName}", which carries no disposable identity. A database that receives migrations and production-named roles must announce itself, for example "depress_runtime_perm_<id>" or "depress_cleanup_perm_test".`,
    );
  }
}

async function assertValidationServerVersion(client: Client): Promise<void> {
  const version = await client.query<{ server_version_num: string }>(
    "SELECT current_setting('server_version_num') AS server_version_num",
  );
  const serverVersionNum = Number(version.rows[0]?.server_version_num ?? "0");
  if (
    !Number.isInteger(serverVersionNum) ||
    serverVersionNum < MINIMUM_SERVER_VERSION_NUM ||
    serverVersionNum >= UNSUPPORTED_SERVER_VERSION_NUM
  ) {
    throw new ProductionLikeTestTargetError(
      `connected server_version_num ${serverVersionNum} is not PostgreSQL 16.x. The permission contract is reviewed and validated against PostgreSQL 16; validating it on another major version would prove a different privilege model.`,
    );
  }
}

async function assertAdministrativeIdentity(client: Client): Promise<void> {
  const identity = await client.query<{ current_user: string }>("SELECT current_user");
  const connectedRole = identity.rows[0]?.current_user ?? "";
  if ((PROVISIONED_DEPRESS_ROLES as readonly string[]).includes(connectedRole)) {
    throw new ProductionLikeTestTargetError(
      `the connection authenticates as DePress role ${connectedRole}. An administrative test connection must never use a DePress application or provisioning credential.`,
    );
  }
}

async function assertNoProvisionedDepressRoles(client: Client): Promise<void> {
  const provisioned = await client.query<{ rolname: string }>(
    "SELECT rolname FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname",
    [[...PROVISIONED_DEPRESS_ROLES]],
  );
  if (provisioned.rows.length > 0) {
    const found = provisioned.rows.map((row) => row.rolname).join(", ");
    throw new ProductionLikeTestTargetError(
      `the cluster already has DePress role(s) ${found}. Permission suites create and drop production-named roles, so they refuse to adopt roles they did not create. Use a clean disposable server or drop them first.`,
    );
  }
}

async function assertNoApplicationFingerprint(client: Client): Promise<void> {
  const present = await client.query<{ present: string | null }>(
    `
      SELECT string_agg(candidate.table_name, ', ' ORDER BY candidate.table_name) AS present
      FROM unnest($1::text[]) AS candidate(table_name)
      WHERE to_regclass(format('public.%I', candidate.table_name)) IS NOT NULL
    `,
    [[...APPLICATION_FINGERPRINT_TABLES]],
  );
  const found = present.rows[0]?.present ?? null;
  if (found) {
    throw new ProductionLikeTestTargetError(
      `database ${await currentDatabase(client)} already contains DePress application table(s) ${found}. A disposable application target must be empty before migrations run, so this target is production-like.`,
    );
  }
}

async function currentDatabase(client: Client): Promise<string> {
  const result = await client.query<{ current_database: string }>(
    "SELECT current_database()",
  );
  return result.rows[0]?.current_database ?? "";
}

async function withGuardClient(
  connectionString: string,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Validates the administrative cluster connection. Throws before the caller
 * performs any mutation, including CREATE DATABASE, CREATE ROLE, and DROP ROLE.
 */
export async function requireDisposablePostgresTarget(
  options: PostgresTargetOptions,
): Promise<void> {
  assertPermissionTestOptIn();
  assertLoopbackHost(options.connectionString);
  assertNotProductionDatabaseName(
    databaseNameFromConnectionString(options.connectionString),
    "the connection string",
  );

  await withGuardClient(options.connectionString, async (client) => {
    await assertValidationServerVersion(client);
    assertNotProductionDatabaseName(await currentDatabase(client), "the connected server");
    await assertAdministrativeIdentity(client);
    await assertNoProvisionedDepressRoles(client);
  });
}

/**
 * Validates the disposable database that will receive migrations, application
 * tables, and privilege installation. Throws before the caller runs migrations.
 */
export async function requireDisposableApplicationDatabase(
  options: PostgresTargetOptions,
): Promise<void> {
  assertPermissionTestOptIn();
  assertLoopbackHost(options.connectionString);
  assertDisposableDatabaseName(
    databaseNameFromConnectionString(options.connectionString),
    "the connection string",
  );

  await withGuardClient(options.connectionString, async (client) => {
    await assertValidationServerVersion(client);
    assertDisposableDatabaseName(await currentDatabase(client), "the connected server");
    await assertNoApplicationFingerprint(client);
  });
}
