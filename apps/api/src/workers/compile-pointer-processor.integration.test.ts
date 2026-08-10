import { randomUUID } from "node:crypto";
import {
  EmptyPersistedDocumentEnvelope,
  type PersistedDocumentEnvelope,
} from "@depress/ast";
import type { TypstCompileProject } from "@depress/transformers";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildApp } from "../app";
import { createMentorAuth } from "../auth/auth";
import { seedMentorAccount } from "../auth/seed-mentor";
import { createCompileExecutionRepository } from "../db/compile-execution-repository";
import { createCompileJobRepository } from "../db/compile-job-repository";
import { createDocumentRepository } from "../db/document-repository";
import { runMigrations } from "../db/migrate";
import { createReferenceRepository } from "../db/reference-repository";
import {
  processCompilePointer,
  type CompilePointerProcessorDeps,
} from "./compile-pointer-processor";

const databaseUrl = process.env["DEPRESS_POSTGRES_TEST_URL"];
const describeDatabase = databaseUrl ? describe : describe.skip;
const AUTH_ORIGIN = "http://localhost:3000";
const AUTH_SECRET = "day7-pointer-worker-secret-at-least-32-characters";
const PDF = Buffer.from("%PDF-1.7 trusted output");
const ENVELOPE: PersistedDocumentEnvelope = {
  schemaVersion: 1,
  editor: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Trusted snapshot title" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "citation", attrs: { citeKey: "trusted-ref" } },
        ],
      },
    ],
  },
  metadata: { title: "Trusted snapshot title", keywords: ["worker"] },
};
const REFERENCE = {
  id: "trusted-ref",
  type: "article-journal" as const,
  title: "Trusted reference",
};

type Headers = Record<string, string | string[] | number | undefined>;
function cookieFrom(response: { headers: Headers }): string {
  const header = response.headers["set-cookie"];
  const first = Array.isArray(header) ? header[0] : header;
  if (!first || typeof first === "number") throw new Error("Missing cookie");
  return first.split(";", 1)[0]!;
}

describeDatabase("persisted compile pointer worker and download boundary", () => {
  let pool: Pool;
  let applied: string[] = [];
  let rerun: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    applied = (await runMigrations(pool)).applied;
    rerun = (await runMigrations(pool)).applied;
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE
        "verification", "account", "session", "user",
        compile_outbox, compile_jobs, project_references, documents, projects
       CASCADE`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createQueuedJob(email = "pointer@example.test") {
    const mentor = await seedMentorAccount(
      pool,
      {
        secret: AUTH_SECRET,
        origin: AUTH_ORIGIN,
        isProduction: false,
      },
      { email, password: "pointer-password", name: "Pointer Mentor" },
    );
    const document = await createDocumentRepository(pool).create({
      projectId: mentor.defaultProjectId,
      envelope: ENVELOPE,
    });
    await createReferenceRepository(pool).create({
      projectId: mentor.defaultProjectId,
      item: REFERENCE,
    });
    const created = await createCompileJobRepository(pool).createForOwner({
      ownerUserId: mentor.userId,
      request: {
        documentId: document.id,
        revision: 1,
        templateId: "ieee",
        format: "pdf",
      },
    });
    await pool.query(
      "UPDATE compile_jobs SET status = 'queued' WHERE id = $1",
      [created.resource.jobId],
    );
    return { mentor, document, created };
  }

  function dependencies(overrides: {
    compile?: (project: TypstCompileProject) => Promise<Buffer>;
    upload?: (key: string, pdf: Buffer) => Promise<void>;
    now?: () => Date;
  } = {}) {
    const compile = vi.fn(overrides.compile ?? (async () => PDF));
    const uploadArtifact = vi.fn(
      overrides.upload ?? (async () => undefined),
    );
    const deps: CompilePointerProcessorDeps = {
      repository: createCompileExecutionRepository(pool),
      sandbox: { compile },
      artifacts: { uploadArtifact },
      ...(overrides.now ? { now: overrides.now } : {}),
    };
    return { deps, compile, uploadArtifact };
  }

  async function stored(jobId: string) {
    const result = await pool.query<{
      status: string;
      error_code: string | null;
      artifact_key: string | null;
      artifact_byte_length: number | null;
      expires_at: Date | null;
    }>(
      `SELECT status, error_code, artifact_key, artifact_byte_length, expires_at
       FROM compile_jobs WHERE id = $1`,
      [jobId],
    );
    return result.rows[0]!;
  }

  it("applies ownership migration once and reruns with zero migrations", async () => {
    const ledger = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect([
      ...applied,
      ...ledger.rows.map((row) => row.name),
    ]).toContain("0005_compile_job_processing_ownership.sql");
    expect(rerun).toEqual([]);
  });

  it("claims queued work once, uses the trusted snapshot, and makes duplicates no-ops", async () => {
    const { created } = await createQueuedJob();
    const { deps, compile, uploadArtifact } = dependencies();
    const before = await pool.query<{ now: Date }>(
      "SELECT clock_timestamp() AS now",
    );
    const pointer = {
      jobId: created.resource.jobId,
      snapshotHash: created.resource.snapshotHash,
    };

    await expect(processCompilePointer(pointer, deps)).resolves.toMatchObject({
      status: "succeeded",
      artifactKey: `artifacts/${pointer.jobId}.pdf`,
    });
    await expect(processCompilePointer(pointer, deps)).resolves.toEqual({
      status: "noop",
      reason: "terminal",
    });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile.mock.calls[0]![0].main).toContain("Trusted snapshot title");
    expect(compile.mock.calls[0]![0].bibliography).toContain(
      "Trusted reference",
    );
    expect(uploadArtifact).toHaveBeenCalledWith(
      `artifacts/${pointer.jobId}.pdf`,
      PDF,
    );
    const after = await pool.query<{ now: Date }>(
      "SELECT clock_timestamp() AS now",
    );
    const persisted = await stored(pointer.jobId);
    expect(persisted).toMatchObject({
      status: "succeeded",
      error_code: null,
      artifact_key: `artifacts/${pointer.jobId}.pdf`,
      artifact_byte_length: PDF.byteLength,
    });
    expect(persisted.expires_at).toBeInstanceOf(Date);
    const retentionMs = 7 * 24 * 60 * 60 * 1_000;
    expect(persisted.expires_at!.getTime()).toBeGreaterThanOrEqual(
      before.rows[0]!.now.getTime() + retentionMs,
    );
    expect(persisted.expires_at!.getTime()).toBeLessThanOrEqual(
      after.rows[0]!.now.getTime() + retentionMs,
    );
  });

  it("rejects queue field injection, wrong hashes, missing jobs, and invalid snapshots safely", async () => {
    const first = await createQueuedJob();
    const firstDeps = dependencies();
    const injected = await processCompilePointer(
      {
        jobId: first.created.resource.jobId,
        snapshotHash: first.created.resource.snapshotHash,
        templateId: "elsevier",
      },
      firstDeps.deps,
    );
    expect(injected).toEqual({
      status: "failed",
      error: "JOB_STATE_INVALID",
    });
    expect(firstDeps.compile).not.toHaveBeenCalled();

    const wrong = await processCompilePointer(
      {
        jobId: first.created.resource.jobId,
        snapshotHash: "f".repeat(64),
      },
      firstDeps.deps,
    );
    expect(wrong).toEqual({
      status: "failed",
      error: "SNAPSHOT_HASH_MISMATCH",
    });
    expect((await stored(first.created.resource.jobId)).error_code).toBe(
      "SNAPSHOT_HASH_MISMATCH",
    );

    expect(
      await processCompilePointer(
        { jobId: randomUUID(), snapshotHash: "a".repeat(64) },
        firstDeps.deps,
      ),
    ).toEqual({ status: "failed", error: "JOB_STATE_INVALID" });

    await pool.query(
      `TRUNCATE compile_outbox, compile_jobs, project_references, documents,
                projects, "verification", "account", "session", "user" CASCADE`,
    );
    const invalid = await createQueuedJob("invalid@example.test");
    await pool.query(
      "UPDATE compile_jobs SET input_snapshot = $2::jsonb WHERE id = $1",
      [invalid.created.resource.jobId, JSON.stringify({ schemaVersion: 1 })],
    );
    expect(
      await processCompilePointer(
        {
          jobId: invalid.created.resource.jobId,
          snapshotHash: invalid.created.resource.snapshotHash,
        },
        dependencies().deps,
      ),
    ).toEqual({ status: "failed", error: "SNAPSHOT_INVALID" });
    expect((await stored(invalid.created.resource.jobId)).error_code).toBe(
      "SNAPSHOT_INVALID",
    );
  });

  it("persists safe compile, non-PDF, and upload failures without exposing artifacts", async () => {
    const cases = [
      {
        email: "compile-fail@example.test",
        expected: "COMPILE_FAILED",
        deps: () =>
          dependencies({
            compile: async () => {
              throw new Error("raw docker path");
            },
          }),
      },
      {
        email: "not-pdf@example.test",
        expected: "COMPILE_FAILED",
        deps: () => dependencies({ compile: async () => Buffer.from("no") }),
      },
      {
        email: "upload-fail@example.test",
        expected: "UPLOAD_FAILED",
        deps: () =>
          dependencies({
            upload: async () => {
              throw new Error("raw S3 credentials");
            },
          }),
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      if (index > 0) {
        await pool.query(
          `TRUNCATE compile_outbox, compile_jobs, project_references, documents,
                    projects, "verification", "account", "session", "user" CASCADE`,
        );
      }
      const { created } = await createQueuedJob(testCase.email);
      const runtime = testCase.deps();
      const outcome = await processCompilePointer(
        {
          jobId: created.resource.jobId,
          snapshotHash: created.resource.snapshotHash,
        },
        runtime.deps,
      );
      expect(outcome).toEqual({
        status: "failed",
        error: testCase.expected,
      });
      expect(await stored(created.resource.jobId)).toEqual({
        status: "failed",
        error_code: testCase.expected,
        artifact_key: null,
        artifact_byte_length: null,
        expires_at: null,
      });
      expect(JSON.stringify(outcome)).not.toMatch(/docker|credentials/i);
      await expect(
        processCompilePointer(
          {
            jobId: created.resource.jobId,
            snapshotHash: created.resource.snapshotHash,
          },
          runtime.deps,
        ),
      ).resolves.toEqual({ status: "noop", reason: "terminal" });
    }
  });

  it("does not reset active processing and reclaims only beyond the bounded stale window", async () => {
    const active = await createQueuedJob();
    const activeToken = randomUUID();
    const now = new Date("2026-07-27T12:00:00.000Z");
    await pool.query(
      `UPDATE compile_jobs
       SET status = 'processing', processing_token = $2,
           processing_started_at = $3
       WHERE id = $1`,
      [active.created.resource.jobId, activeToken, now],
    );
    const activeRuntime = dependencies({ now: () => now });
    await expect(
      processCompilePointer(
        {
          jobId: active.created.resource.jobId,
          snapshotHash: active.created.resource.snapshotHash,
        },
        activeRuntime.deps,
      ),
    ).resolves.toEqual({ status: "noop", reason: "active" });
    expect(activeRuntime.compile).not.toHaveBeenCalled();

    await pool.query(
      "UPDATE compile_jobs SET processing_started_at = $2 WHERE id = $1",
      [
        active.created.resource.jobId,
        new Date(now.getTime() - 30_001),
      ],
    );
    const recovered = await processCompilePointer(
      {
        jobId: active.created.resource.jobId,
        snapshotHash: active.created.resource.snapshotHash,
      },
      activeRuntime.deps,
    );
    expect(recovered.status).toBe("succeeded");
    expect(activeRuntime.compile).toHaveBeenCalledTimes(1);
  });

  it("reconstructs terminal truth and authorizes signed downloads without exposing the key", async () => {
    const signer = vi.fn(
      async () => "https://artifacts.example.test/short-lived-signature",
    );
    const auth = createMentorAuth(pool, {
      secret: AUTH_SECRET,
      origin: AUTH_ORIGIN,
      isProduction: false,
    });
    const app = buildApp({
      auth,
      authOrigin: AUTH_ORIGIN,
      database: pool,
      signArtifactUrl: signer,
    });
    const owner = await seedMentorAccount(
      pool,
      {
        secret: AUTH_SECRET,
        origin: AUTH_ORIGIN,
        isProduction: false,
      },
      {
        email: "download-owner@example.test",
        password: "download-password",
        name: "Download Owner",
      },
    );
    const foreign = await seedMentorAccount(
      pool,
      {
        secret: AUTH_SECRET,
        origin: AUTH_ORIGIN,
        isProduction: false,
      },
      {
        email: "download-foreign@example.test",
        password: "download-password",
        name: "Download Foreign",
      },
    );
    async function login(email: string) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin: AUTH_ORIGIN },
        payload: { email, password: "download-password" },
      });
      expect(response.statusCode).toBe(200);
      return cookieFrom(response);
    }
    const ownerCookie = await login("download-owner@example.test");
    const foreignCookie = await login("download-foreign@example.test");
    const document = await createDocumentRepository(pool).create({
      projectId: owner.defaultProjectId,
      envelope: EmptyPersistedDocumentEnvelope,
    });
    const created = await createCompileJobRepository(pool).createForOwner({
      ownerUserId: owner.userId,
      request: {
        documentId: document.id,
        revision: 1,
        templateId: "ieee",
        format: "pdf",
      },
    });
    const jobId = created.resource.jobId;

    const pending = await app.inject({
      method: "GET",
      url: `/api/compile-jobs/${jobId}/download`,
      headers: { cookie: ownerCookie },
    });
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toEqual({
      error: "COMPILE_JOB_NOT_READY",
      status: "accepted",
    });
    for (const url of [
      `/api/compile-jobs/${jobId}`,
      `/api/compile-jobs/${jobId}/download`,
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie: foreignCookie },
      });
      expect(response.statusCode).toBe(404);
    }
    expect(foreign.userId).not.toBe(owner.userId);

    await pool.query(
      `UPDATE compile_jobs
       SET status = 'succeeded', artifact_key = $2,
           artifact_byte_length = $3,
           expires_at = now() + interval '7 days'
       WHERE id = $1`,
      [jobId, `artifacts/${jobId}.pdf`, PDF.byteLength],
    );
    await app.close();

    const reconstructed = buildApp({
      auth,
      authOrigin: AUTH_ORIGIN,
      database: pool,
      signArtifactUrl: signer,
    });
    try {
      const status = await reconstructed.inject({
        method: "GET",
        url: `/api/compile-jobs/${jobId}`,
        headers: { cookie: ownerCookie },
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ jobId, status: "succeeded" });
      expect(status.body).not.toContain("artifact");

      const download = await reconstructed.inject({
        method: "GET",
        url: `/api/compile-jobs/${jobId}/download`,
        headers: { cookie: ownerCookie },
      });
      expect(download.statusCode).toBe(200);
      expect(download.json()).toEqual({
        downloadUrl:
          "https://artifacts.example.test/short-lived-signature",
      });
      expect(download.body).not.toContain(`artifacts/${jobId}.pdf`);
      expect(signer).toHaveBeenCalledWith(`artifacts/${jobId}.pdf`);
      expect(signer).toHaveBeenCalledTimes(1);

      signer.mockClear();
      await pool.query(
        "UPDATE compile_jobs SET expires_at = now() - interval '1 second' WHERE id = $1",
        [jobId],
      );
      const expired = await reconstructed.inject({
        method: "GET",
        url: `/api/compile-jobs/${jobId}/download`,
        headers: { cookie: ownerCookie },
      });
      expect(expired.statusCode).toBe(410);
      expect(expired.json()).toEqual({ error: "ARTIFACT_EXPIRED" });
      expect(signer).not.toHaveBeenCalled();

      const foreignExpired = await reconstructed.inject({
        method: "GET",
        url: `/api/compile-jobs/${jobId}/download`,
        headers: { cookie: foreignCookie },
      });
      expect(foreignExpired.statusCode).toBe(404);
      expect(foreignExpired.json()).toEqual({ error: "COMPILE_JOB_NOT_FOUND" });
      expect(signer).not.toHaveBeenCalled();

      await pool.query(
        `UPDATE compile_jobs
         SET expires_at = now() + interval '7 days', artifact_deleted_at = now()
         WHERE id = $1`,
        [jobId],
      );
      const deleted = await reconstructed.inject({
        method: "GET",
        url: `/api/compile-jobs/${jobId}/download`,
        headers: { cookie: ownerCookie },
      });
      expect(deleted.statusCode).toBe(410);
      expect(deleted.json()).toEqual({ error: "ARTIFACT_EXPIRED" });
      expect(signer).not.toHaveBeenCalled();
    } finally {
      await reconstructed.close();
    }
  });
});
