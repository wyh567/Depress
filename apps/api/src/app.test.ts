import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { MentorAuth } from "./auth/auth";
import { buildApp } from "./app";

describe("legacy compile cutover", () => {
  it("does not expose POST /compile", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/compile" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      message: "Route POST:/compile not found",
      error: "Not Found",
      statusCode: 404,
    });

    await app.close();
  });

  it("does not expose GET /jobs/:id", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/jobs/legacy-job" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      message: "Route GET:/jobs/legacy-job not found",
      error: "Not Found",
      statusCode: 404,
    });

    await app.close();
  });

  it("still rejects unauthenticated requests to the persisted compile path", async () => {
    const auth = {
      api: { getSession: vi.fn(async () => null) },
      handler: vi.fn(),
    } as unknown as MentorAuth;
    const database = { query: vi.fn() } as unknown as Pool;
    const app = buildApp({
      auth,
      authOrigin: "http://localhost:3000",
      database,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/compile-jobs",
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(database.query).not.toHaveBeenCalled();

    await app.close();
  });
});
