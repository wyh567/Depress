import type { Pool } from "pg";
import type Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";
import type { MentorAuth } from "./auth/auth";
import { buildApp } from "./app";
import { registerHealthRoutes } from "./health";
import type { CrossrefClient } from "./services/crossref/crossref-client";

const WINDOW_MS = 60_000;

function safetyOptions(overrides: Record<string, unknown> = {}) {
  return {
    bodyLimitBytes: 64,
    rateLimitMax: 2,
    rateLimitWindowMs: WINDOW_MS,
    doiRateLimitMax: 1,
    compileRateLimitMax: 1,
    trustProxy: "127.0.0.1",
    ...overrides,
  };
}

function successfulCrossref(): CrossrefClient {
  return {
    lookupWork: vi.fn(async (doi) => ({
      ok: true as const,
      work: { type: "journal-article", title: ["Rate limited"], DOI: doi },
    })),
  };
}

function failingRedis(): Redis {
  const client: Record<string, unknown> = {};
  client["defineCommand"] = (name: string) => {
    client[name] = (...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error) => void;
      callback(new Error("redis unavailable"));
    };
  };
  return client as unknown as Redis;
}

function registerRateProbe(
  app: ReturnType<typeof buildApp>,
  handler = vi.fn(async () => ({ ok: true })),
) {
  void app.register(async (routes) => {
    routes.get("/rate-probe", handler);
  });
  return handler;
}

describe("API request-body safety", () => {
  it("accepts the byte boundary and rejects larger bodies with a safe 413", async () => {
    const app = buildApp(safetyOptions());
    app.post("/body-probe", async (request) => ({
      bytes: Buffer.byteLength(request.body as string),
    }));

    const under = await app.inject({
      method: "POST",
      url: "/body-probe",
      headers: { "content-type": "text/plain" },
      payload: "a".repeat(63),
    });
    const boundary = await app.inject({
      method: "POST",
      url: "/body-probe",
      headers: { "content-type": "text/plain" },
      payload: "b".repeat(64),
    });
    const secret = `private-${"c".repeat(57)}`;
    const over = await app.inject({
      method: "POST",
      url: "/body-probe",
      headers: { "content-type": "text/plain" },
      payload: secret,
    });

    expect(under.statusCode).toBe(200);
    expect(boundary.statusCode).toBe(200);
    expect(over.statusCode).toBe(413);
    expect(over.json()).toEqual({ error: "REQUEST_BODY_TOO_LARGE" });
    expect(over.body).not.toContain(secret);
    await app.close();
  });
});

describe("API HTTP rate limiting", () => {
  it("applies the default per-IP threshold with standard limit headers", async () => {
    const app = buildApp(safetyOptions());
    registerRateProbe(app);

    expect((await app.inject({ method: "GET", url: "/rate-probe" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/rate-probe" })).statusCode).toBe(200);
    const limited = await app.inject({ method: "GET", url: "/rate-probe" });

    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "RATE_LIMITED" });
    expect(limited.headers["x-ratelimit-limit"]).toBe("2");
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    await app.close();
  });

  it("keeps buckets independent for different client IPs", async () => {
    const app = buildApp(safetyOptions({ rateLimitMax: 1 }));
    registerRateProbe(app);

    const first = await app.inject({
      method: "GET",
      url: "/rate-probe",
      remoteAddress: "198.51.100.10",
    });
    const second = await app.inject({
      method: "GET",
      url: "/rate-probe",
      remoteAddress: "198.51.100.11",
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    await app.close();
  });

  it("uses the official request.ip key behavior with IPv6 /64 aggregation", async () => {
    const app = buildApp(safetyOptions({ rateLimitMax: 1 }));
    registerRateProbe(app);

    const first = await app.inject({
      method: "GET",
      url: "/rate-probe",
      remoteAddress: "2001:db8:1:2::1",
    });
    const sameSubnet = await app.inject({
      method: "GET",
      url: "/rate-probe",
      remoteAddress: "2001:db8:1:2::ffff",
    });
    const otherSubnet = await app.inject({
      method: "GET",
      url: "/rate-probe",
      remoteAddress: "2001:db8:1:3::1",
    });

    expect(first.statusCode).toBe(200);
    expect(sameSubnet.statusCode).toBe(429);
    expect(otherSubnet.statusCode).toBe(200);
    await app.close();
  });

  it("respects forwarded clients only from the loopback proxy", async () => {
    const trusted = buildApp(safetyOptions({ rateLimitMax: 1 }));
    registerRateProbe(trusted);
    const trustedA = await trusted.inject({
      method: "GET",
      url: "/rate-probe",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.20" },
    });
    const trustedB = await trusted.inject({
      method: "GET",
      url: "/rate-probe",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.21" },
    });
    expect(trustedA.statusCode).toBe(200);
    expect(trustedB.statusCode).toBe(200);
    await trusted.close();

    const untrusted = buildApp(safetyOptions({ rateLimitMax: 1 }));
    registerRateProbe(untrusted);
    const untrustedFirst = await untrusted.inject({
      method: "GET",
      url: "/rate-probe",
      remoteAddress: "198.51.100.30",
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    const spoofed = await untrusted.inject({
      method: "GET",
      url: "/rate-probe",
      remoteAddress: "198.51.100.30",
      headers: { "x-forwarded-for": "203.0.113.2" },
    });
    expect(untrustedFirst.statusCode).toBe(200);
    expect(spoofed.statusCode).toBe(429);
    await untrusted.close();
  });

  it("uses the DOI-specific threshold and preserves its safe 429 contract", async () => {
    const app = buildApp({
      ...safetyOptions(),
      crossref: successfulCrossref(),
    });
    const request = {
      method: "POST" as const,
      url: "/references/doi/lookup",
      payload: { doi: "10.1000/rate-limit" },
    };

    expect((await app.inject(request)).statusCode).toBe(200);
    const limited = await app.inject(request);

    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ ok: false, error: "CROSSREF_RATE_LIMITED" });
    await app.close();
  });

  it("uses the compile-create threshold before expensive authenticated work", async () => {
    const auth = {
      api: { getSession: vi.fn(async () => null) },
      handler: vi.fn(),
    } as unknown as MentorAuth;
    const database = { query: vi.fn() } as unknown as Pool;
    const app = buildApp({
      ...safetyOptions(),
      auth,
      authOrigin: "http://localhost:3000",
      database,
    });
    const request = {
      method: "POST" as const,
      url: "/api/compile-jobs",
      payload: {},
    };

    expect((await app.inject(request)).statusCode).toBe(401);
    const limited = await app.inject(request);

    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "RATE_LIMITED" });
    expect(database.query).not.toHaveBeenCalled();
    await app.close();
  });

  it("fails closed when the Redis-backed limiter is unavailable", async () => {
    const app = buildApp(safetyOptions({ rateLimitRedis: failingRedis() }));
    const handler = registerRateProbe(app);

    const response = await app.inject({ method: "GET", url: "/rate-probe" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
    expect(response.body).not.toContain("redis unavailable");
    expect(handler).not.toHaveBeenCalled();
    await app.close();
  });

  it("hides unexpected dependency details but preserves parser 4xx errors", async () => {
    const app = buildApp(safetyOptions());
    app.get("/dependency-failure", async () => {
      throw new Error("connect ECONNREFUSED redis.secret.internal:6379");
    });
    app.get("/invalid-error-status", async () => {
      throw Object.assign(new Error("redis://user:password@secret:6379"), {
        statusCode: 200,
      });
    });
    app.post("/json-probe", async () => ({ ok: true }));

    const failed = await app.inject({ method: "GET", url: "/dependency-failure" });
    const invalidStatus = await app.inject({
      method: "GET",
      url: "/invalid-error-status",
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/json-probe",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
    expect(failed.body).not.toMatch(/ECONNREFUSED|redis\.secret|6379/);
    expect(invalidStatus.statusCode).toBe(500);
    expect(invalidStatus.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
    expect(invalidStatus.body).not.toMatch(/password|secret|6379/);
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });
});

describe("health rate-limit exemptions", () => {
  it("never rate limits live or healthy readiness probes", async () => {
    const app = buildApp(safetyOptions({ rateLimitMax: 1 }));
    registerHealthRoutes(app, async () => undefined);

    for (let index = 0; index < 3; index += 1) {
      expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
    }
    await app.close();
  });

  it("keeps unhealthy readiness at 503 instead of rate limiting it", async () => {
    const app = buildApp(safetyOptions({ rateLimitMax: 1 }));
    registerHealthRoutes(app, async () => {
      throw new Error("database unavailable");
    });

    for (let index = 0; index < 3; index += 1) {
      const response = await app.inject({ method: "GET", url: "/health/ready" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "not_ready" });
    }
    await app.close();
  });
});
