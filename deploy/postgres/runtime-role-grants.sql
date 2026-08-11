-- Runtime role least-privilege installation.
--
-- This file is the canonical production privilege contract for the three
-- DePress runtime database roles:
--
--   depress_api             Fastify API and Better Auth runtime paths
--   depress_outbox          compile outbox publisher
--   depress_pointer_worker  persisted compile pointer worker
--
-- depress_cleanup is NOT governed here. It remains governed exclusively by
-- deploy/postgres/artifact-cleanup-grants.sql. This file never grants,
-- revokes, or otherwise reads privileges for depress_cleanup, and the two
-- installations are independent.
--
-- Production prerequisites are verified against the CONNECTED SERVER before any
-- privilege is granted, inside the same transaction as the grants, so a failed
-- prerequisite can never leave a partially installed permission state.
--
-- Run with ON_ERROR_STOP so a failed prerequisite also produces a nonzero exit:
--   psql -v ON_ERROR_STOP=1 -f deploy/postgres/runtime-role-grants.sql
--
-- Install AFTER application migrations. Every table and column named below is
-- created by migrations 0001-0006; running this before them fails closed on the
-- table-shape guard instead of installing a partial contract.
--
-- Re-running is safe and self-correcting: every privilege this file installs is
-- revoked first, so a privilege that drifted after the reviewed installation is
-- removed rather than accumulated.
--
-- This script never alters PUBLIC. Removing CREATE on schema public from
-- PUBLIC, and removing CONNECT/TEMPORARY on the database from PUBLIC, are
-- deliberate database-wide operator actions performed during database
-- provisioning. This script only refuses to install while either is still
-- present; it never performs those revocations itself.

BEGIN;

DO $prerequisites$
DECLARE
  connected_version integer := current_setting('server_version_num')::integer;
  runtime_roles constant text[] := ARRAY[
    'depress_api',
    'depress_outbox',
    'depress_pointer_worker'
  ];
  reviewed_migrations constant text[] := ARRAY[
    '0001_mentor_mvp_foundation.sql',
    '0002_better_auth.sql',
    '0003_project_owner_fk.sql',
    '0004_compile_jobs_outbox.sql',
    '0005_compile_job_processing_ownership.sql',
    '0006_artifact_lifecycle.sql'
  ];
  public_holds_create boolean;
  public_database_privileges text;
  runtime_role text;
  role_record record;
  membership_count integer;
  owned_relations text;
  sequence_names text;
  missing_migrations text;
  expected_shape record;
  actual_columns text[];
  expected_columns text[];
BEGIN
  IF connected_version < 150000 THEN
    RAISE EXCEPTION
      'runtime role production permissions require PostgreSQL 15 or newer; connected server is %',
      current_setting('server_version')
      USING HINT =
        'PostgreSQL 14 and older grant CREATE on schema public to PUBLIC by default, so every runtime role would inherit CREATE despite least-privilege grants. Provision the production database on PostgreSQL 15 or newer (16 is the validated version) and rerun this installation.';
  END IF;

  -- Server version alone is not sufficient: a database upgraded to 15+ keeps
  -- its historical public-schema ACL. Inspect the effective ACL instead, and
  -- fall back to the built-in default when nspacl has never been set.
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespaces
    CROSS JOIN LATERAL aclexplode(
      COALESCE(namespaces.nspacl, acldefault('n', namespaces.nspowner))
    ) AS schema_acl
    WHERE namespaces.nspname = 'public'
      AND schema_acl.grantee = 0
      AND schema_acl.privilege_type = 'CREATE'
  )
  INTO public_holds_create;

  IF public_holds_create THEN
    RAISE EXCEPTION
      'PUBLIC holds CREATE on schema public; runtime role least-privilege installation cannot continue'
      USING HINT =
        'Every runtime role would inherit CREATE through PUBLIC regardless of its own grants. Removing that privilege changes a database-wide privilege, so an operator must first confirm which roles still require explicit CREATE on schema public, harden the schema as a deliberate database-security action, then rerun this installation. This script never changes the PUBLIC ACL itself.';
  END IF;

  -- A freshly created database grants CONNECT and TEMPORARY to PUBLIC. Those
  -- database-wide privileges let any role in the cluster attach to the
  -- production database and read the catalog, which defeats the per-role
  -- boundary this file installs. Removing them is an operator provisioning
  -- action, not a side effect of installing runtime grants.
  SELECT string_agg(
      DISTINCT database_acl.privilege_type, ', ' ORDER BY database_acl.privilege_type
    )
    INTO public_database_privileges
    FROM pg_catalog.pg_database AS databases
    CROSS JOIN LATERAL aclexplode(
      COALESCE(databases.datacl, acldefault('d', databases.datdba))
    ) AS database_acl
    WHERE databases.datname = current_database()
      AND database_acl.grantee = 0;

  IF public_database_privileges IS NOT NULL THEN
    RAISE EXCEPTION
      'PUBLIC holds % on database %; runtime role least-privilege installation cannot continue',
      public_database_privileges, current_database()
      USING HINT =
        'Any cluster role could connect to the production database and read its catalog regardless of these grants. Revoking CONNECT and TEMPORARY from PUBLIC changes a database-wide privilege, so an operator must perform it deliberately during database provisioning and explicitly grant CONNECT to each approved DePress login role, then rerun this installation. This script never changes the PUBLIC ACL itself.';
  END IF;

  FOREACH runtime_role IN ARRAY runtime_roles LOOP
    SELECT * INTO role_record
      FROM pg_catalog.pg_roles
      WHERE rolname = runtime_role;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'required role % does not exist', runtime_role;
    END IF;

    IF NOT role_record.rolcanlogin THEN
      RAISE EXCEPTION 'runtime role % must be a LOGIN role', runtime_role;
    END IF;

    IF role_record.rolsuper
      OR role_record.rolcreatedb
      OR role_record.rolcreaterole
      OR role_record.rolreplication
      OR role_record.rolbypassrls
    THEN
      RAISE EXCEPTION
        'runtime role % holds a privileged role attribute', runtime_role
        USING HINT =
          'Runtime roles must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION and must not bypass row-level security. Recreate the role with the reviewed attributes before installing runtime privileges.';
    END IF;

    -- Zero memberships is the property that makes the grants below the whole
    -- of the role's authority. It also makes the role's INHERIT setting
    -- irrelevant, so this file deliberately does not constrain rolinherit.
    SELECT count(*) INTO membership_count
      FROM pg_catalog.pg_auth_members AS memberships
      WHERE memberships.member = role_record.oid;

    IF membership_count <> 0 THEN
      RAISE EXCEPTION
        'runtime role % holds % role membership(s)', runtime_role, membership_count
        USING HINT =
          'A runtime role must hold no role membership, otherwise it can reach privileges this contract never granted. Revoke the membership before installing runtime privileges. This script never mutates role membership.';
    END IF;

    SELECT string_agg(relations.relname, ', ' ORDER BY relations.relname)
      INTO owned_relations
      FROM pg_catalog.pg_class AS relations
      JOIN pg_catalog.pg_namespace AS namespaces
        ON namespaces.oid = relations.relnamespace
      WHERE namespaces.nspname = 'public'
        AND relations.relowner = role_record.oid;

    IF owned_relations IS NOT NULL THEN
      RAISE EXCEPTION
        'runtime role % owns relation(s) in schema public: %', runtime_role, owned_relations
        USING HINT =
          'An owner holds implicit full privileges and DDL rights on what it owns, which no runtime role may have. Application objects must be owned by the non-login database owner role. This script never changes object ownership.';
    END IF;

    -- Database ownership is authority that no REVOKE below can remove: a
    -- database owner may ALTER the database and re-grant privileges to itself.
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_database AS databases
      WHERE databases.datname = current_database()
        AND databases.datdba = role_record.oid
    ) THEN
      RAISE EXCEPTION
        'runtime role % owns database %', runtime_role, current_database()
        USING HINT =
          'A database owner retains ALTER DATABASE and grant authority regardless of the table privileges installed here, so the least-privilege contract would be unenforceable. Reassign the database to the non-login database owner role as a deliberate operator action, then rerun this installation. This script never changes ownership.';
    END IF;

    -- Schema ownership is likewise retained authority: an owner of schema
    -- public may CREATE in it and re-grant schema privileges to itself, which
    -- would defeat the no-DDL boundary this contract installs.
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS namespaces
      WHERE namespaces.nspname = 'public'
        AND namespaces.nspowner = role_record.oid
    ) THEN
      RAISE EXCEPTION
        'runtime role % owns schema public', runtime_role
        USING HINT =
          'An owner of schema public may create objects in it and re-grant schema privileges to itself, so revoking CREATE from the role cannot bind it. Reassign schema public to the non-login database owner role as a deliberate operator action, then rerun this installation. This script never changes ownership.';
    END IF;
  END LOOP;

  IF to_regclass('public.schema_migrations') IS NULL THEN
    RAISE EXCEPTION
      'schema_migrations is missing; application migrations have not been applied'
      USING HINT =
        'Runtime privileges reference tables and columns created by migrations 0001-0006. Run the reviewed migration entrypoint against this database first, then rerun this installation.';
  END IF;

  SELECT string_agg(expected_migration, ', ' ORDER BY expected_migration)
    INTO missing_migrations
    FROM unnest(reviewed_migrations) AS expected_migration
    WHERE NOT EXISTS (
      SELECT 1 FROM schema_migrations WHERE schema_migrations.name = expected_migration
    );

  IF missing_migrations IS NOT NULL THEN
    RAISE EXCEPTION
      'reviewed migration(s) not applied: %', missing_migrations
      USING HINT =
        'This privilege contract was reviewed against migrations 0001-0006. Apply the outstanding migrations through the reviewed migration entrypoint, then rerun this installation.';
  END IF;

  -- No sequence exists in the reviewed schema: every primary key is a uuid or
  -- text value supplied by the application. The contract therefore grants no
  -- sequence privilege at all. A sequence appearing later would mean some
  -- runtime path needs USAGE that was never reviewed, so refuse instead.
  SELECT string_agg(relations.relname, ', ' ORDER BY relations.relname)
    INTO sequence_names
    FROM pg_catalog.pg_class AS relations
    JOIN pg_catalog.pg_namespace AS namespaces
      ON namespaces.oid = relations.relnamespace
    WHERE namespaces.nspname = 'public'
      AND relations.relkind = 'S';

  IF sequence_names IS NOT NULL THEN
    RAISE EXCEPTION
      'schema public contains unreviewed sequence(s): %', sequence_names
      USING HINT =
        'The reviewed schema has no sequences, so this contract grants no sequence privileges. A new sequence means some runtime write path may need USAGE. Review the runtime privilege contract before installing.';
  END IF;

  -- Exact column-shape guard. The reviewed grants below enumerate columns, so a
  -- migration that adds, removes, or renames a column must fail closed here and
  -- force a privilege review rather than silently widening a table-level grant
  -- or silently breaking a column-level one. This is the mechanism that keeps
  -- Better Auth's selectAll()/returningAll() column grants honest.
  FOR expected_shape IN
    SELECT * FROM (
      VALUES
        ('projects', ARRAY[
          'id', 'owner_user_id', 'name', 'is_default', 'created_at', 'updated_at'
        ]),
        ('documents', ARRAY[
          'id', 'project_id', 'envelope_json', 'revision', 'content_hash',
          'created_at', 'updated_at'
        ]),
        ('project_references', ARRAY[
          'project_id', 'cite_key', 'item_json', 'created_at', 'updated_at'
        ]),
        ('compile_jobs', ARRAY[
          'id', 'project_id', 'document_id', 'requested_revision', 'template_id',
          'format', 'input_snapshot', 'snapshot_hash', 'status', 'error_code',
          'artifact_key', 'created_at', 'updated_at', 'processing_token',
          'processing_started_at', 'artifact_byte_length', 'expires_at',
          'artifact_cleanup_token', 'artifact_cleanup_started_at',
          'artifact_deleted_at'
        ]),
        ('compile_outbox', ARRAY[
          'id', 'job_id', 'snapshot_hash', 'created_at', 'published_at',
          'attempt_count', 'last_error_code'
        ]),
        ('user', ARRAY[
          'id', 'name', 'email', 'emailVerified', 'image', 'createdAt',
          'updatedAt'
        ]),
        ('session', ARRAY[
          'id', 'expiresAt', 'token', 'createdAt', 'updatedAt', 'ipAddress',
          'userAgent', 'userId'
        ]),
        ('account', ARRAY[
          'id', 'accountId', 'providerId', 'userId', 'accessToken',
          'refreshToken', 'idToken', 'accessTokenExpiresAt',
          'refreshTokenExpiresAt', 'scope', 'password', 'createdAt', 'updatedAt'
        ]),
        ('verification', ARRAY[
          'id', 'identifier', 'value', 'expiresAt', 'createdAt', 'updatedAt'
        ])
    ) AS shape(table_name, columns)
  LOOP
    IF to_regclass(format('public.%I', expected_shape.table_name)) IS NULL THEN
      RAISE EXCEPTION
        'required table public.% is missing', expected_shape.table_name
        USING HINT =
          'Apply the reviewed application migrations before installing runtime privileges.';
    END IF;

    SELECT array_agg(attributes.attname::text ORDER BY attributes.attname)
      INTO actual_columns
      FROM pg_catalog.pg_attribute AS attributes
      WHERE attributes.attrelid = format('public.%I', expected_shape.table_name)::regclass
        AND attributes.attnum > 0
        AND NOT attributes.attisdropped;

    SELECT array_agg(expected_column ORDER BY expected_column)
      INTO expected_columns
      FROM unnest(expected_shape.columns) AS expected_column;

    IF actual_columns IS DISTINCT FROM expected_columns THEN
      RAISE EXCEPTION
        'table public.% does not match the reviewed column shape; reviewed [%], connected server has [%]',
        expected_shape.table_name,
        array_to_string(expected_columns, ', '),
        array_to_string(actual_columns, ', ')
        USING HINT =
          'The runtime privilege contract enumerates columns. A changed table shape must be reviewed against the runtime SQL paths, and this file updated, before privileges are installed. Installing the old contract against a new schema would either silently break a runtime path or silently widen access.';
    END IF;
  END LOOP;

  -- Database-level privileges. Revoke first so a drifted TEMPORARY or CREATE
  -- grant is removed, then grant only CONNECT.
  FOREACH runtime_role IN ARRAY runtime_roles LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), runtime_role);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), runtime_role);
  END LOOP;
END
$prerequisites$;

-- Clear any previously installed or drifted privilege before granting. Revoking
-- a table privilege also revokes the matching column privileges, so this
-- reduces the three runtime roles to exactly the grants that follow.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM depress_api, depress_outbox, depress_pointer_worker;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM depress_api, depress_outbox, depress_pointer_worker;
REVOKE ALL PRIVILEGES ON SCHEMA public
  FROM depress_api, depress_outbox, depress_pointer_worker;

GRANT USAGE ON SCHEMA public
  TO depress_api, depress_outbox, depress_pointer_worker;

-- ---------------------------------------------------------------------------
-- depress_api
--
-- Sources: db/project-repository.ts, db/document-repository.ts,
-- db/reference-repository.ts, db/compile-job-repository.ts, auth/seed-mentor.ts,
-- and Better Auth through auth/auth.ts.
--
-- The API deliberately receives no UPDATE on compile_jobs: it creates jobs and
-- reads their owner-visible state, and never advances job state, artifact keys,
-- or expiry. It also receives no SELECT on compile_jobs.input_snapshot, and no
-- read access at all to compile_outbox.
-- ---------------------------------------------------------------------------

GRANT SELECT (
  id,
  owner_user_id,
  name,
  is_default,
  created_at,
  updated_at
) ON TABLE projects TO depress_api;
GRANT INSERT (
  id,
  owner_user_id,
  name,
  is_default
) ON TABLE projects TO depress_api;

GRANT SELECT (
  id,
  project_id,
  envelope_json,
  revision,
  content_hash,
  created_at,
  updated_at
) ON TABLE documents TO depress_api;
GRANT INSERT (
  id,
  project_id,
  envelope_json,
  revision,
  content_hash
) ON TABLE documents TO depress_api;
-- Also satisfies the row lock taken by the compile snapshot read
-- (SELECT ... FOR SHARE), which requires UPDATE on at least one column.
GRANT UPDATE (
  envelope_json,
  content_hash,
  revision,
  updated_at
) ON TABLE documents TO depress_api;

GRANT SELECT (
  project_id,
  cite_key,
  item_json,
  created_at,
  updated_at
) ON TABLE project_references TO depress_api;
GRANT INSERT (
  project_id,
  cite_key,
  item_json
) ON TABLE project_references TO depress_api;
GRANT UPDATE (
  item_json,
  updated_at
) ON TABLE project_references TO depress_api;
-- PostgreSQL has no column-level DELETE.
GRANT DELETE ON TABLE project_references TO depress_api;

GRANT SELECT (
  id,
  project_id,
  document_id,
  requested_revision,
  template_id,
  format,
  snapshot_hash,
  status,
  created_at,
  updated_at,
  artifact_key,
  expires_at,
  artifact_deleted_at
) ON TABLE compile_jobs TO depress_api;
GRANT INSERT (
  id,
  project_id,
  document_id,
  requested_revision,
  template_id,
  format,
  input_snapshot,
  snapshot_hash,
  status
) ON TABLE compile_jobs TO depress_api;

GRANT INSERT (
  id,
  job_id,
  snapshot_hash
) ON TABLE compile_outbox TO depress_api;

-- Better Auth generates its own SQL through the Kysely adapter and expands
-- selectAll()/returningAll() over every current column, so the API needs every
-- column of the four auth tables that its enabled flows touch. The grants are
-- still written column by column against the reviewed schema: a future auth
-- schema column must fail closed on the shape guard above and be reviewed,
-- rather than being silently readable or writable through a table-level grant.
GRANT SELECT (
  id,
  name,
  email,
  "emailVerified",
  image,
  "createdAt",
  "updatedAt"
) ON TABLE "user" TO depress_api;
GRANT INSERT (
  id,
  name,
  email,
  "emailVerified",
  image,
  "createdAt",
  "updatedAt"
) ON TABLE "user" TO depress_api;
GRANT UPDATE (
  id,
  name,
  email,
  "emailVerified",
  image,
  "createdAt",
  "updatedAt"
) ON TABLE "user" TO depress_api;

GRANT SELECT (
  id,
  "expiresAt",
  token,
  "createdAt",
  "updatedAt",
  "ipAddress",
  "userAgent",
  "userId"
) ON TABLE "session" TO depress_api;
GRANT INSERT (
  id,
  "expiresAt",
  token,
  "createdAt",
  "updatedAt",
  "ipAddress",
  "userAgent",
  "userId"
) ON TABLE "session" TO depress_api;
GRANT UPDATE (
  id,
  "expiresAt",
  token,
  "createdAt",
  "updatedAt",
  "ipAddress",
  "userAgent",
  "userId"
) ON TABLE "session" TO depress_api;
-- Sign-out and session revocation delete session rows.
GRANT DELETE ON TABLE "session" TO depress_api;

GRANT SELECT (
  id,
  "accountId",
  "providerId",
  "userId",
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  scope,
  password,
  "createdAt",
  "updatedAt"
) ON TABLE "account" TO depress_api;
GRANT INSERT (
  id,
  "accountId",
  "providerId",
  "userId",
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  scope,
  password,
  "createdAt",
  "updatedAt"
) ON TABLE "account" TO depress_api;
GRANT UPDATE (
  id,
  "accountId",
  "providerId",
  "userId",
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  scope,
  password,
  "createdAt",
  "updatedAt"
) ON TABLE "account" TO depress_api;

GRANT SELECT (
  id,
  identifier,
  value,
  "expiresAt",
  "createdAt",
  "updatedAt"
) ON TABLE "verification" TO depress_api;
GRANT INSERT (
  id,
  identifier,
  value,
  "expiresAt",
  "createdAt",
  "updatedAt"
) ON TABLE "verification" TO depress_api;
GRANT UPDATE (
  id,
  identifier,
  value,
  "expiresAt",
  "createdAt",
  "updatedAt"
) ON TABLE "verification" TO depress_api;
-- Expired verification tokens are consumed by deletion.
GRANT DELETE ON TABLE "verification" TO depress_api;

-- No DELETE on "user" or "account": the enabled Mentor MVP flows are
-- invite-only email/password sign-in, session lifecycle, and password change.
-- None of them removes a user or a credential row.

-- ---------------------------------------------------------------------------
-- depress_outbox
--
-- Source: services/compile-outbox-publisher.ts. Two tables, four writable
-- columns, no access to projects, documents, references, or auth data.
-- ---------------------------------------------------------------------------

GRANT SELECT (
  id,
  job_id,
  snapshot_hash,
  created_at,
  published_at,
  attempt_count
) ON TABLE compile_outbox TO depress_outbox;
-- Also satisfies the batch claim's SELECT ... FOR UPDATE SKIP LOCKED.
-- last_error_code is written but never read, so it carries no SELECT grant.
GRANT UPDATE (
  published_at,
  attempt_count,
  last_error_code
) ON TABLE compile_outbox TO depress_outbox;

GRANT SELECT (
  id,
  status
) ON TABLE compile_jobs TO depress_outbox;
GRANT UPDATE (
  status,
  updated_at
) ON TABLE compile_jobs TO depress_outbox;

-- ---------------------------------------------------------------------------
-- depress_pointer_worker
--
-- Source: db/compile-execution-repository.ts. The worker is the only DePress
-- identity allowed to use Docker and the only one that executes untrusted
-- document content, so its database reach is one table. It never reads auth,
-- project, document, or reference data, and never touches the three artifact
-- cleanup columns owned by artifact-cleanup-grants.sql.
-- ---------------------------------------------------------------------------

GRANT SELECT (
  id,
  input_snapshot,
  snapshot_hash,
  status,
  processing_started_at,
  processing_token
) ON TABLE compile_jobs TO depress_pointer_worker;
GRANT UPDATE (
  status,
  error_code,
  processing_token,
  processing_started_at,
  updated_at,
  artifact_key,
  artifact_byte_length,
  expires_at
) ON TABLE compile_jobs TO depress_pointer_worker;

COMMIT;
