import { z } from "zod";
import { JobFailureCodeSchema, type JobFailureCode } from "@depress/ast";
import { COMPILE_QUEUE_NAME } from "../queue/compile-queue";
import type { JobStatus } from "../contracts";
import type { JobStore } from "./job-store";

// Read-side view of a job — the minimum GET /jobs/:id needs. Both the
// in-memory store (tests/dev) and BullMQ (production) project into this.
export interface JobView {
  id: string;
  status: JobStatus;
  artifactKey?: string;
  error?: JobFailureCode;
}

// API and worker are separate processes and never share memory
// (cursorrules); BullMQ job state in Redis is the only shared source of
// truth, so the API reads it directly instead of keeping its own store.
export interface JobReader {
  get(id: string): Promise<JobView | undefined>;
}

// Worker returnvalue contract (worker → Redis → API is a trust boundary, so
// it is re-validated with Zod on read). Mirrors CompileJobOutcome's
// succeeded variant — failed outcomes are thrown, not returned, so only
// succeeded ever lands in returnvalue.
export const CompileJobReturnValueSchema = z
  .object({
    status: z.literal("succeeded"),
    artifactKey: z.string().min(1),
    pdfByteLength: z.number().int().nonnegative(),
  })
  .strict();

// The subset of a BullMQ Job the reader consumes — injectable for tests.
export interface BullmqJobLike {
  id?: string;
  returnvalue: unknown;
  failedReason?: string;
  getState(): Promise<string>;
}

export interface BullmqQueueLike {
  getJob(id: string): Promise<BullmqJobLike | null | undefined>;
}

function mapState(
  jobId: string,
  state: string,
  job: BullmqJobLike,
): JobView | undefined {
  switch (state) {
    case "waiting":
    case "waiting-children":
    case "delayed":
    case "prioritized":
      return { id: jobId, status: "queued" };
    case "active":
      return { id: jobId, status: "processing" };
    case "completed": {
      const result = CompileJobReturnValueSchema.safeParse(job.returnvalue);
      if (!result.success) {
        // Completed but with an unusable returnvalue — a contract violation,
        // reported as failed rather than leaking a broken succeeded response.
        return { id: jobId, status: "failed", error: "COMPILE_FAILED" };
      }
      return {
        id: jobId,
        status: "succeeded",
        artifactKey: result.data.artifactKey,
      };
    }
    case "failed": {
      // failedReason carries only the safe code the worker threw; anything
      // else (OOM kill, unexpected exception) degrades to COMPILE_FAILED.
      const code = JobFailureCodeSchema.safeParse(job.failedReason);
      return {
        id: jobId,
        status: "failed",
        error: code.success ? code.data : "COMPILE_FAILED",
      };
    }
    default:
      // "unknown" — BullMQ can't find the job (evicted or never existed).
      return undefined;
  }
}

// Read-only BullMQ-backed reader. Lazy import like the producer so unit
// tests and Redis-less dev never load or connect to Redis.
export function createBullmqJobReader(
  connection: { host: string; port: number },
  deps: { queue?: BullmqQueueLike } = {},
): JobReader {
  let queuePromise: Promise<BullmqQueueLike> | null = null;

  return {
    async get(id) {
      queuePromise ??= deps.queue
        ? Promise.resolve(deps.queue)
        : import("bullmq").then(
            ({ Queue }) =>
              new Queue(COMPILE_QUEUE_NAME, { connection }) as BullmqQueueLike,
          );
      const queue = await queuePromise;
      const job = await queue.getJob(id);
      if (!job) return undefined;
      const state = await job.getState();
      return mapState(id, state, job);
    },
  };
}

// Adapter so the in-memory store (dev without Redis, test seam) satisfies
// the same read interface the route depends on.
export function createStoreJobReader(store: JobStore): JobReader {
  return {
    async get(id) {
      return store.get(id);
    },
  };
}
