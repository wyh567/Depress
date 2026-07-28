import type { FastifyInstance } from "fastify";

const READINESS_TIMEOUT_MS = 3_000;

async function withTimeout(operation: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("READINESS_TIMEOUT")), READINESS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function registerHealthRoutes(
  app: FastifyInstance,
  readiness: () => Promise<unknown>
): void {
  app.get("/health/live", async (_request, reply) => reply.send({ status: "alive" }));

  app.get("/health/ready", async (request, reply) => {
    try {
      await withTimeout(Promise.resolve(readiness()));
      return reply.send({ status: "ready" });
    } catch {
      request.log.warn("Readiness dependency check failed");
      return reply.code(503).send({ status: "not_ready" });
    }
  });
}
