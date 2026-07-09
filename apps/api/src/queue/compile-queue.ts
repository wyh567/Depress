import {
  CompileJobPayloadSchema,
  type CompileJobPayload,
} from "@depress/ast";

export { CompileJobPayloadSchema, type CompileJobPayload };

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
      // Re-validate at the producer boundary — queue contents are untrusted
      // even when the caller is our own route (Invariant #3).
      const parsed = CompileJobPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("INVALID_COMPILE_JOB_PAYLOAD");
      }
      payloads.push(parsed.data);
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
      const parsed = CompileJobPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("INVALID_COMPILE_JOB_PAYLOAD");
      }
      queuePromise ??= import("bullmq").then(
        ({ Queue }) => new Queue(COMPILE_QUEUE_NAME, { connection }),
      );
      const queue = await queuePromise;
      // jobId dedupes retried HTTP requests at the queue level.
      await queue.add("compile", parsed.data, { jobId: parsed.data.jobId });
    },
  };
}
