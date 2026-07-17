import { COMPILE_QUEUE_NAME } from "../queue/compile-queue";
import {
  processCompileJob,
  type ArtifactUploader,
  type CompileJobOutcome,
} from "./compile-processor";
import {
  reconcileStaleTypstSandboxContainers,
  type TypstSandboxReconciliationResult,
} from "./typst-sandbox-reconciler";
import { createTypstSandboxRunner } from "./typst-sandbox";

export type CompileWorkerHandle = { close(): Promise<void> };

export type CompileWorkerFactory = (
  queueName: string,
  processor: (job: { id?: string; data: unknown }) => Promise<unknown>,
  options: { connection: { host: string; port: number } }
) => CompileWorkerHandle;

// Thin BullMQ wiring — all logic lives in processCompileJob (unit-tested);
// this file is only exercised by the optional Redis/Docker integration path.
// Workers run in their own process and never share memory with the API
// (cursorrules); onOutcome lets a dev entrypoint mirror status into a store.
//
// Startup ordering (B2): stale Typst sandbox reconciliation must complete
// successfully before any BullMQ Worker is created and begins consuming jobs.
export async function startCompileWorker(options: {
  connection: { host: string; port: number };
  onOutcome?: (jobId: string, outcome: CompileJobOutcome) => void;
  artifacts?: ArtifactUploader;
  reconcileStaleContainers?: () => Promise<TypstSandboxReconciliationResult>;
  createWorker?: CompileWorkerFactory;
}): Promise<CompileWorkerHandle> {
  await (options.reconcileStaleContainers ?? (() => reconcileStaleTypstSandboxContainers()))();

  const sandbox = createTypstSandboxRunner();
  // Lazy import keeps unit tests off the S3 module; in production the
  // module-init env validation makes a misconfigured worker fail at startup,
  // not mid-job.
  const artifacts: ArtifactUploader =
    options.artifacts ?? (await import("../services/s3")).createS3ArtifactService();

  const processor = async (job: { id?: string; data: unknown }) => {
    const outcome = await processCompileJob(job.data, {
      sandbox,
      artifacts,
    });
    options.onOutcome?.(job.id ?? "", outcome);
    if (outcome.status === "failed") {
      // Surface only the safe error code to BullMQ job state.
      throw new Error(outcome.error);
    }
    return outcome;
  };

  if (options.createWorker) {
    return options.createWorker(COMPILE_QUEUE_NAME, processor, {
      connection: options.connection,
    });
  }

  const { Worker } = await import("bullmq");
  const worker = new Worker(COMPILE_QUEUE_NAME, processor, {
    connection: options.connection,
  });
  return { close: () => worker.close() };
}
