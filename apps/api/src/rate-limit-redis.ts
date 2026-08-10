import type { FastifyInstance } from "fastify";
import Redis, { type RedisOptions } from "ioredis";
import type { RedisConnection } from "./env";

export const RATE_LIMIT_REDIS_OPTIONS = {
  connectTimeout: 3_000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt: number) => Math.min(attempt * 200, 2_000),
} satisfies Pick<
  RedisOptions,
  | "connectTimeout"
  | "enableOfflineQueue"
  | "maxRetriesPerRequest"
  | "retryStrategy"
>;

export function createRateLimitRedis(
  connection: RedisConnection,
  onError: () => void = () => {
    console.warn("Rate limiter Redis connection error");
  },
): Redis {
  const client = new Redis({
    ...connection,
    ...RATE_LIMIT_REDIS_OPTIONS,
  });
  // ioredis emits connection errors while retrying. Keep those events handled,
  // and deliberately omit the error object so credentials/endpoints cannot leak.
  client.on("error", onError);
  return client;
}

export async function closeRateLimitRedis(client: Redis): Promise<void> {
  if (client.status === "end") return;
  await new Promise<void>((resolve) => {
    client.once("end", resolve);
    client.disconnect(false);
    if (client.status === "end") resolve();
  });
}

export function registerRateLimitRedisLifecycle(
  app: FastifyInstance,
  client: Redis,
): void {
  app.addHook("onClose", async () => {
    await closeRateLimitRedis(client);
  });
}
