import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import { CompileResponseSchema, JobResponseSchema } from "./contracts";
import { createJobStore } from "./services/job-store";

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

const validBody = {
  ast: validAst,
  references: [
    {
      id: "smith2024",
      type: "article-journal",
      title: "A Study",
      volume: "12",
    },
  ],
  templateId: "ieee",
  format: "pdf",
};

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

  it("rejects an invalid reference item", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: {
        ...validBody,
        references: [{ id: "   ", type: "book", title: "T" }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("rejects duplicate reference ids", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: {
        ...validBody,
        references: [
          { id: "smith2024", type: "article-journal", title: "A" },
          { id: "smith2024", type: "article-journal", title: "B" },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("rejects unknown compile fields such as fontSize", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: { ...validBody, fontSize: 72 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("accepts references: [] for citation-free documents", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: {
        ast: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
        },
        references: [],
        templateId: "ieee",
        format: "pdf",
      },
    });
    expect(res.statusCode).toBe(202);
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

  it("never includes downloadUrl while a job is queued", async () => {
    const app = buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/compile",
      payload: validBody,
    });
    const { jobId } = CompileResponseSchema.parse(post.json());
    const res = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
    expect(res.json()).not.toHaveProperty("downloadUrl");
    expect(Object.keys(res.json() as object).sort()).toEqual([
      "jobId",
      "status",
    ]);
  });

  it("returns a freshly signed downloadUrl for a succeeded job", async () => {
    const store = createJobStore();
    const signArtifactUrl = vi.fn(
      async (key: string) => `https://s3.example.com/${key}?sig=fresh`,
    );
    const app = buildApp({ store, signArtifactUrl });
    const post = await app.inject({
      method: "POST",
      url: "/compile",
      payload: validBody,
    });
    const { jobId } = CompileResponseSchema.parse(post.json());
    // Mirror what the worker outcome does after a successful upload.
    store.setStatus(jobId, "succeeded", {
      artifactKey: `artifacts/${jobId}.pdf`,
    });

    const res = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
    expect(res.statusCode).toBe(200);
    const body = JobResponseSchema.parse(res.json());
    expect(body).toEqual({
      jobId,
      status: "succeeded",
      downloadUrl: `https://s3.example.com/artifacts/${jobId}.pdf?sig=fresh`,
    });
    expect(signArtifactUrl).toHaveBeenCalledWith(`artifacts/${jobId}.pdf`);
  });

  it("returns the safe failure code for a failed job", async () => {
    const store = createJobStore();
    const app = buildApp({ store });
    const post = await app.inject({
      method: "POST",
      url: "/compile",
      payload: validBody,
    });
    const { jobId } = CompileResponseSchema.parse(post.json());
    store.setStatus(jobId, "failed", { error: "UPLOAD_FAILED" });

    const res = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
    expect(res.statusCode).toBe(200);
    expect(JobResponseSchema.parse(res.json())).toEqual({
      jobId,
      status: "failed",
      error: "UPLOAD_FAILED",
    });
    expect(res.json()).not.toHaveProperty("downloadUrl");
  });

  it("answers 500 ARTIFACT_UNAVAILABLE when succeeded but signing is impossible", async () => {
    const store = createJobStore();
    const app = buildApp({ store }); // no signer wired
    const post = await app.inject({
      method: "POST",
      url: "/compile",
      payload: validBody,
    });
    const { jobId } = CompileResponseSchema.parse(post.json());
    store.setStatus(jobId, "succeeded", {
      artifactKey: `artifacts/${jobId}.pdf`,
    });

    const res = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ARTIFACT_UNAVAILABLE" });
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
