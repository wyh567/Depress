CREATE TABLE projects (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL CHECK (length(btrim(owner_user_id)) > 0),
  name text NOT NULL DEFAULT 'Default Project' CHECK (length(btrim(name)) > 0),
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX projects_one_default_per_user
  ON projects (owner_user_id)
  WHERE is_default;

CREATE TABLE documents (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  envelope_json jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((envelope_json ->> 'schemaVersion') = '1')
);

CREATE INDEX documents_project_updated
  ON documents (project_id, updated_at DESC, id);

CREATE TABLE project_references (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cite_key text NOT NULL CHECK (length(btrim(cite_key)) > 0),
  item_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, cite_key)
);

CREATE INDEX project_references_project_updated
  ON project_references (project_id, updated_at DESC, cite_key);
