import {
  CompileQueuePointerSchema,
  type CompileQueuePointer,
} from "@depress/ast";
import type { Pool } from "pg";
import type { CompilePointerQueue } from "../queue/compile-pointer-queue";

const MAX_BATCH_SIZE = 100;
const QUEUE_ERROR_CODE = "QUEUE_UNAVAILABLE";

interface OutboxRow {
  id: string;
  job_id: string;
  snapshot_hash: string;
}

export interface PublishOutboxResult {
  selected: number;
  published: number;
  failed: number;
}

export async function publishCompileOutbox(options: {
  pool: Pool;
  queue: CompilePointerQueue;
  batchSize?: number;
}): Promise<PublishOutboxResult> {
  const batchSize = options.batchSize ?? 25;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error("INVALID_OUTBOX_BATCH_SIZE");
  }

  const client = await options.pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<OutboxRow>(
      `
        SELECT outbox.id, outbox.job_id, outbox.snapshot_hash
        FROM compile_outbox AS outbox
        WHERE outbox.published_at IS NULL
        ORDER BY outbox.created_at, outbox.id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `,
      [batchSize],
    );
    let published = 0;
    let failed = 0;

    for (const row of selected.rows) {
      const pointer: CompileQueuePointer = CompileQueuePointerSchema.parse({
        jobId: row.job_id,
        snapshotHash: row.snapshot_hash,
      });
      try {
        await options.queue.enqueue(pointer);
        await client.query(
          `
            UPDATE compile_outbox
            SET
              published_at = now(),
              attempt_count = attempt_count + 1,
              last_error_code = NULL
            WHERE id = $1
          `,
          [row.id],
        );
        await client.query(
          `
            UPDATE compile_jobs
            SET status = 'queued', updated_at = now()
            WHERE id = $1 AND status = 'accepted'
          `,
          [row.job_id],
        );
        published += 1;
      } catch {
        await client.query(
          `
            UPDATE compile_outbox
            SET
              attempt_count = attempt_count + 1,
              last_error_code = $2
            WHERE id = $1
          `,
          [row.id, QUEUE_ERROR_CODE],
        );
        failed += 1;
      }
    }

    await client.query("COMMIT");
    return { selected: selected.rowCount ?? 0, published, failed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
