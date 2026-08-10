import cors from "@fastify/cors";
import { Queue } from "bullmq";
import { buildApp } from "./app";
import { parseApiEnv, redisConnection } from "./env";
import { registerHealthRoutes } from "./health";
// Importing services/s3 here (and only here on the API side) triggers its
// module-init env validation: a server missing S3 config dies at boot, not
// on the first succeeded-job read.
import { createS3ArtifactService } from "./services/s3";
import { createMentorAuth } from "./auth/auth";
import { createPostgresPool } from "./db/pool";
import {
  createRateLimitRedis,
  registerRateLimitRedisLifecycle,
} from "./rate-limit-redis";

async function main(): Promise<void> {
  const env = parseApiEnv(process.env);
  const connection = redisConnection(env);
  const rateLimitRedis = createRateLimitRedis(connection);
  const s3 = createS3ArtifactService();
  const pool = createPostgresPool(env.DATABASE_URL);
  const auth = createMentorAuth(pool, {
    secret: env.BETTER_AUTH_SECRET,
    origin: env.AUTH_ORIGIN,
    isProduction: env.NODE_ENV === "production",
  });

  const app = buildApp({
    signArtifactUrl: (key) => s3.getSignedDownloadUrl(key),
    ...(env.CROSSREF_MAILTO ? { crossrefMailto: env.CROSSREF_MAILTO } : {}),
    auth,
    authOrigin: env.AUTH_ORIGIN,
    database: pool,
    logLevel: env.LOG_LEVEL,
    bodyLimitBytes: env.API_BODY_LIMIT_BYTES,
    rateLimitMax: env.API_RATE_LIMIT_MAX,
    rateLimitWindowMs: env.API_RATE_LIMIT_WINDOW_MS,
    doiRateLimitMax: env.DOI_RATE_LIMIT_MAX,
    compileRateLimitMax: env.COMPILE_RATE_LIMIT_MAX,
    compileActiveJobLimit: env.COMPILE_ACTIVE_JOB_LIMIT,
    compileSnapshotMaxBytes: env.COMPILE_SNAPSHOT_MAX_BYTES,
    rateLimitRedis,
  });
  // Browser calls cross origins (web on :3000, API on :3001); only the
  // configured web origin is allowed.
  await app.register(cors, { origin: env.PUBLIC_ORIGIN, credentials: true });
  const readinessQueue = new Queue("__depress_readiness", { connection });
  registerHealthRoutes(app, async () => {
    await Promise.all([
      pool.query("SELECT 1"),
      readinessQueue.waitUntilReady(),
      rateLimitRedis.ping(),
    ]);
  });
  registerRateLimitRedisLifecycle(app, rateLimitRedis);
  app.addHook("onClose", async () => {
    await Promise.all([
      readinessQueue.close(),
      pool.end(),
    ]);
  });

  const close = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  await app.listen({ port: env.API_PORT, host: env.API_BIND_HOST });
  console.log(`DePress API listening on ${env.API_BIND_HOST}:${env.API_PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
