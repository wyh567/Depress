import {
  CompileQueuePointerSchema,
  type CompileQueuePointer,
} from "@depress/ast";

export const COMPILE_POINTER_QUEUE_NAME = "compile-pointers";
export const COMPILE_POINTER_JOB_NAME = "compile-pointer";

export interface CompilePointerQueue {
  enqueue(payload: CompileQueuePointer): Promise<void>;
}

interface BullmqQueuePort {
  add(
    name: string,
    data: unknown,
    options: { jobId: string },
  ): Promise<unknown>;
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

export function createBullmqCompilePointerQueue(connection: {
  host: string;
  port: number;
}, createQueue?: () => Promise<BullmqQueuePort>): CompilePointerQueue {
  let queuePromise: Promise<BullmqQueuePort> | null = null;

  return {
    async enqueue(payload) {
      const parsed = CompileQueuePointerSchema.parse(payload);
      queuePromise ??=
        createQueue?.() ??
        import("bullmq").then(
          ({ Queue }) =>
            new Queue(COMPILE_POINTER_QUEUE_NAME, { connection }),
        );
      const queue = await queuePromise;
      await queue.add(COMPILE_POINTER_JOB_NAME, parsed, {
        jobId: parsed.jobId,
      });
    },
  };
}
