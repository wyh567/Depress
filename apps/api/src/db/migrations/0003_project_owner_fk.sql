DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM projects
    LEFT JOIN "user" ON "user".id = projects.owner_user_id
    WHERE "user".id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'Cannot add projects_owner_user_id_fk: orphan projects exist';
  END IF;
END
$migration$;

ALTER TABLE projects
  ADD CONSTRAINT projects_owner_user_id_fk
  FOREIGN KEY (owner_user_id)
  REFERENCES "user"(id)
  ON DELETE CASCADE;
