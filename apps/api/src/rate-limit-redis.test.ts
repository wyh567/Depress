import net, { type AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { buildApp } from "./app";
import {
  createRateLimitRedis,
  registerRateLimitRedisLifecycle,
} from "./rate-limit-redis";

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

it("closes a reconnecting limiter client exactly once without hanging", async () => {
  const redis = createRateLimitRedis(
    { host: "127.0.0.1", port: await unusedLocalPort() },
    vi.fn(),
  );
  const quit = vi.spyOn(redis, "quit");
  const disconnect = vi.spyOn(redis, "disconnect");
  const app = buildApp({ rateLimitRedis: redis });
  registerRateLimitRedisLifecycle(app, redis);
  await app.listen({ host: "127.0.0.1", port: 0 });

  await expect(app.close()).resolves.toBeUndefined();
  expect(quit).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(redis.status).toBe("end");
});
