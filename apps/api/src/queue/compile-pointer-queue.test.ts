import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  COMPILE_POINTER_JOB_NAME,
  COMPILE_POINTER_QUEUE_NAME,
  createBullmqCompilePointerQueue,
} from "./compile-pointer-queue";
import { COMPILE_QUEUE_NAME } from "./compile-queue";

describe("persisted compile pointer queue", () => {
  it("uses an isolated queue, a strict pointer, and the compile UUID as BullMQ job ID", async () => {
    const add = vi.fn(
      async (
        _name: string,
        _data: unknown,
        _options: { jobId: string },
      ) => {
        void _name;
        void _data;
        void _options;
      },
    );
    const queue = createBullmqCompilePointerQueue(
      { host: "redis.test", port: 6379 },
      async () => ({ add }),
    );
    const pointer = {
      jobId: randomUUID(),
      snapshotHash: "b".repeat(64),
    };

    await queue.enqueue(pointer);

    expect(COMPILE_POINTER_QUEUE_NAME).not.toBe(COMPILE_QUEUE_NAME);
    expect(add).toHaveBeenCalledWith(
      COMPILE_POINTER_JOB_NAME,
      pointer,
      { jobId: pointer.jobId },
    );
    expect(Object.keys(add.mock.calls[0]![1] as object).sort()).toEqual([
      "jobId",
      "snapshotHash",
    ]);
  });
});
