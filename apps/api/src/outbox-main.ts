import { createPostgresPool } from "./db/pool";
import { parseOutboxEnv, redisConnection } from "./env";
import { runOutboxPublisher } from "./outbox-publisher";
import { createBullmqCompilePointerQueue } from "./queue/compile-pointer-queue";
import { publishCompileOutbox } from "./services/compile-outbox-publisher";

async function main(): Promise<void> {
  const env = parseOutboxEnv(process.env);
  const pool = createPostgresPool(env.DATABASE_URL);
  const queue = createBullmqCompilePointerQueue(redisConnection(env));
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log("DePress compile outbox publisher started");
  try {
    await runOutboxPublisher({
      publish: () =>
        publishCompileOutbox({
          pool,
          queue,
          batchSize: env.OUTBOX_BATCH_SIZE,
        }),
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      signal: shutdown.signal,
      logger: {
        info: (fields, message) => console.log(message, fields),
        warn: (message) => console.warn(message),
      },
    });
  } finally {
    await queue.close?.();
    await pool.end();
  }
}

main().catch(() => {
  console.error("Compile outbox publisher stopped unexpectedly");
  process.exit(1);
});
