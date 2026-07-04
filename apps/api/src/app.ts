import Fastify, { type FastifyInstance } from "fastify";
import { createJobStore } from "./services/job-store";
import { registerCompileRoute } from "./routes/compile";
import { registerJobsRoute } from "./routes/jobs";

// buildApp never listens on a port — callers (tests via app.inject, a future
// server entrypoint via app.listen) decide that. Each app gets its own job
// store instance.
export function buildApp(): FastifyInstance {
  const app = Fastify();
  const store = createJobStore();
  registerCompileRoute(app, store);
  registerJobsRoute(app, store);
  return app;
}

export * from "./contracts";
