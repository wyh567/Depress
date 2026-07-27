import {
  PersistedCompileJobErrorCodeSchema,
  PersistedCompileJobStatusSchema,
  type PersistedCompileJobErrorCode,
  type PersistedCompileJobStatus,
} from "@depress/ast";
import type { Pool } from "pg";

export interface CompileExecutionRow {
  id: string;
  inputSnapshot: unknown;
  snapshotHash: string;
  status: PersistedCompileJobStatus;
  processingStartedAt: Date | null;
}

interface CompileExecutionDbRow {
  id: string;
  input_snapshot: unknown;
  snapshot_hash: string;
  status: string;
  processing_started_at: Date | null;
}

function parseRow(row: CompileExecutionDbRow): CompileExecutionRow {
  return {
    id: row.id,
    inputSnapshot: row.input_snapshot,
    snapshotHash: row.snapshot_hash,
    status: PersistedCompileJobStatusSchema.parse(row.status),
    processingStartedAt: row.processing_started_at,
  };
}

export function createCompileExecutionRepository(pool: Pool) {
  return {
    async load(jobId: string): Promise<CompileExecutionRow | undefined> {
      const result = await pool.query<CompileExecutionDbRow>(
        `
          SELECT id, input_snapshot, snapshot_hash, status,
                 processing_started_at
          FROM compile_jobs
          WHERE id = $1
        `,
        [jobId],
      );
      return result.rows[0] ? parseRow(result.rows[0]) : undefined;
    },

    async failQueued(
      jobId: string,
      errorCode: PersistedCompileJobErrorCode,
    ): Promise<boolean> {
      const safeCode = PersistedCompileJobErrorCodeSchema.parse(errorCode);
      const result = await pool.query(
        `
          UPDATE compile_jobs
          SET status = 'failed',
              error_code = $2,
              processing_token = NULL,
              processing_started_at = NULL,
              updated_at = now()
          WHERE id = $1 AND status = 'queued'
        `,
        [jobId, safeCode],
      );
      return (result.rowCount ?? 0) === 1;
    },

    async claim(
      jobId: string,
      token: string,
      staleBefore: Date,
    ): Promise<boolean> {
      const result = await pool.query(
        `
          UPDATE compile_jobs
          SET status = 'processing',
              processing_token = $2,
              processing_started_at = now(),
              error_code = NULL,
              updated_at = now()
          WHERE id = $1
            AND (
              status = 'queued'
              OR (
                status = 'processing'
                AND processing_started_at < $3
              )
            )
        `,
        [jobId, token, staleBefore],
      );
      return (result.rowCount ?? 0) === 1;
    },

    async succeed(
      jobId: string,
      token: string,
      artifactKey: string,
      pdfByteLength: number,
    ): Promise<boolean> {
      const result = await pool.query(
        `
          UPDATE compile_jobs
          SET status = 'succeeded',
              artifact_key = $3,
              artifact_byte_length = $4,
              error_code = NULL,
              processing_token = NULL,
              processing_started_at = NULL,
              updated_at = now()
          WHERE id = $1
            AND status = 'processing'
            AND processing_token = $2
        `,
        [jobId, token, artifactKey, pdfByteLength],
      );
      return (result.rowCount ?? 0) === 1;
    },

    async failOwned(
      jobId: string,
      token: string,
      errorCode: PersistedCompileJobErrorCode,
    ): Promise<boolean> {
      const safeCode = PersistedCompileJobErrorCodeSchema.parse(errorCode);
      const result = await pool.query(
        `
          UPDATE compile_jobs
          SET status = 'failed',
              error_code = $3,
              artifact_key = NULL,
              artifact_byte_length = NULL,
              processing_token = NULL,
              processing_started_at = NULL,
              updated_at = now()
          WHERE id = $1
            AND status = 'processing'
            AND processing_token = $2
        `,
        [jobId, token, safeCode],
      );
      return (result.rowCount ?? 0) === 1;
    },
  };
}

export type CompileExecutionRepository = ReturnType<
  typeof createCompileExecutionRepository
>;
