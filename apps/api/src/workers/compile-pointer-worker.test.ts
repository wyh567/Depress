import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { COMPILE_POINTER_QUEUE_NAME } from "../queue/compile-pointer-queue";
import type { CompileExecutionRepository } from "../db/compile-execution-repository";
import { startCompilePointerWorker } from "./compile-pointer-worker";

describe("persisted compile pointer worker wiring", () => {
  it("reconciles before consuming only the isolated pointer queue", async () => {
    const order: string[] = [];
    let processor:
      | ((job: { id?: string; data: unknown }) => Promise<unknown>)
      | undefined;
    const handle = { close: vi.fn(async () => undefined) };
    const repository = {
      load: vi.fn(async () => undefined),
    } as unknown as CompileExecutionRepository;

    const worker = await startCompilePointerWorker({
      connection: { host: "redis.test", port: 6379 },
      pool: {} as Pool,
      repository,
      sandbox: { compile: vi.fn() },
      artifacts: { uploadArtifact: vi.fn() },
      reconcileStaleContainers: vi.fn(async () => {
        order.push("reconcile");
        return {
          scannedCount: 0,
          keptCount: 0,
          removedCount: 0,
          terminalRemovedCount: 0,
          staleRemovedCount: 0,
        };
      }),
      createWorker: (queueName, workerProcessor, options) => {
        order.push("worker");
        expect(queueName).toBe(COMPILE_POINTER_QUEUE_NAME);
        expect(options).toMatchObject({
          lockDuration: 30_000,
          maxStalledCount: 2,
        });
        processor = workerProcessor;
        return handle;
      },
    });

    expect(order).toEqual(["reconcile", "worker"]);
    expect(worker).toBe(handle);
    await expect(
      processor?.({
        id: randomUUID(),
        data: { jobId: randomUUID(), snapshotHash: "a".repeat(64) },
      }),
    ).rejects.toThrow("JOB_STATE_INVALID");
  });
});
