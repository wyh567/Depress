import cors from "@fastify/cors";
import { buildApp } from "./app";
import { parseRuntimeEnv, redisConnection } from "./env";
import { createBullmqCompileQueue } from "./queue/compile-queue";
import { createBullmqJobReader } from "./services/job-reader";
// Importing services/s3 here (and only here on the API side) triggers its
// module-init env validation: a server missing S3 config dies at boot, not
// on the first succeeded-job read.
import { createS3ArtifactService } from "./services/s3";

async function main(): Promise<void> {
  const env = parseRuntimeEnv(process.env);
  const connection = redisConnection(env);
  const s3 = createS3ArtifactService();

  const app = buildApp({
    queue: createBullmqCompileQueue(connection),
    jobs: createBullmqJobReader(connection),
    signArtifactUrl: (key) => s3.getSignedDownloadUrl(key),
    ...(env.CROSSREF_MAILTO ? { crossrefMailto: env.CROSSREF_MAILTO } : {}),
  });
  // Browser calls cross origins (web on :3000, API on :3001); only the
  // configured web origin is allowed.
  await app.register(cors, { origin: env.CORS_ORIGIN });

  const close = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`DePress API listening on :${env.PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
