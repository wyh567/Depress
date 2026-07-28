import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerHealthRoutes } from "./health";

describe("health routes", () => {
  it("reports liveness without touching dependencies", async () => {
    const readiness = vi.fn();
    const app = Fastify();
    registerHealthRoutes(app, readiness);

    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "alive" });
    expect(readiness).not.toHaveBeenCalled();
  });

  it("returns only a safe readiness state when a dependency fails", async () => {
    const app = Fastify();
    registerHealthRoutes(app, async () => {
      throw new Error("postgresql://secret@internal/private_bucket");
    });

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "not_ready" });
    expect(response.body).not.toContain("postgresql");
    expect(response.body).not.toContain("private_bucket");
  });
});
