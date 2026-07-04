import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { CompileResponseSchema, JobResponseSchema } from "./contracts";

const validAst = {
  type: "doc",
  content: [
    { type: "heading", level: 1, content: [{ type: "text", text: "Intro" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "As shown in " },
        { type: "citation", citeKey: "smith2024" },
      ],
    },
  ],
};

const validBody = { ast: validAst, templateId: "ieee", format: "pdf" };

describe("POST /compile", () => {
  it("queues a job for a valid request", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: validBody,
    });
    expect(res.statusCode).toBe(202);
    const body = CompileResponseSchema.parse(res.json());
    expect(body.status).toBe("queued");
    // Async contract: no synchronous compile output of any kind.
    expect(res.json()).not.toHaveProperty("artifactUrl");
    expect(Object.keys(res.json()).sort()).toEqual(["jobId", "status"]);
  });

  it("rejects an invalid AST with issue paths and messages", async () => {
    const badAst = {
      type: "doc",
      content: [{ type: "heading", level: 4, content: [] }],
    };
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: { ...validBody, ast: badAst },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; issues: unknown[] };
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0]).toMatchObject({
      path: expect.stringContaining("ast.content"),
      message: expect.any(String),
    });
  });

  it("rejects an unknown templateId", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: { ...validBody, templateId: "elsevier" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("rejects an unknown format", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: { ...validBody, format: "docx" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "VALIDATION_ERROR" });
  });
});

describe("GET /jobs/:id", () => {
  it("returns the status of an existing job", async () => {
    const app = buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/compile",
      payload: validBody,
    });
    const { jobId } = CompileResponseSchema.parse(post.json());

    const res = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
    expect(res.statusCode).toBe(200);
    const body = JobResponseSchema.parse(res.json());
    expect(body).toEqual({ jobId, status: "queued" });
  });

  it("returns 404 for an unknown job", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/jobs/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "JOB_NOT_FOUND" });
  });

  it("keeps job stores isolated between app instances", async () => {
    const appA = buildApp();
    const post = await appA.inject({
      method: "POST",
      url: "/compile",
      payload: validBody,
    });
    const { jobId } = CompileResponseSchema.parse(post.json());

    const appB = buildApp();
    const res = await appB.inject({ method: "GET", url: `/jobs/${jobId}` });
    expect(res.statusCode).toBe(404);
  });
});
