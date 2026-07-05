import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createInMemoryCompileQueue } from "./compile-queue";

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

describe("POST /compile enqueue behavior", () => {
  it("enqueues a validated payload with the queued jobId", async () => {
    const queue = createInMemoryCompileQueue();
    const app = buildApp({ queue });
    const res = await app.inject({
      method: "POST",
      url: "/compile",
      payload: { ast: validAst, templateId: "ieee", format: "pdf" },
    });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json() as { jobId: string };
    expect(queue.payloads).toHaveLength(1);
    expect(queue.payloads[0]).toMatchObject({
      jobId,
      templateId: "ieee",
      format: "pdf",
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
        templateId: "ieee",
        format: "pdf",
      },
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
      payload: { ast: validAst, templateId: "ieee", format: "pdf" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "QUEUE_UNAVAILABLE" });
  });
});
