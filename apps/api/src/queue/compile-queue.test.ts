import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createInMemoryCompileQueue } from "./compile-queue";

const smithRef = {
  id: "smith2024",
  type: "article-journal" as const,
  title: "A Study",
  volume: "12",
  issue: "3",
};

const validAst = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        { type: "citation", citeKey: "smith2024" },
      ],
    },
  ],
};

const validBody = {
  ast: validAst,
  references: [smithRef],
  templateId: "ieee",
  format: "pdf",
};

describe("POST /compile enqueue behavior", () => {
  it("enqueues a validated payload with the queued jobId and references", async () => {
    const queue = createInMemoryCompileQueue();
    const app = buildApp({ queue });
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: validBody,
    });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json() as { jobId: string };
    expect(queue.payloads).toHaveLength(1);
    expect(queue.payloads[0]).toMatchObject({
      jobId,
      templateId: "ieee",
      format: "pdf",
      references: [smithRef],
    });
  });

  it("does not enqueue when the AST is invalid", async () => {
    const queue = createInMemoryCompileQueue();
    const app = buildApp({ queue });
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: {
        ast: { type: "doc", content: [{ type: "heading", level: 4 }] },
        references: [],
        templateId: "ieee",
        format: "pdf",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(queue.payloads).toHaveLength(0);
  });

  it("does not enqueue when a reference is invalid", async () => {
    const queue = createInMemoryCompileQueue();
    const app = buildApp({ queue });
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: {
        ...validBody,
        references: [{ id: "", type: "book", title: "T" }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(queue.payloads).toHaveLength(0);
  });

  it("does not enqueue when a cited reference is missing", async () => {
    const queue = createInMemoryCompileQueue();
    const app = buildApp({ queue });
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: { ...validBody, references: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(queue.payloads).toHaveLength(0);
  });

  it("marks the job failed and returns 503 when enqueue fails", async () => {
    const app = buildApp({
      queue: {
        enqueue: async () => {
          throw new Error("redis down");
        },
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: validBody,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "QUEUE_UNAVAILABLE" });
  });
});
describe("Elsevier queue contract", () => {
  it("preserves templateId: elsevier in the validated queue payload", async () => {
    const queue = createInMemoryCompileQueue();
    const app = buildApp({ queue });
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: { ...validBody, templateId: "elsevier" },
    });
    expect(res.statusCode).toBe(202);
    expect(queue.payloads[0]?.templateId).toBe("elsevier");
  });
});