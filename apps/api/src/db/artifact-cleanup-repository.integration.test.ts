import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createArtifactCleanupRepository,
  type ClaimedArtifact,
} from "./artifact-cleanup-repository";
import { runMigrations } from "./migrate";

const databaseUrl = process.env["DEPRESS_POSTGRES_TEST_URL"];
const describeDatabase = databaseUrl ? describe : describe.skip;
const OWNER_ID = "artifact-cleanup-owner";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_HASH = "a".repeat(64);
const OLD_TOKEN = "44444444-4444-4444-8444-444444444444";
const NEW_TOKEN = "55555555-5555-4555-8555-555555555555";

function jobId(index: number): string {
  return `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
}

describeDatabase("artifact cleanup repository", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 12 });
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE compile_outbox, compile_jobs, documents, projects, "user"
       CASCADE`,
    );
    await pool.query(
      `INSERT INTO "user" (
         id, name, email, "emailVerified", "createdAt", "updatedAt"
       ) VALUES ($1, 'Cleanup Owner', 'cleanup@example.test', true, now(), now())`,
      [OWNER_ID],
    );
    await pool.query(
      `INSERT INTO projects (id, owner_user_id, name, is_default)
       VALUES ($1, $2, 'Cleanup Project', true)`,
      [PROJECT_ID, OWNER_ID],
    );
    await pool.query(
      `INSERT INTO documents (
         id, project_id, envelope_json, revision, content_hash
       ) VALUES ($1, $2, '{"schemaVersion":1}'::jsonb, 1, $3)`,
      [DOCUMENT_ID, PROJECT_ID, SNAPSHOT_HASH],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertSucceeded(input: {
    id: string;
    expiresAgo: string;
    artifactKey?: string;
    cleanupToken?: string;
    cleanupStartedAgo?: string;
    deleted?: boolean;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO compile_jobs (
         id, project_id, document_id, requested_revision, template_id, format,
         input_snapshot, snapshot_hash, status, artifact_key,
         artifact_byte_length, expires_at, artifact_cleanup_token,
         artifact_cleanup_started_at, artifact_deleted_at
       ) VALUES (
         $1, $2, $3, 1, 'ieee', 'pdf', '{}'::jsonb, $4, 'succeeded',
         $5, 100, now() - $6::interval, $7,
         CASE WHEN $8::text IS NULL THEN NULL ELSE now() - $8::interval END,
         CASE WHEN $9::boolean THEN now() ELSE NULL END
       )`,
      [
        input.id,
        PROJECT_ID,
        DOCUMENT_ID,
        SNAPSHOT_HASH,
        input.artifactKey ?? `artifacts/${input.id}.pdf`,
        input.expiresAgo,
        input.cleanupToken ?? null,
        input.cleanupStartedAgo ?? null,
        input.deleted ?? false,
      ],
    );
  }

  async function insertNonSucceeded(
    id: string,
    status: "accepted" | "queued" | "processing" | "failed",
  ): Promise<void> {
    await pool.query(
      `INSERT INTO compile_jobs (
         id, project_id, document_id, requested_revision, template_id, format,
         input_snapshot, snapshot_hash, status, error_code,
         processing_token, processing_started_at
       ) VALUES (
         $1, $2, $3, 1, 'ieee', 'pdf', '{}'::jsonb, $4, $5,
         CASE WHEN $5 = 'failed' THEN 'COMPILE_FAILED' ELSE NULL END,
         CASE WHEN $5 = 'processing' THEN $6::uuid ELSE NULL END,
         CASE WHEN $5 = 'processing' THEN now() ELSE NULL END
       )`,
      [id, PROJECT_ID, DOCUMENT_ID, SNAPSHOT_HASH, status, OLD_TOKEN],
    );
  }

  it("claims only expired eligible artifacts and reclaims the exact stale boundary", async () => {
    const expired = jobId(1);
    const staleBoundary = jobId(2);
    const unexpired = jobId(3);
    const deleted = jobId(4);
    const freshClaim = jobId(5);
    await insertSucceeded({ id: expired, expiresAgo: "2 days" });
    await insertSucceeded({
      id: staleBoundary,
      expiresAgo: "1 day",
      cleanupToken: OLD_TOKEN,
      cleanupStartedAgo: "15 minutes",
    });
    await insertSucceeded({ id: unexpired, expiresAgo: "-1 day" });
    await insertSucceeded({ id: deleted, expiresAgo: "3 days", deleted: true });
    await insertSucceeded({
      id: freshClaim,
      expiresAgo: "3 days",
      cleanupToken: OLD_TOKEN,
      cleanupStartedAgo: "14 minutes 59 seconds",
    });
    await Promise.all(
      (["accepted", "queued", "processing", "failed"] as const).map(
        (status, index) => insertNonSucceeded(jobId(10 + index), status),
      ),
    );

    const before = await pool.query<{ now: Date }>(
      "SELECT clock_timestamp() AS now",
    );
    const claimed = await createArtifactCleanupRepository(pool, {
      createClaimToken: () => NEW_TOKEN,
    }).claimExpiredArtifacts();
    const after = await pool.query<{ now: Date }>(
      "SELECT clock_timestamp() AS now",
    );

    expect(claimed.map((row) => row.jobId)).toEqual([expired, staleBoundary]);
    expect(claimed.every((row) => row.claimToken === NEW_TOKEN)).toBe(true);
    expect(claimed.every((row) => row.claimStartedAt >= before.rows[0]!.now)).toBe(
      true,
    );
    expect(claimed.every((row) => row.claimStartedAt <= after.rows[0]!.now)).toBe(
      true,
    );
    const untouched = await pool.query<{
      id: string;
      artifact_cleanup_token: string | null;
    }>(
      `SELECT id, artifact_cleanup_token
       FROM compile_jobs
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[unexpired, deleted, freshClaim, ...[10, 11, 12, 13].map(jobId)]],
    );
    expect(untouched.rows.find((row) => row.id === freshClaim)?.artifact_cleanup_token).toBe(
      OLD_TOKEN,
    );
    expect(
      untouched.rows
        .filter((row) => row.id !== freshClaim)
        .every((row) => row.artifact_cleanup_token === null),
    ).toBe(true);
  });

  it("claims at most 100 candidates in deterministic priority order", async () => {
    for (let index = 1; index <= 101; index += 1) {
      await insertSucceeded({ id: jobId(index), expiresAgo: "1 day" });
    }

    const claimed = await createArtifactCleanupRepository(pool, {
      createClaimToken: () => NEW_TOKEN,
    }).claimExpiredArtifacts();

    expect(claimed).toHaveLength(100);
    expect(claimed.map((row) => row.jobId)).toEqual(
      Array.from({ length: 100 }, (_, index) => jobId(index + 1)),
    );
    const remaining = await pool.query<{ id: string }>(
      `SELECT id FROM compile_jobs
       WHERE artifact_cleanup_token IS NULL
       ORDER BY id`,
    );
    expect(remaining.rows).toEqual([{ id: jobId(101) }]);
  });

  it("lets concurrent claimers make disjoint progress with locked rows skipped", async () => {
    for (let index = 1; index <= 4; index += 1) {
      await insertSucceeded({ id: jobId(index), expiresAgo: "1 day" });
    }
    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstHasLocks!: () => void;
    const firstLocked = new Promise<void>((resolve) => {
      firstHasLocks = resolve;
    });
    const firstRepository = createArtifactCleanupRepository(pool, {
      createClaimToken: () => OLD_TOKEN,
      beforeClaimCommit: async () => {
        firstHasLocks();
        await firstMayCommit;
      },
    });
    const secondRepository = createArtifactCleanupRepository(pool, {
      createClaimToken: () => NEW_TOKEN,
    });

    const firstPromise = firstRepository.claimExpiredArtifacts(2);
    await firstLocked;
    const second = await secondRepository.claimExpiredArtifacts(2);
    expect(second).toHaveLength(2);
    releaseFirst();
    const first = await firstPromise;

    expect(first).toHaveLength(2);
    expect(new Set([...first, ...second].map((row) => row.jobId)).size).toBe(4);
    expect(first.every((row) => row.claimToken === OLD_TOKEN)).toBe(true);
    expect(second.every((row) => row.claimToken === NEW_TOKEN)).toBe(true);
  });

  it("finalizes only the current owner token and retains artifact audit fields", async () => {
    const current = jobId(1);
    const reclaimed = jobId(2);
    await insertSucceeded({
      id: current,
      expiresAgo: "2 days",
      cleanupToken: OLD_TOKEN,
      cleanupStartedAgo: "1 minute",
    });
    await insertSucceeded({
      id: reclaimed,
      expiresAgo: "3 days",
      cleanupToken: OLD_TOKEN,
      cleanupStartedAgo: "16 minutes",
    });
    const repository = createArtifactCleanupRepository(pool, {
      createClaimToken: () => NEW_TOKEN,
    });
    expect(await repository.finalizeArtifactDeletion(current, NEW_TOKEN)).toBe(
      false,
    );
    const before = await pool.query<{ now: Date }>(
      "SELECT clock_timestamp() AS now",
    );
    expect(await repository.finalizeArtifactDeletion(current, OLD_TOKEN)).toBe(
      true,
    );
    const after = await pool.query<{ now: Date }>(
      "SELECT clock_timestamp() AS now",
    );
    expect(await repository.finalizeArtifactDeletion(current, OLD_TOKEN)).toBe(
      false,
    );

    const reclaimedRows = await repository.claimExpiredArtifacts(1);
    expect(reclaimedRows).toMatchObject([
      { jobId: reclaimed, claimToken: NEW_TOKEN },
    ] satisfies Partial<ClaimedArtifact>[]);
    expect(await repository.finalizeArtifactDeletion(reclaimed, OLD_TOKEN)).toBe(
      false,
    );
    expect(await repository.finalizeArtifactDeletion(reclaimed, NEW_TOKEN)).toBe(
      true,
    );

    const rows = await pool.query<{
      id: string;
      artifact_key: string;
      artifact_byte_length: number;
      expires_at: Date;
      artifact_deleted_at: Date;
      artifact_cleanup_token: string | null;
      artifact_cleanup_started_at: Date | null;
    }>(
      `SELECT id, artifact_key, artifact_byte_length, expires_at,
              artifact_deleted_at, artifact_cleanup_token,
              artifact_cleanup_started_at
       FROM compile_jobs
       ORDER BY id`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      artifact_key: `artifacts/${current}.pdf`,
      artifact_byte_length: 100,
      artifact_cleanup_token: null,
      artifact_cleanup_started_at: null,
    });
    expect(rows.rows[0]!.artifact_deleted_at >= before.rows[0]!.now).toBe(true);
    expect(rows.rows[0]!.artifact_deleted_at <= after.rows[0]!.now).toBe(true);
    expect(rows.rows.every((row) => row.expires_at instanceof Date)).toBe(true);
    expect(rows.rows.every((row) => row.artifact_deleted_at instanceof Date)).toBe(
      true,
    );
  });
});
