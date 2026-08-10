import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export const ARTIFACT_CLEANUP_BATCH_LIMIT = 100;
export const ARTIFACT_CLEANUP_STALE_AFTER_MINUTES = 15;

interface ClaimedArtifactRow {
  job_id: string;
  artifact_key: string;
  artifact_byte_length: number;
  expires_at: Date;
  claim_token: string;
  claim_started_at: Date;
}

export interface ClaimedArtifact {
  jobId: string;
  artifactKey: string;
  artifactByteLength: number;
  expiresAt: Date;
  claimToken: string;
  claimStartedAt: Date;
}

export interface ArtifactCleanupRepositoryOptions {
  createClaimToken?: () => string;
  beforeClaimCommit?: (
    client: PoolClient,
    claimed: readonly ClaimedArtifact[],
  ) => void | Promise<void>;
}

function requireBatchSize(batchSize: number): void {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > ARTIFACT_CLEANUP_BATCH_LIMIT
  ) {
    throw new Error("Artifact cleanup batch size must be between 1 and 100");
  }
}

function parseClaimed(row: ClaimedArtifactRow): ClaimedArtifact {
  return {
    jobId: row.job_id,
    artifactKey: row.artifact_key,
    artifactByteLength: row.artifact_byte_length,
    expiresAt: row.expires_at,
    claimToken: row.claim_token,
    claimStartedAt: row.claim_started_at,
  };
}

export function createArtifactCleanupRepository(
  pool: Pool,
  options: ArtifactCleanupRepositoryOptions = {},
) {
  return {
    async claimExpiredArtifacts(
      batchSize = ARTIFACT_CLEANUP_BATCH_LIMIT,
    ): Promise<ClaimedArtifact[]> {
      requireBatchSize(batchSize);
      const claimToken = (options.createClaimToken ?? randomUUID)();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<ClaimedArtifactRow>(
          `
            WITH candidates AS (
              SELECT
                id,
                expires_at,
                artifact_cleanup_started_at AS previous_cleanup_started_at
              FROM compile_jobs
              WHERE status = 'succeeded'
                AND expires_at <= now()
                AND artifact_deleted_at IS NULL
                AND (
                  artifact_cleanup_token IS NULL
                  OR artifact_cleanup_started_at <=
                    now() - interval '15 minutes'
                )
              ORDER BY
                expires_at ASC,
                artifact_cleanup_started_at ASC NULLS FIRST,
                id ASC
              FOR UPDATE SKIP LOCKED
              LIMIT $1
            ), claimed AS (
              UPDATE compile_jobs AS jobs
              SET artifact_cleanup_token = $2,
                  artifact_cleanup_started_at = now()
              FROM candidates
              WHERE jobs.id = candidates.id
              RETURNING
                jobs.id AS job_id,
                jobs.artifact_key,
                jobs.artifact_byte_length,
                jobs.expires_at,
                jobs.artifact_cleanup_token AS claim_token,
                jobs.artifact_cleanup_started_at AS claim_started_at
            )
            SELECT claimed.*
            FROM claimed
            JOIN candidates ON candidates.id = claimed.job_id
            ORDER BY
              candidates.expires_at ASC,
              candidates.previous_cleanup_started_at ASC NULLS FIRST,
              candidates.id ASC
          `,
          [batchSize, claimToken],
        );
        const claimed = result.rows.map(parseClaimed);
        await options.beforeClaimCommit?.(client, claimed);
        await client.query("COMMIT");
        return claimed;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async finalizeArtifactDeletion(
      jobId: string,
      claimToken: string,
    ): Promise<boolean> {
      const result = await pool.query(
        `
          UPDATE compile_jobs
          SET artifact_deleted_at = now(),
              artifact_cleanup_token = NULL,
              artifact_cleanup_started_at = NULL
          WHERE id = $1
            AND artifact_cleanup_token = $2
            AND status = 'succeeded'
            AND artifact_deleted_at IS NULL
        `,
        [jobId, claimToken],
      );
      return (result.rowCount ?? 0) === 1;
    },
  };
}

export type ArtifactCleanupRepository = ReturnType<
  typeof createArtifactCleanupRepository
>;
