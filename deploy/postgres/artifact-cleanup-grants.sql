BEGIN;

DO $grant_connect$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'depress_cleanup') THEN
    RAISE EXCEPTION 'required role depress_cleanup does not exist';
  END IF;
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO depress_cleanup',
    current_database()
  );
END
$grant_connect$;

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
