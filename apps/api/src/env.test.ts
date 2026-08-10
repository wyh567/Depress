import { describe, expect, it } from "vitest";
import {
  PINNED_TYPST_IMAGE,
  parseApiEnv,
  parseOutboxEnv,
  parsePointerWorkerEnv,
  redisConnection,
} from "./env";

const productionShared = {
  NODE_ENV: "production",
  LOG_LEVEL: "info",
  DATABASE_URL: "postgresql://database.internal/depress",
  REDIS_URL: "rediss://publisher:password@redis.internal:6380/2",
};

describe("runtime environment contracts", () => {
  it("keeps local API defaults", () => {
    const env = parseApiEnv({
      DATABASE_URL: "postgresql://localhost/depress",
      BETTER_AUTH_SECRET: "x".repeat(32),
    });

    expect(env).toMatchObject({
      API_BIND_HOST: "127.0.0.1",
      API_PORT: 3001,
      API_BODY_LIMIT_BYTES: 1_048_576,
      API_RATE_LIMIT_MAX: 120,
      API_RATE_LIMIT_WINDOW_MS: 60_000,
      DOI_RATE_LIMIT_MAX: 10,
      COMPILE_RATE_LIMIT_MAX: 5,
      PUBLIC_ORIGIN: "http://localhost:3000",
      AUTH_ORIGIN: "http://localhost:3000",
      REDIS_HOST: "localhost",
      REDIS_PORT: 6379,
    });
  });

  it("rejects invalid or unsafe API safety limits", () => {
    const base = {
      DATABASE_URL: "postgresql://localhost/depress",
      BETTER_AUTH_SECRET: "x".repeat(32),
    };
    const invalid = [
      ["API_BODY_LIMIT_BYTES", 0],
      ["API_BODY_LIMIT_BYTES", 1_048_577],
      ["API_RATE_LIMIT_MAX", -1],
      ["API_RATE_LIMIT_MAX", 1.5],
      ["API_RATE_LIMIT_WINDOW_MS", 0],
      ["API_RATE_LIMIT_WINDOW_MS", 3_600_001],
      ["DOI_RATE_LIMIT_MAX", "not-a-number"],
      ["COMPILE_RATE_LIMIT_MAX", 0],
    ] as const;

    for (const [name, value] of invalid) {
      expect(() => parseApiEnv({ ...base, [name]: value })).toThrow(name);
    }
  });

  it("fails fast when production origins are missing", () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://database.internal/depress",
        BETTER_AUTH_SECRET: "x".repeat(32),
      })
    ).toThrow("PUBLIC_ORIGIN, AUTH_ORIGIN");
  });

  it("fails fast when the production Redis URL is missing", () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://database.internal/depress",
        BETTER_AUTH_SECRET: "x".repeat(32),
        PUBLIC_ORIGIN: "https://web.invalid",
        AUTH_ORIGIN: "https://web.invalid",
      })
    ).toThrow("REDIS_URL");
  });

  it("parses authenticated TLS Redis URLs without exposing them", () => {
    const env = parseOutboxEnv(productionShared);

    expect(redisConnection(env)).toEqual({
      host: "redis.internal",
      port: 6380,
      username: "publisher",
      password: "password",
      db: 2,
      tls: {},
    });
  });

  it("validates process-specific bounded controls", () => {
    expect(() => parseOutboxEnv({ ...productionShared, OUTBOX_BATCH_SIZE: 101 })).toThrow(
      "OUTBOX_BATCH_SIZE"
    );
    expect(() =>
      parsePointerWorkerEnv({
        ...productionShared,
        POINTER_WORKER_CONCURRENCY: 17,
      })
    ).toThrow("POINTER_WORKER_CONCURRENCY");
    expect(() =>
      parsePointerWorkerEnv({
        ...productionShared,
        TYPST_IMAGE: "ghcr.io/typst/typst:latest",
      })
    ).toThrow("TYPST_IMAGE");
    expect(parsePointerWorkerEnv(productionShared).TYPST_IMAGE).toBe(PINNED_TYPST_IMAGE);
  });
});
