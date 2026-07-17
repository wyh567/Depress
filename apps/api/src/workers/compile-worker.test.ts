import { describe, expect, it, vi } from "vitest";
import { COMPILE_QUEUE_NAME } from "../queue/compile-queue";
import { startCompileWorker } from "./compile-worker";
import { TypstSandboxReconciliationError } from "./typst-sandbox-reconciler";

describe("startCompileWorker startup ordering", () => {
  it("runs reconciliation before BullMQ Worker creation", async () => {
    const events: string[] = [];
    const worker = await startCompileWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      artifacts: {
        uploadArtifact: async () => undefined,
      },
      reconcileStaleContainers: async () => {
        events.push("reconcile");
        return {
          scannedCount: 0,
          keptCount: 0,
          removedCount: 0,
          terminalRemovedCount: 0,
          staleRemovedCount: 0,
        };
      },
      createWorker: (queueName, _processor, options) => {
        events.push("worker");
        expect(queueName).toBe(COMPILE_QUEUE_NAME);
        expect(options.connection).toEqual({ host: "127.0.0.1", port: 6379 });
        return {
          close: async () => {
            events.push("close");
          },
        };
      },
    });

    expect(events).toEqual(["reconcile", "worker"]);
    await worker.close();
    expect(events).toEqual(["reconcile", "worker", "close"]);
  });

  it("prevents BullMQ Worker creation when reconciliation fails", async () => {
    const createWorker = vi.fn(() => ({
      close: async () => undefined,
    }));

    await expect(
      startCompileWorker({
        connection: { host: "127.0.0.1", port: 6379 },
        artifacts: {
          uploadArtifact: async () => undefined,
        },
        reconcileStaleContainers: async () => {
          throw new TypstSandboxReconciliationError("DISCOVERY_FAILED");
        },
        createWorker,
      })
    ).rejects.toMatchObject({
      name: "TypstSandboxReconciliationError",
      reason: "DISCOVERY_FAILED",
      message: "Typst sandbox reconciliation failed",
    });

    expect(createWorker).not.toHaveBeenCalled();
  });

  it("permits Worker creation after successful reconciliation", async () => {
    const createWorker = vi.fn(() => ({
      close: async () => undefined,
    }));

    const worker = await startCompileWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      artifacts: {
        uploadArtifact: async () => undefined,
      },
      reconcileStaleContainers: async () => ({
        scannedCount: 0,
        keptCount: 0,
        removedCount: 0,
        terminalRemovedCount: 0,
        staleRemovedCount: 0,
      }),
      createWorker,
    });

    expect(createWorker).toHaveBeenCalledTimes(1);
    await worker.close();
  });

  it("preserves close() for SIGINT/SIGTERM-style shutdown", async () => {
    let closed = false;
    const worker = await startCompileWorker({
      connection: { host: "127.0.0.1", port: 6379 },
      artifacts: {
        uploadArtifact: async () => undefined,
      },
      reconcileStaleContainers: async () => ({
        scannedCount: 0,
        keptCount: 0,
        removedCount: 0,
        terminalRemovedCount: 0,
        staleRemovedCount: 0,
      }),
      createWorker: () => ({
        close: async () => {
          closed = true;
        },
      }),
    });

    await worker.close();
    expect(closed).toBe(true);
  });
});
