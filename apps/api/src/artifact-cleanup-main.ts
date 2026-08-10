import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import type { ArtifactCleanupBatchResult } from "./artifact-cleanup-service";
import { cleanupExpiredArtifactsOnce } from "./artifact-cleanup-service";
import { createArtifactCleanupRepository } from "./db/artifact-cleanup-repository";
import { createPostgresPool } from "./db/pool";
import type { S3ArtifactCleanupService } from "./services/s3";

export async function runArtifactCleanupCli(input: {
  runBatch: () => Promise<ArtifactCleanupBatchResult>;
  close: () => void | Promise<void>;
  report: (message: string) => void;
}): Promise<number> {
  let exitCode = 1;
  try {
    const result = await input.runBatch();
    input.report(
      JSON.stringify({
        claimed: result.claimed,
        deleted: result.deleted,
        failed: result.failed,
      }),
    );
    exitCode = result.failed === 0 ? 0 : 1;
  } catch {
    input.report("Artifact cleanup failed");
  } finally {
    try {
      await input.close();
    } catch {
      input.report("Artifact cleanup resource shutdown failed");
      exitCode = 1;
    }
  }
  return exitCode;
}

export async function runArtifactCleanupMain(): Promise<number> {
  let pool: Pool | undefined;
  let artifacts: S3ArtifactCleanupService | undefined;
  try {
    const cleanupPool = createPostgresPool();
    pool = cleanupPool;
    const s3Module = await import("./services/s3");
    const cleanupArtifacts = s3Module.createS3ArtifactCleanupService();
    artifacts = cleanupArtifacts;
    const repository = createArtifactCleanupRepository(cleanupPool);
    return await runArtifactCleanupCli({
      runBatch: () =>
        cleanupExpiredArtifactsOnce({
          repository,
          artifacts: cleanupArtifacts,
        }),
      close: async () => {
        cleanupArtifacts.close();
        await cleanupPool.end();
      },
      report: (message) => console.log(message),
    });
  } catch {
    artifacts?.close();
    await pool?.end().catch(() => undefined);
    console.error("Artifact cleanup failed");
    return 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runArtifactCleanupMain().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
