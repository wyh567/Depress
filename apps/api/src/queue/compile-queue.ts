import { z } from "zod";
import { DocSchema } from "@depress/ast";

// Queue payload contract — Zod single source of truth, shared by the API
// (producer) and the worker (consumer). The worker still re-parses this
// (Invariant #4 / cursorrules): queue contents are untrusted at both ends.
export const CompileJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  ast: DocSchema,
  templateId: z.literal("ieee"),
  format: z.literal("pdf"),
});
export type CompileJobPayload = z.infer<typeof CompileJobPayloadSchema>;

export const COMPILE_QUEUE_NAME = "compile";

// Transport-agnostic producer interface so buildApp never touches Redis.
// Production wires the BullMQ implementation; tests inject a spy/in-memory
// implementation.
export interface CompileQueue {
  enqueue(payload: CompileJobPayload): Promise<void>;
}

// Default queue for buildApp when no adapter is injected (dev without Redis,
// tests). Records payloads; a real worker requires the BullMQ queue.
export function createInMemoryCompileQueue(): CompileQueue & {
  readonly payloads: readonly CompileJobPayload[];
} {
  const payloads: CompileJobPayload[] = [];
  return {
    payloads,
    async enqueue(payload) {
      payloads.push(payload);
    },
  };
}

// BullMQ-backed producer. Import of bullmq is lazy (inside the factory's
// first enqueue) so merely constructing an app or running unit tests never
// loads or connects to Redis — BullMQ itself also only connects on first
// command.
export function createBullmqCompileQueue(connection: {
  host: string;
  port: number;
}): CompileQueue {
  let queuePromise: Promise<{
    add(name: string, data: unknown, opts?: unknown): Promise<unknown>;
  }> | null = null;

  return {
    async enqueue(payload) {
      queuePromise ??= import("bullmq").then(
        ({ Queue }) => new Queue(COMPILE_QUEUE_NAME, { connection }),
      );
      const queue = await queuePromise;
      // jobId dedupes retried HTTP requests at the queue level.
      await queue.add("compile", payload, { jobId: payload.jobId });
    },
  };
}
