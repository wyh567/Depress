import { createPostgresPool } from "./db/pool";
import { parseRuntimeEnv, redisConnection } from "./env";
import { startCompilePointerWorker } from "./workers/compile-pointer-worker";

async function main(): Promise<void> {
  const env = parseRuntimeEnv(process.env);
  const pool = createPostgresPool(env.DATABASE_URL);
  const worker = await startCompilePointerWorker({
    connection: redisConnection(env),
    pool,
  });
  console.log("DePress persisted compile pointer worker started");

  const close = async () => {
    await worker.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
