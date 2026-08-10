import type { ArtifactCleanupRepository } from "./db/artifact-cleanup-repository";
import { artifactKeyForJob } from "./workers/compile-executor";

export interface ArtifactCleanupDeleter {
  deleteArtifact(key: string): Promise<void>;
}

export type ArtifactCleanupFailureReason =
  | "ARTIFACT_KEY_MISMATCH"
  | "DELETE_FAILED"
  | "FINALIZE_FAILED";

export interface ArtifactCleanupBatchResult {
  claimed: number;
  deleted: number;
  failed: number;
  failures: Array<{
    jobId: string;
    reason: ArtifactCleanupFailureReason;
  }>;
}

export async function cleanupExpiredArtifactsOnce(input: {
  repository: ArtifactCleanupRepository;
  artifacts: ArtifactCleanupDeleter;
}): Promise<ArtifactCleanupBatchResult> {
  const claimed = await input.repository.claimExpiredArtifacts();
  const failures: ArtifactCleanupBatchResult["failures"] = [];
  let deleted = 0;

  for (const artifact of claimed) {
    const expectedKey = artifactKeyForJob(artifact.jobId);
    if (artifact.artifactKey !== expectedKey) {
      failures.push({
        jobId: artifact.jobId,
        reason: "ARTIFACT_KEY_MISMATCH",
      });
      continue;
    }

    try {
      await input.artifacts.deleteArtifact(expectedKey);
    } catch {
      failures.push({ jobId: artifact.jobId, reason: "DELETE_FAILED" });
      continue;
    }

    let finalized = false;
    try {
      finalized = await input.repository.finalizeArtifactDeletion(
        artifact.jobId,
        artifact.claimToken,
      );
    } catch {
      failures.push({ jobId: artifact.jobId, reason: "FINALIZE_FAILED" });
      continue;
    }
    if (!finalized) {
      failures.push({ jobId: artifact.jobId, reason: "FINALIZE_FAILED" });
      continue;
    }
    deleted += 1;
  }

  return {
    claimed: claimed.length,
    deleted,
    failed: failures.length,
    failures,
  };
}
