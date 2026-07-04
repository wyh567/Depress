import type { FastifyInstance } from "fastify";
import {
  CompileRequestSchema,
  type CompileResponse,
  type ErrorResponse,
} from "../contracts";
import type { JobStore } from "../services/job-store";

export function registerCompileRoute(
  app: FastifyInstance,
  store: JobStore,
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
    // no artifact here. A worker picks the job up in a later TODO.
    const job = store.create({
      templateId: parsed.data.templateId,
      format: parsed.data.format,
    });
    const body: CompileResponse = { jobId: job.id, status: "queued" };
    return reply.status(202).send(body);
  });
}
