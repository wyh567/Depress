import { COMPILE_QUEUE_NAME } from "../queue/compile-queue";
import { processCompileJob, type CompileJobOutcome } from "./compile-processor";
import { createTypstSandboxRunner } from "./typst-sandbox";

// Thin BullMQ wiring — all logic lives in processCompileJob (unit-tested);
// this file is only exercised by the optional Redis/Docker integration path.
// Workers run in their own process and never share memory with the API
// (cursorrules); onOutcome lets a dev entrypoint mirror status into a store.
export async function startCompileWorker(options: {
  connection: { host: string; port: number };
  onOutcome?: (jobId: string, outcome: CompileJobOutcome) => void;
}): Promise<{ close(): Promise<void> }> {
  const { Worker } = await import("bullmq");
  const sandbox = createTypstSandboxRunner();

  const worker = new Worker(
    COMPILE_QUEUE_NAME,
    async (job) => {
      const outcome = await processCompileJob(job.data as unknown, {
        sandbox,
      });
      options.onOutcome?.(job.id ?? "", outcome);
      if (outcome.status === "failed") {
        // Surface only the safe error code to BullMQ job state.
        throw new Error(outcome.error);
      }
      return outcome;
    },
    { connection: options.connection },
  );

  return { close: () => worker.close() };
}
