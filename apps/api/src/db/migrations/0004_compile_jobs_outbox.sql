CREATE TABLE compile_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL
    REFERENCES documents(id) ON DELETE CASCADE,
  requested_revision integer NOT NULL CHECK (requested_revision > 0),
  template_id text NOT NULL
    CHECK (template_id IN ('ieee', 'elsevier', 'gbt7714')),
  format text NOT NULL CHECK (format = 'pdf'),
  input_snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL
    CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'queued', 'processing', 'succeeded', 'failed')),
  error_code text,
  artifact_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX compile_jobs_project_status_created
  ON compile_jobs (project_id, status, created_at, id);

CREATE TABLE compile_outbox (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE
    REFERENCES compile_jobs(id) ON DELETE CASCADE,
  snapshot_hash text NOT NULL
    CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text
    CHECK (last_error_code IS NULL OR last_error_code = 'QUEUE_UNAVAILABLE')
);

CREATE INDEX compile_outbox_unpublished_created
  ON compile_outbox (created_at, id)
  WHERE published_at IS NULL;
