import { randomUUID } from "node:crypto";
import net, { type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import { redisConnection } from "./env";
import { registerHealthRoutes } from "./health";
import {
  createRateLimitRedis,
  RATE_LIMIT_REDIS_OPTIONS,
  registerRateLimitRedisLifecycle,
} from "./rate-limit-redis";

const redisTestUrl = process.env["DEPRESS_REDIS_TEST_URL"];
const describeRedis = redisTestUrl ? describe : describe.skip;
const LOCAL_COMPOSE_REDIS = redisConnection({
  REDIS_URL: redisTestUrl,
  REDIS_HOST: "127.0.0.1",
  REDIS_PORT: 6379,
});
const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanupTasks.splice(0).reverse()) await cleanup();
});

async function waitFor<T>(operation: () => Promise<T>, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function unusedLocalPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function startRedisProxy(port: number): Promise<() => Promise<void>> {
  const sockets = new Set<Socket>();
  const server = net.createServer((incoming) => {
    const outgoing = net.connect(LOCAL_COMPOSE_REDIS);
    sockets.add(incoming);
    sockets.add(outgoing);
    incoming.pipe(outgoing).pipe(incoming);
    incoming.on("error", () => outgoing.destroy());
    outgoing.on("error", () => incoming.destroy());
    const forget = () => {
      sockets.delete(incoming);
      sockets.delete(outgoing);
    };
    incoming.once("close", forget);
    outgoing.once("close", forget);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return async () => {
    server.close();
    for (const socket of sockets) socket.destroy();
  };
}

async function keysForPrefix(
  redis: ReturnType<typeof createRateLimitRedis>,
  prefix: string,
): Promise<string[]> {
  let cursor = "0";
  const keys: string[] = [];
  do {
    const [nextCursor, page] = await redis.scan(
      cursor,
      "MATCH",
      `${prefix}*`,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    keys.push(...page);
  } while (cursor !== "0");
  return keys;
}

describeRedis("production rate-limiter Redis lifecycle", () => {
  it("stores real limiter state in local Compose Redis and closes once", async () => {
    const namespace = `depress-t04a-${randomUUID()}-`;
    const redis = createRateLimitRedis(LOCAL_COMPOSE_REDIS, vi.fn());
    await waitFor(() => redis.ping());
    const quit = vi.spyOn(redis, "quit");
    const disconnect = vi.spyOn(redis, "disconnect");
    cleanupTasks.push(async () => {
      if (redis.status !== "end") redis.disconnect(false);
    });

    const app = buildApp({
      rateLimitMax: 2,
      rateLimitWindowMs: 60_000,
      rateLimitRedis: redis,
      rateLimitNameSpace: namespace,
    });
    void app.register(async (routes) => {
      routes.get("/rate-probe", async () => ({ ok: true }));
    });
    registerRateLimitRedisLifecycle(app, redis);
    let appClosed = false;
    cleanupTasks.push(async () => {
      if (!appClosed) await app.close();
    });

    expect((await app.inject({ method: "GET", url: "/rate-probe" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/rate-probe" })).statusCode).toBe(200);
    const limited = await app.inject({ method: "GET", url: "/rate-probe" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "RATE_LIMITED" });

    const ownedKeys = await keysForPrefix(redis, namespace);
    expect(ownedKeys.length).toBeGreaterThan(0);
    await redis.del(...ownedKeys);

    await app.close();
    appClosed = true;
    expect(quit).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(redis.status).toBe("end");
  }, 15_000);

  it("listens while Redis is down, fails closed, and recovers without restart", async () => {
    const unavailablePort = await unusedLocalPort();
    const redisErrors = vi.fn();
    const redis = createRateLimitRedis(
      { host: "127.0.0.1", port: unavailablePort },
      redisErrors,
    );
    const quit = vi.spyOn(redis, "quit");
    const disconnect = vi.spyOn(redis, "disconnect");
    cleanupTasks.push(async () => {
      if (redis.status !== "end") redis.disconnect(false);
    });

    const handler = vi.fn(async () => ({ ok: true }));
    const namespace = `depress-t04a-${randomUUID()}-`;
    const app = buildApp({
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
      rateLimitRedis: redis,
      rateLimitNameSpace: namespace,
    });
    void app.register(async (routes) => {
      routes.get("/rate-probe", handler);
    });
    registerHealthRoutes(app, () => redis.ping());
    registerRateLimitRedisLifecycle(app, redis);
    let appClosed = false;
    cleanupTasks.push(async () => {
      if (!appClosed) await app.close();
    });
    await app.listen({ host: "127.0.0.1", port: 0 });

    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(503);
    const failedClosed = await app.inject({ method: "GET", url: "/rate-probe" });
    expect(failedClosed.statusCode).toBe(500);
    expect(failedClosed.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
    expect(failedClosed.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|redis|:\d+/i);
    expect(handler).not.toHaveBeenCalled();

    const stopProxy = await startRedisProxy(unavailablePort);
    cleanupTasks.push(stopProxy);
    await waitFor(() => redis.ping());
    expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/rate-probe" })).statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(redisErrors).toHaveBeenCalled();

    const ownedKeys = await keysForPrefix(redis, namespace);
    if (ownedKeys.length > 0) await redis.del(...ownedKeys);

    await app.close();
    appClosed = true;
    expect(quit).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(redis.status).toBe("end");
  }, 15_000);

  it("keeps request failures bounded while retaining reconnect", () => {
    expect(RATE_LIMIT_REDIS_OPTIONS).toMatchObject({
      connectTimeout: 3_000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    expect(RATE_LIMIT_REDIS_OPTIONS.retryStrategy(20)).toBeGreaterThan(0);
  });
});
