import type { Pool } from "pg";
import { COMPILE_POINTER_QUEUE_NAME } from "../queue/compile-pointer-queue";
import {
  createCompileExecutionRepository,
  type CompileExecutionRepository,
} from "../db/compile-execution-repository";
import {
  PROCESSING_STALE_AFTER_MS,
  processCompilePointer,
  type CompilePointerOutcome,
} from "./compile-pointer-processor";
import {
  reconcileStaleTypstSandboxContainers,
  type TypstSandboxReconciliationResult,
} from "./typst-sandbox-reconciler";
import { createTypstSandboxRunner, type TypstSandboxRunner } from "./typst-sandbox";
import type { ArtifactUploader } from "./compile-processor";

export type CompilePointerWorkerHandle = { close(): Promise<void> };

interface PointerWorkerOptions {
  connection: { host: string; port: number };
  lockDuration: number;
  maxStalledCount: number;
}

export type CompilePointerWorkerFactory = (
  queueName: string,
  processor: (job: { id?: string; data: unknown }) => Promise<unknown>,
  options: PointerWorkerOptions,
) => CompilePointerWorkerHandle;

export async function startCompilePointerWorker(options: {
  connection: { host: string; port: number };
  pool: Pool;
  repository?: CompileExecutionRepository;
  sandbox?: TypstSandboxRunner;
  artifacts?: ArtifactUploader;
  onOutcome?: (jobId: string, outcome: CompilePointerOutcome) => void;
  reconcileStaleContainers?: () => Promise<TypstSandboxReconciliationResult>;
  createWorker?: CompilePointerWorkerFactory;
}): Promise<CompilePointerWorkerHandle> {
  await (
    options.reconcileStaleContainers ??
    (() => reconcileStaleTypstSandboxContainers())
  )();

  const repository =
    options.repository ?? createCompileExecutionRepository(options.pool);
  const sandbox = options.sandbox ?? createTypstSandboxRunner();
  const artifacts =
    options.artifacts ??
    (await import("../services/s3")).createS3ArtifactService();

  const processor = async (job: { id?: string; data: unknown }) => {
    const outcome = await processCompilePointer(job.data, {
      repository,
      sandbox,
      artifacts,
    });
    options.onOutcome?.(job.id ?? "", outcome);
    if (outcome.status === "failed") {
      throw new Error(outcome.error);
    }
    return outcome;
  };
  const workerOptions: PointerWorkerOptions = {
    connection: options.connection,
    lockDuration: PROCESSING_STALE_AFTER_MS,
    maxStalledCount: 2,
  };

  if (options.createWorker) {
    return options.createWorker(
      COMPILE_POINTER_QUEUE_NAME,
      processor,
      workerOptions,
    );
  }

  const { Worker } = await import("bullmq");
  const worker = new Worker(COMPILE_POINTER_QUEUE_NAME, processor, workerOptions);
  return { close: () => worker.close() };
}
