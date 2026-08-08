import { createPostgresPool } from "./pool";
import { runMigrations } from "./migrate";

async function main(): Promise<void> {
  const pool = createPostgresPool();
  try {
    const result = await runMigrations(pool);
    console.log(`Applied ${result.applied.length} migration(s)`);
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("Database migration failed");
  process.exit(1);
});
