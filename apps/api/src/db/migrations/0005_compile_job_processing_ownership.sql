ALTER TABLE compile_jobs
  ADD COLUMN processing_token uuid,
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN artifact_byte_length integer;

ALTER TABLE compile_jobs
  ADD CONSTRAINT compile_jobs_error_code_check
    CHECK (
      error_code IS NULL OR error_code IN (
        'QUEUE_UNAVAILABLE',
        'SNAPSHOT_HASH_MISMATCH',
        'SNAPSHOT_INVALID',
        'COMPILE_FAILED',
        'UPLOAD_FAILED',
        'JOB_STATE_INVALID'
      )
    ),
  ADD CONSTRAINT compile_jobs_processing_ownership_check
    CHECK (
      (status = 'processing') =
      (processing_token IS NOT NULL AND processing_started_at IS NOT NULL)
    ),
  ADD CONSTRAINT compile_jobs_succeeded_artifact_check
    CHECK (
      status <> 'succeeded' OR (
        artifact_key IS NOT NULL AND
        artifact_byte_length IS NOT NULL AND
        artifact_byte_length >= 5 AND
        error_code IS NULL
      )
    ),
  ADD CONSTRAINT compile_jobs_failed_error_check
    CHECK (
      status <> 'failed' OR (
        error_code IS NOT NULL AND
        artifact_key IS NULL AND
        artifact_byte_length IS NULL
      )
    );

CREATE INDEX compile_jobs_processing_started_idx
  ON compile_jobs (processing_started_at)
  WHERE status = 'processing';
