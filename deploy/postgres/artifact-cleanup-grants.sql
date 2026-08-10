-- Artifact cleanup least-privilege installation.
--
-- Production prerequisites are verified against the CONNECTED SERVER before any
-- privilege is granted, inside the same transaction as the grants, so a failed
-- prerequisite can never leave a partially installed permission state.
--
-- Run with ON_ERROR_STOP so a failed prerequisite also produces a nonzero exit:
--   psql -v ON_ERROR_STOP=1 -f deploy/postgres/artifact-cleanup-grants.sql
--
-- This script never alters PUBLIC or any other role's privileges. Hardening the
-- public schema is a deliberate database-wide operator action, not a side
-- effect of installing the cleanup role.

BEGIN;

DO $prerequisites$
DECLARE
  connected_version integer := current_setting('server_version_num')::integer;
  public_holds_create boolean;
BEGIN
  IF connected_version < 150000 THEN
    RAISE EXCEPTION
      'artifact cleanup production permissions require PostgreSQL 15 or newer; connected server is %',
      current_setting('server_version')
      USING HINT =
        'PostgreSQL 14 and older grant CREATE on schema public to PUBLIC by default, so depress_cleanup would inherit CREATE despite least-privilege grants. Provision the production database on PostgreSQL 15 or newer (16 is the validated version) and rerun this installation.';
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
      'PUBLIC holds CREATE on schema public; artifact cleanup least-privilege installation cannot continue'
      USING HINT =
        'depress_cleanup would inherit CREATE through PUBLIC regardless of its own grants. Removing that privilege changes a database-wide privilege, so an operator must first confirm which roles still require explicit CREATE on schema public, harden the schema as a deliberate database-security action, then rerun this installation. This script never changes the PUBLIC ACL itself.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'depress_cleanup') THEN
    RAISE EXCEPTION 'required role depress_cleanup does not exist';
  END IF;

  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO depress_cleanup',
    current_database()
  );
END
$prerequisites$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM depress_cleanup;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM depress_cleanup;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM depress_cleanup;

GRANT USAGE ON SCHEMA public TO depress_cleanup;
GRANT SELECT (
  id,
  status,
  expires_at,
  artifact_cleanup_token,
  artifact_cleanup_started_at,
  artifact_deleted_at,
  artifact_key,
  artifact_byte_length
) ON TABLE compile_jobs TO depress_cleanup;
GRANT UPDATE (
  artifact_cleanup_token,
  artifact_cleanup_started_at,
  artifact_deleted_at
) ON TABLE compile_jobs TO depress_cleanup;

COMMIT;
