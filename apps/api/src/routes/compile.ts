import type { FastifyInstance } from "fastify";
import {
  CompileRequestSchema,
  type CompileResponse,
  type ErrorResponse,
} from "../contracts";
import type { JobStore } from "../services/job-store";
import type { CompileQueue } from "../queue/compile-queue";

export function registerCompileRoute(
  app: FastifyInstance,
  store: JobStore,
  queue: CompileQueue,
): void {
  app.post("/compile", async (request, reply) => {
    // Body is untrusted — always parse as unknown (never trust inferred types).
    const parsed = CompileRequestSchema.safeParse(request.body as unknown);
    if (!parsed.success) {
      const body: ErrorResponse = {
        error: "VALIDATION_ERROR",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
      return reply.status(400).send(body);
    }

    // Async contract (Invariant #4): only enqueue — no transformer, no Typst,
    // no artifact here. The BullMQ worker compiles out of process.
    const job = store.create({
      templateId: parsed.data.templateId,
      format: parsed.data.format,
    });
    try {
      await queue.enqueue({
        jobId: job.id,
        ast: parsed.data.ast,
        templateId: parsed.data.templateId,
        format: parsed.data.format,
      });
    } catch {
      store.setStatus(job.id, "failed", { error: "QUEUE_UNAVAILABLE" });
      const body: ErrorResponse = { error: "QUEUE_UNAVAILABLE" };
      return reply.status(503).send(body);
    }
    const body: CompileResponse = { jobId: job.id, status: "queued" };
    return reply.status(202).send(body);
  });
}
