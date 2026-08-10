ALTER TABLE compile_jobs
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN artifact_cleanup_token uuid,
  ADD COLUMN artifact_cleanup_started_at timestamptz,
  ADD COLUMN artifact_deleted_at timestamptz;

UPDATE compile_jobs
SET expires_at = updated_at + interval '7 days'
WHERE status = 'succeeded';

ALTER TABLE compile_jobs
  ADD CONSTRAINT compile_jobs_artifact_expiry_check
    CHECK ((status = 'succeeded') = (expires_at IS NOT NULL)),
  ADD CONSTRAINT compile_jobs_artifact_cleanup_pair_check
    CHECK (
      (artifact_cleanup_token IS NULL) =
      (artifact_cleanup_started_at IS NULL)
    ),
  ADD CONSTRAINT compile_jobs_artifact_cleanup_claim_check
    CHECK (
      artifact_cleanup_token IS NULL OR (
        status = 'succeeded' AND
        artifact_deleted_at IS NULL
      )
    ),
  ADD CONSTRAINT compile_jobs_artifact_deleted_check
    CHECK (
      artifact_deleted_at IS NULL OR status = 'succeeded'
    );

CREATE INDEX compile_jobs_artifact_cleanup_candidates_idx
  ON compile_jobs (expires_at, artifact_cleanup_started_at, id)
  WHERE status = 'succeeded' AND artifact_deleted_at IS NULL;
