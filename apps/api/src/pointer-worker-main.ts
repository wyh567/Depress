import { createPostgresPool } from "./db/pool";
import { parsePointerWorkerEnv, redisConnection } from "./env";
import { startCompilePointerWorker } from "./workers/compile-pointer-worker";

async function main(): Promise<void> {
  const env = parsePointerWorkerEnv(process.env);
  const pool = createPostgresPool(env.DATABASE_URL);
  const worker = await startCompilePointerWorker({
    connection: redisConnection(env),
    pool,
    concurrency: env.POINTER_WORKER_CONCURRENCY,
    typstImage: env.TYPST_IMAGE,
    ...(env.TYPST_FONT_PATH ? { typstFontDirectory: env.TYPST_FONT_PATH } : {}),
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
