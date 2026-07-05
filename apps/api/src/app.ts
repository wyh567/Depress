import Fastify, { type FastifyInstance } from "fastify";
import { createJobStore } from "./services/job-store";
import { registerCompileRoute } from "./routes/compile";
import { registerJobsRoute } from "./routes/jobs";
import {
  createInMemoryCompileQueue,
  type CompileQueue,
} from "./queue/compile-queue";

// buildApp never listens on a port — callers (tests via app.inject, a future
// server entrypoint via app.listen) decide that. Each app gets its own job
// store instance. The queue is injectable: production passes the BullMQ
// adapter (createBullmqCompileQueue); tests and Redis-less dev get the
// in-memory default.
export function buildApp(
  options: { queue?: CompileQueue } = {},
): FastifyInstance {
  const app = Fastify();
  const store = createJobStore();
  const queue = options.queue ?? createInMemoryCompileQueue();
  registerCompileRoute(app, store, queue);
  registerJobsRoute(app, store);
  return app;
}

export * from "./contracts";
export * from "./queue/compile-queue";
