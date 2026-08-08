import { CompileQueuePointerSchema, type CompileQueuePointer } from "@depress/ast";

export const COMPILE_POINTER_QUEUE_NAME = "compile-pointers";
export const COMPILE_POINTER_JOB_NAME = "compile-pointer";
export const COMPILE_POINTER_ATTEMPTS = 3;
export const COMPILE_POINTER_BACKOFF_MS = 5_000;

export interface CompilePointerQueue {
  enqueue(payload: CompileQueuePointer): Promise<void>;
  close?(): Promise<void>;
}

interface BullmqQueuePort {
  add(
    name: string,
    data: unknown,
    options: {
      jobId: string;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
    }
  ): Promise<unknown>;
  close?(): Promise<void>;
}

export function createInMemoryCompilePointerQueue(): CompilePointerQueue & {
  readonly payloads: readonly CompileQueuePointer[];
} {
  const payloads: CompileQueuePointer[] = [];
  return {
    payloads,
    async enqueue(payload) {
      payloads.push(CompileQueuePointerSchema.parse(payload));
    },
  };
}

export function createBullmqCompilePointerQueue(
  connection: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db?: number;
    tls?: Record<string, never>;
  },
  createQueue?: () => Promise<BullmqQueuePort>
): CompilePointerQueue {
  let queuePromise: Promise<BullmqQueuePort> | null = null;

  return {
    async enqueue(payload) {
      const parsed = CompileQueuePointerSchema.parse(payload);
      queuePromise ??=
        createQueue?.() ??
        import("bullmq").then(({ Queue }) => new Queue(COMPILE_POINTER_QUEUE_NAME, { connection }));
      const queue = await queuePromise;
      await queue.add(COMPILE_POINTER_JOB_NAME, parsed, {
        jobId: parsed.jobId,
        attempts: COMPILE_POINTER_ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: COMPILE_POINTER_BACKOFF_MS,
        },
      });
    },
    async close() {
      if (!queuePromise) return;
      const queue = await queuePromise;
      if ("close" in queue && typeof queue.close === "function") {
        await queue.close();
      }
    },
  };
}
