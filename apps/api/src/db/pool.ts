import { Pool } from "pg";

const DATABASE_URL_REQUIRED = "DATABASE_URL is required";

export function createPostgresPool(
  connectionString: string | undefined = process.env["DATABASE_URL"]
): Pool {
  if (!connectionString) throw new Error(DATABASE_URL_REQUIRED);
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
