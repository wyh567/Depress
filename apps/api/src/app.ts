import Fastify, { type FastifyInstance } from "fastify";
import { createJobStore, type JobStore } from "./services/job-store";
import { registerCompileRoute } from "./routes/compile";
import { registerJobsRoute, type ArtifactUrlSigner } from "./routes/jobs";
import {
  createInMemoryCompileQueue,
  type CompileQueue,
} from "./queue/compile-queue";

// buildApp never listens on a port — callers (tests via app.inject, a future
// server entrypoint via app.listen) decide that. Each app gets its own job
// store instance. The queue is injectable: production passes the BullMQ
// adapter (createBullmqCompileQueue); tests and Redis-less dev get the
// in-memory default.
// signArtifactUrl is injectable like the queue: production passes
// createS3ArtifactService().getSignedDownloadUrl (services/s3 — imported by
// the server entrypoint so its fail-fast env check runs at boot); tests
// inject a fake. Without it, succeeded jobs answer 500 ARTIFACT_UNAVAILABLE.
export function buildApp(
  options: {
    queue?: CompileQueue;
    signArtifactUrl?: ArtifactUrlSigner;
    // Test seam: lets integration tests drive job state transitions the way
    // the worker's onOutcome mirror would.
    store?: JobStore;
  } = {},
): FastifyInstance {
  const app = Fastify();
  const store = options.store ?? createJobStore();
  const queue = options.queue ?? createInMemoryCompileQueue();
  registerCompileRoute(app, store, queue);
  registerJobsRoute(app, store, options.signArtifactUrl);
  return app;
}

export * from "./contracts";
export * from "./queue/compile-queue";
