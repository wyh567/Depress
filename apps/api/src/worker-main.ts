import { parseLegacyWorkerEnv, redisConnection } from "./env";
import { startCompileWorker } from "./workers/compile-worker";

// Worker entrypoint — its own process, never sharing memory with the API
// (cursorrules). Job state flows exclusively through BullMQ/Redis; the S3
// service inside startCompileWorker fail-fasts on missing env at startup.
async function main(): Promise<void> {
  const env = parseLegacyWorkerEnv(process.env);
  const worker = await startCompileWorker({
    connection: redisConnection(env),
  });
  console.log("DePress compile worker started");

  const close = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
