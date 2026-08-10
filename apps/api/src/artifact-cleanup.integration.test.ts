import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredArtifactsOnce } from "./artifact-cleanup-service";
import {
  createArtifactCleanupRepository,
  type ArtifactCleanupRepository,
} from "./db/artifact-cleanup-repository";
import { runMigrations } from "./db/migrate";
import type { S3ArtifactCleanupService } from "./services/s3";

const databaseUrl = process.env["DEPRESS_POSTGRES_TEST_URL"];
const s3Endpoint = process.env["DEPRESS_S3_TEST_ENDPOINT"];
const s3Bucket = process.env["DEPRESS_S3_TEST_BUCKET"];
const s3Region = process.env["DEPRESS_S3_TEST_REGION"];
const s3AccessKey = process.env["DEPRESS_S3_TEST_ACCESS_KEY_ID"];
const s3SecretKey = process.env["DEPRESS_S3_TEST_SECRET_ACCESS_KEY"];
const hasInfrastructure = Boolean(
  databaseUrl &&
    s3Endpoint &&
    s3Bucket &&
    s3Region &&
    s3AccessKey &&
    s3SecretKey,
);
const describeInfrastructure = hasInfrastructure ? describe : describe.skip;
const OWNER_ID = "artifact-cleanup-real-owner";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_ID = "33333333-3333-4333-8333-333333333331";
const SECOND_ID = "33333333-3333-4333-8333-333333333332";
const OTHER_ID = "33333333-3333-4333-8333-333333333399";
const OLD_TOKEN = "44444444-4444-4444-8444-444444444444";
const NEW_TOKEN = "55555555-5555-4555-8555-555555555555";
const SNAPSHOT_HASH = "b".repeat(64);
const PDF = Buffer.from("%PDF-real-cleanup");

describeInfrastructure("artifact cleanup against real PostgreSQL and S3", () => {
  let pool: Pool;
  let s3: S3Client;
  let artifacts: S3ArtifactCleanupService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await runMigrations(pool);
    s3 = new S3Client({
      endpoint: s3Endpoint!,
      region: s3Region!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: s3AccessKey!,
        secretAccessKey: s3SecretKey!,
      },
    });
    try {
      await s3.send(new CreateBucketCommand({ Bucket: s3Bucket }));
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== "BucketAlreadyOwnedByYou"
      ) {
        throw error;
      }
    }
    const s3Module = await import("./services/s3");
    artifacts = s3Module.createS3ArtifactCleanupService({ client: s3 });
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE compile_outbox, compile_jobs, documents, projects, "user"
       CASCADE`,
    );
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: s3Bucket }),
    );
    if (listed.Contents?.length) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: s3Bucket,
          Delete: {
            Objects: listed.Contents.flatMap((object) =>
              object.Key ? [{ Key: object.Key }] : [],
            ),
          },
        }),
      );
    }
    await pool.query(
      `INSERT INTO "user" (
         id, name, email, "emailVerified", "createdAt", "updatedAt"
       ) VALUES ($1, 'Cleanup Owner', 'cleanup-real@example.test', true, now(), now())`,
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
    s3.destroy();
    await pool.end();
  });

  async function insertExpired(
    id: string,
    artifactKey = `artifacts/${id}.pdf`,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO compile_jobs (
         id, project_id, document_id, requested_revision, template_id, format,
         input_snapshot, snapshot_hash, status, artifact_key,
         artifact_byte_length, expires_at
       ) VALUES (
         $1, $2, $3, 1, 'ieee', 'pdf', '{}'::jsonb, $4, 'succeeded',
         $5, $6, now() - interval '1 day'
       )`,
      [id, PROJECT_ID, DOCUMENT_ID, SNAPSHOT_HASH, artifactKey, PDF.byteLength],
    );
  }

  async function upload(key: string): Promise<void> {
    await s3.send(
      new PutObjectCommand({ Bucket: s3Bucket, Key: key, Body: PDF }),
    );
  }

  async function expectAbsent(key: string): Promise<void> {
    const error = await s3
      .send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }))
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );
    expect(error).toMatchObject({ $metadata: { httpStatusCode: 404 } });
  }

  async function state(id: string) {
    const result = await pool.query<{
      artifact_key: string;
      artifact_byte_length: number;
      expires_at: Date;
      artifact_cleanup_token: string | null;
      artifact_cleanup_started_at: Date | null;
      artifact_deleted_at: Date | null;
    }>(
      `SELECT artifact_key, artifact_byte_length, expires_at,
              artifact_cleanup_token, artifact_cleanup_started_at,
              artifact_deleted_at
       FROM compile_jobs
       WHERE id = $1`,
      [id],
    );
    return result.rows[0]!;
  }

  function repository(token = NEW_TOKEN): ArtifactCleanupRepository {
    return createArtifactCleanupRepository(pool, {
      createClaimToken: () => token,
    });
  }

  async function runCleanupCli(): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }> {
    const mainPath = fileURLToPath(
      new URL("./artifact-cleanup-main.ts", import.meta.url),
    );
    const cwd = fileURLToPath(new URL("../", import.meta.url));
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", mainPath], {
        cwd,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          S3_ENDPOINT: s3Endpoint,
          S3_BUCKET: s3Bucket,
          S3_REGION: s3Region,
          S3_ACCESS_KEY_ID: s3AccessKey,
          S3_SECRET_ACCESS_KEY: s3SecretKey,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.once("error", reject);
      child.once("close", (exitCode) => {
        resolve({ exitCode, stdout, stderr });
      });
    });
  }

  it("deletes a private object and finalizes an already-absent object idempotently", async () => {
    const firstKey = `artifacts/${FIRST_ID}.pdf`;
    await insertExpired(FIRST_ID);
    await insertExpired(SECOND_ID);
    await upload(firstKey);
    const publicRead = await fetch(`${s3Endpoint}/${s3Bucket}/${firstKey}`);
    expect(publicRead.status).toBe(403);

    const result = await cleanupExpiredArtifactsOnce({
      repository: repository(),
      artifacts,
    });

    expect(result).toEqual({ claimed: 2, deleted: 2, failed: 0, failures: [] });
    await expectAbsent(firstKey);
    await expectAbsent(`artifacts/${SECOND_ID}.pdf`);
    for (const id of [FIRST_ID, SECOND_ID]) {
      const row = await state(id);
      expect(row).toMatchObject({
        artifact_key: `artifacts/${id}.pdf`,
        artifact_byte_length: PDF.byteLength,
        artifact_cleanup_token: null,
        artifact_cleanup_started_at: null,
      });
      expect(row.expires_at).toBeInstanceOf(Date);
      expect(row.artifact_deleted_at).toBeInstanceOf(Date);
    }
  });

  it("recovers after a claim-only crash once the claim reaches 15 minutes", async () => {
    const key = `artifacts/${FIRST_ID}.pdf`;
    await insertExpired(FIRST_ID);
    await upload(key);
    const oldRepository = repository(OLD_TOKEN);
    expect(await oldRepository.claimExpiredArtifacts()).toMatchObject([
      { jobId: FIRST_ID, claimToken: OLD_TOKEN },
    ]);
    await pool.query(
      `UPDATE compile_jobs
       SET artifact_cleanup_started_at = now() - interval '15 minutes'
       WHERE id = $1`,
      [FIRST_ID],
    );

    const result = await cleanupExpiredArtifactsOnce({
      repository: repository(NEW_TOKEN),
      artifacts,
    });

    expect(result).toEqual({ claimed: 1, deleted: 1, failed: 0, failures: [] });
    expect(await oldRepository.finalizeArtifactDeletion(FIRST_ID, OLD_TOKEN)).toBe(
      false,
    );
    await expectAbsent(key);
    expect((await state(FIRST_ID)).artifact_deleted_at).toBeInstanceOf(Date);
  });

  it("retries an already-completed delete after a pre-finalize crash", async () => {
    const key = `artifacts/${FIRST_ID}.pdf`;
    await insertExpired(FIRST_ID);
    await upload(key);
    const oldRepository = repository(OLD_TOKEN);
    expect(await oldRepository.claimExpiredArtifacts()).toHaveLength(1);
    await artifacts.deleteArtifact(key);
    await expectAbsent(key);
    const crashed = await state(FIRST_ID);
    expect(crashed).toMatchObject({
      artifact_deleted_at: null,
      artifact_cleanup_token: OLD_TOKEN,
    });
    await pool.query(
      `UPDATE compile_jobs
       SET artifact_cleanup_started_at = now() - interval '15 minutes'
       WHERE id = $1`,
      [FIRST_ID],
    );

    const result = await cleanupExpiredArtifactsOnce({
      repository: repository(NEW_TOKEN),
      artifacts,
    });

    expect(result).toEqual({ claimed: 1, deleted: 1, failed: 0, failures: [] });
    expect(await oldRepository.finalizeArtifactDeletion(FIRST_ID, OLD_TOKEN)).toBe(
      false,
    );
    const finalized = await state(FIRST_ID);
    expect(finalized).toMatchObject({
      artifact_key: key,
      artifact_byte_length: PDF.byteLength,
      artifact_cleanup_token: null,
      artifact_cleanup_started_at: null,
    });
    expect(finalized.expires_at).toBeInstanceOf(Date);
    expect(finalized.artifact_deleted_at).toBeInstanceOf(Date);
    await expectAbsent(key);
  });

  it("leaves a failed delete claimed for stale retry and later recovery", async () => {
    const key = `artifacts/${FIRST_ID}.pdf`;
    await insertExpired(FIRST_ID);
    await upload(key);
    const failure = await cleanupExpiredArtifactsOnce({
      repository: repository(OLD_TOKEN),
      artifacts: {
        deleteArtifact: async () => {
          throw new Error("controlled network failure");
        },
      },
    });
    expect(failure).toEqual({
      claimed: 1,
      deleted: 0,
      failed: 1,
      failures: [{ jobId: FIRST_ID, reason: "DELETE_FAILED" }],
    });
    expect(await state(FIRST_ID)).toMatchObject({
      artifact_deleted_at: null,
      artifact_cleanup_token: OLD_TOKEN,
    });
    await pool.query(
      `UPDATE compile_jobs
       SET artifact_cleanup_started_at = now() - interval '15 minutes'
       WHERE id = $1`,
      [FIRST_ID],
    );
    expect(
      await cleanupExpiredArtifactsOnce({
        repository: repository(NEW_TOKEN),
        artifacts,
      }),
    ).toMatchObject({ claimed: 1, deleted: 1, failed: 0 });
    await expectAbsent(key);
  });

  it("never sends an unexpected database key to storage", async () => {
    const wrongKey = `artifacts/${OTHER_ID}.pdf`;
    await insertExpired(FIRST_ID, wrongKey);
    await upload(wrongKey);
    const deleteArtifact = vi.fn((key: string) => artifacts.deleteArtifact(key));

    const result = await cleanupExpiredArtifactsOnce({
      repository: repository(),
      artifacts: { deleteArtifact },
    });

    expect(result).toEqual({
      claimed: 1,
      deleted: 0,
      failed: 1,
      failures: [{ jobId: FIRST_ID, reason: "ARTIFACT_KEY_MISMATCH" }],
    });
    expect(deleteArtifact).not.toHaveBeenCalled();
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: wrongKey })),
    ).resolves.toBeDefined();
    expect(await state(FIRST_ID)).toMatchObject({
      artifact_deleted_at: null,
      artifact_cleanup_token: NEW_TOKEN,
    });
  });

  it("runs the actual CLI once with no candidates and exits zero", async () => {
    const result = await runCleanupCli();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      JSON.stringify({ claimed: 0, deleted: 0, failed: 0 }),
    );
  });

  it("runs the actual CLI through real deletion and exits zero", async () => {
    const key = `artifacts/${FIRST_ID}.pdf`;
    await insertExpired(FIRST_ID);
    await upload(key);

    const result = await runCleanupCli();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      JSON.stringify({ claimed: 1, deleted: 1, failed: 0 }),
    );
    await expectAbsent(key);
    expect((await state(FIRST_ID)).artifact_deleted_at).toBeInstanceOf(Date);
  });

  it("runs only one 100-row CLI batch and exits nonzero for key failures", async () => {
    for (let index = 1; index <= 101; index += 1) {
      const id = `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`;
      await insertExpired(id, `unexpected/${id}.pdf`);
    }

    const result = await runCleanupCli();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      JSON.stringify({ claimed: 100, deleted: 0, failed: 100 }),
    );
    const ownership = await pool.query<{
      claimed: string;
      unclaimed: string;
      deleted: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE artifact_cleanup_token IS NOT NULL)::text AS claimed,
         count(*) FILTER (WHERE artifact_cleanup_token IS NULL)::text AS unclaimed,
         count(*) FILTER (WHERE artifact_deleted_at IS NOT NULL)::text AS deleted
       FROM compile_jobs`,
    );
    expect(ownership.rows[0]).toEqual({
      claimed: "100",
      unclaimed: "1",
      deleted: "0",
    });
  });
});
