import {
  CompileJobPayloadSchema,
  EmptyPersistedDocumentEnvelope,
  type CompileJobCreateRequest,
  type CompileQueuePointer,
  type PersistedDocumentEnvelope,
} from "@depress/ast";
import type { FastifyInstance } from "fastify";
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
import {
  createCompileJobRepository,
} from "../db/compile-job-repository";
import { createDocumentRepository } from "../db/document-repository";
import { runMigrations } from "../db/migrate";
import { createReferenceRepository } from "../db/reference-repository";
import {
  COMPILE_POINTER_QUEUE_NAME,
  type CompilePointerQueue,
} from "../queue/compile-pointer-queue";
import { COMPILE_QUEUE_NAME } from "../queue/compile-queue";
import { publishCompileOutbox } from "../services/compile-outbox-publisher";

const databaseUrl = process.env["DEPRESS_POSTGRES_TEST_URL"];
const describeDatabase = databaseUrl ? describe : describe.skip;
const AUTH_ORIGIN = "http://localhost:3000";
const AUTH_SECRET = "day6-compile-jobs-test-secret-at-least-32-characters";
const MENTOR_A = {
  email: "compile-a@example.test",
  password: "compile-a-password",
  name: "Compile Mentor A",
};
const MENTOR_B = {
  email: "compile-b@example.test",
  password: "compile-b-password",
  name: "Compile Mentor B",
};
const COMPILE_INPUT = {
  revision: 1,
  templateId: "ieee",
  format: "pdf",
} as const;
const REFERENCE = {
  id: "smith2026",
  type: "article-journal" as const,
  title: "Snapshot reference",
  author: [{ family: "Smith", given: "A." }],
  issued: { "date-parts": [[2026]] },
};
const ENVELOPE: PersistedDocumentEnvelope = {
  schemaVersion: 1,
  editor: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Persisted compile" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Citation " },
          { type: "citation", attrs: { citeKey: REFERENCE.id } },
        ],
      },
    ],
  },
  metadata: { title: "Persisted compile", keywords: ["snapshot"] },
};

type TestResponseHeaders = Record<
  string,
  string | string[] | number | undefined
>;

function cookieFrom(response: { headers: TestResponseHeaders }): string {
  const value = response.headers["set-cookie"];
  if (typeof value === "number") throw new Error("Invalid Set-Cookie header");
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("Expected authentication cookie");
  return first.split(";", 1)[0]!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describeDatabase("authenticated persisted compile jobs and outbox", () => {
  let pool: Pool;
  let migrationApply: string[] = [];
  let migrationRerun: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    migrationApply = (await runMigrations(pool)).applied;
    migrationRerun = (await runMigrations(pool)).applied;
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

  function createApp(): FastifyInstance {
    const auth = createMentorAuth(pool, {
      secret: AUTH_SECRET,
      origin: AUTH_ORIGIN,
      isProduction: false,
    });
    return buildApp({
      auth,
      authOrigin: AUTH_ORIGIN,
      database: pool,
    });
  }

  async function seedAndLogin(
    app: FastifyInstance,
    mentor: typeof MENTOR_A | typeof MENTOR_B,
  ) {
    const seeded = await seedMentorAccount(
      pool,
      {
        secret: AUTH_SECRET,
        origin: AUTH_ORIGIN,
        isProduction: false,
      },
      mentor,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: AUTH_ORIGIN },
      payload: { email: mentor.email, password: mentor.password },
    });
    expect(response.statusCode).toBe(200);
    return { ...seeded, cookie: cookieFrom(response) };
  }

  async function createPersistedDocument(
    projectId: string,
    envelope: PersistedDocumentEnvelope = ENVELOPE,
  ) {
    const document = await createDocumentRepository(pool).create({
      projectId,
      envelope,
    });
    await createReferenceRepository(pool).create({
      projectId,
      item: REFERENCE,
    });
    return document;
  }

  async function createViaApi(input: {
    app: FastifyInstance;
    cookie: string;
    documentId: string;
    request?: Partial<CompileJobCreateRequest>;
  }) {
    return input.app.inject({
      method: "POST",
      url: "/api/compile-jobs",
      headers: { cookie: input.cookie },
      payload: {
        documentId: input.documentId,
        ...COMPILE_INPUT,
        ...input.request,
      },
    });
  }

  async function createAcceptedJob() {
    const app = createApp();
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(
        mentor.defaultProjectId,
      );
      return await createCompileJobRepository(pool).createForOwner({
        ownerUserId: mentor.userId,
        request: {
          documentId: document.id,
          ...COMPILE_INPUT,
        },
      });
    } finally {
      await app.close();
    }
  }

  it("applies the compile migration once and reruns with zero migrations", () => {
    expect(migrationApply).toContain("0004_compile_jobs_outbox.sql");
    expect(migrationRerun).toEqual([]);
  });

  it("authenticates create, requires the exact revision, and stores the full immutable snapshot", async () => {
    const app = createApp();
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(
        mentor.defaultProjectId,
      );
      const unauthenticated = await createViaApi({
        app,
        cookie: "",
        documentId: document.id,
      });
      expect(unauthenticated.statusCode).toBe(401);

      const response = await createViaApi({
        app,
        cookie: mentor.cookie,
        documentId: document.id,
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        documentId: document.id,
        revision: 1,
        templateId: "ieee",
        format: "pdf",
        status: "accepted",
      });
      expect(Object.keys(response.json()).sort()).toEqual([
        "createdAt",
        "documentId",
        "format",
        "jobId",
        "revision",
        "snapshotHash",
        "status",
        "templateId",
        "updatedAt",
      ]);

      const stored = await pool.query<{
        input_snapshot: {
          projectId: string;
          compileRequest: {
            ast: unknown;
            references: unknown[];
          };
        };
        jobs: string;
        outbox: string;
      }>(
        `
          SELECT
            input_snapshot,
            (SELECT count(*) FROM compile_jobs)::text AS jobs,
            (SELECT count(*) FROM compile_outbox)::text AS outbox
          FROM compile_jobs
          WHERE id = $1
        `,
        [response.json().jobId],
      );
      expect(stored.rows[0]).toMatchObject({ jobs: "1", outbox: "1" });
      expect(stored.rows[0]?.input_snapshot).toMatchObject({
        projectId: mentor.defaultProjectId,
        compileRequest: {
          ast: {
            type: "doc",
            metadata: ENVELOPE.metadata,
          },
          references: [REFERENCE],
        },
      });

      const ownerControlled = await app.inject({
        method: "POST",
        url: "/api/compile-jobs",
        headers: { cookie: mentor.cookie },
        payload: {
          documentId: document.id,
          ...COMPILE_INPUT,
          projectId: mentor.defaultProjectId,
        },
      });
      expect(ownerControlled.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("returns currentRevision only when the requested revision is stale", async () => {
    const app = createApp();
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(
        mentor.defaultProjectId,
      );
      const response = await createViaApi({
        app,
        cookie: mentor.cookie,
        documentId: document.id,
        request: { revision: 2 },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ currentRevision: 1 });
      expect(
        await pool.query("SELECT 1 FROM compile_jobs"),
      ).toHaveProperty("rowCount", 0);
    } finally {
      await app.close();
    }
  });

  it("returns 404 for missing and foreign documents", async () => {
    const app = createApp();
    try {
      const mentorA = await seedAndLogin(app, MENTOR_A);
      const mentorB = await seedAndLogin(app, MENTOR_B);
      const documentA = await createPersistedDocument(
        mentorA.defaultProjectId,
      );
      const missing = await createViaApi({
        app,
        cookie: mentorA.cookie,
        documentId: "7a6cc9c4-ce34-4d2a-956d-19d5ab902567",
      });
      const foreign = await createViaApi({
        app,
        cookie: mentorB.cookie,
        documentId: documentA.id,
      });
      expect(missing.statusCode).toBe(404);
      expect(foreign.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("produces the same canonical hash for the same document, revision, template, and references", async () => {
    const app = createApp();
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(
        mentor.defaultProjectId,
      );
      const repository = createCompileJobRepository(pool);
      const first = await repository.createForOwner({
        ownerUserId: mentor.userId,
        request: { documentId: document.id, ...COMPILE_INPUT },
      });
      const second = await repository.createForOwner({
        ownerUserId: mentor.userId,
        request: { documentId: document.id, ...COMPILE_INPUT },
      });
      expect(second.resource.snapshotHash).toBe(
        first.resource.snapshotHash,
      );
      expect(second.snapshot).toEqual(first.snapshot);
    } finally {
      await app.close();
    }
  });

  it("changes the snapshot hash when the document or project reference changes", async () => {
    const app = createApp();
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(
        mentor.defaultProjectId,
      );
      const jobs = createCompileJobRepository(pool);
      const first = await jobs.createForOwner({
        ownerUserId: mentor.userId,
        request: { documentId: document.id, ...COMPILE_INPUT },
      });
      const revisedEnvelope = {
        ...ENVELOPE,
        metadata: { ...ENVELOPE.metadata, title: "Revised document" },
      };
      const saved = await createDocumentRepository(pool).save({
        projectId: mentor.defaultProjectId,
        documentId: document.id,
        expectedRevision: 1,
        envelope: revisedEnvelope,
      });
      expect(saved.status).toBe("saved");
      const documentChanged = await jobs.createForOwner({
        ownerUserId: mentor.userId,
        request: {
          documentId: document.id,
          ...COMPILE_INPUT,
          revision: 2,
        },
      });
      expect(documentChanged.resource.snapshotHash).not.toBe(
        first.resource.snapshotHash,
      );

      await createReferenceRepository(pool).update({
        projectId: mentor.defaultProjectId,
        citeKey: REFERENCE.id,
        item: { ...REFERENCE, title: "Revised reference" },
      });
      const referenceChanged = await jobs.createForOwner({
        ownerUserId: mentor.userId,
        request: {
          documentId: document.id,
          ...COMPILE_INPUT,
          revision: 2,
        },
      });
      expect(referenceChanged.resource.snapshotHash).not.toBe(
        documentChanged.resource.snapshotHash,
      );
    } finally {
      await app.close();
    }
  });

  it("rolls back the job when the outbox insert path fails", async () => {
    const app = createApp();
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(
        mentor.defaultProjectId,
      );
      const repository = createCompileJobRepository(pool, {
        beforeOutboxInsert: () => {
          throw new Error("injected outbox failure");
        },
      });
      await expect(
        repository.createForOwner({
          ownerUserId: mentor.userId,
          request: { documentId: document.id, ...COMPILE_INPUT },
        }),
      ).rejects.toThrow("injected outbox failure");
      const counts = await pool.query<{
        jobs: string;
        outbox: string;
      }>(
        `
          SELECT
            (SELECT count(*) FROM compile_jobs)::text AS jobs,
            (SELECT count(*) FROM compile_outbox)::text AS outbox
        `,
      );
      expect(counts.rows[0]).toEqual({ jobs: "0", outbox: "0" });
    } finally {
      await app.close();
    }
  });

  it("preserves jobs across API reconstruction and scopes GET to the owner", async () => {
    const firstApp = createApp();
    const mentorA = await seedAndLogin(firstApp, MENTOR_A);
    const mentorB = await seedAndLogin(firstApp, MENTOR_B);
    const document = await createPersistedDocument(
      mentorA.defaultProjectId,
    );
    const created = await createViaApi({
      app: firstApp,
      cookie: mentorA.cookie,
      documentId: document.id,
    });
    const jobId = created.json().jobId as string;
    await firstApp.close();

    const reconstructed = createApp();
    try {
      const owned = await reconstructed.inject({
        method: "GET",
        url: `/api/compile-jobs/${jobId}`,
        headers: { cookie: mentorA.cookie },
      });
      const foreign = await reconstructed.inject({
        method: "GET",
        url: `/api/compile-jobs/${jobId}`,
        headers: { cookie: mentorB.cookie },
      });
      expect(owned.statusCode).toBe(200);
      expect(owned.json()).toMatchObject({ jobId, status: "accepted" });
      expect(JSON.stringify(owned.json())).not.toMatch(
        /input_snapshot|artifact|error_code|owner|user/i,
      );
      expect(foreign.statusCode).toBe(404);
    } finally {
      await reconstructed.close();
    }
  });

  it("cascades a deleted user through jobs and outbox", async () => {
    const created = await createAcceptedJob();
    const projectId = created.snapshot.projectId;
    const owner = await pool.query<{ owner_user_id: string }>(
      "SELECT owner_user_id FROM projects WHERE id = $1",
      [projectId],
    );
    await pool.query(`DELETE FROM "user" WHERE id = $1`, [
      owner.rows[0]!.owner_user_id,
    ]);
    const counts = await pool.query<{ jobs: string; outbox: string }>(
      `
        SELECT
          (SELECT count(*) FROM compile_jobs)::text AS jobs,
          (SELECT count(*) FROM compile_outbox)::text AS outbox
      `,
    );
    expect(counts.rows[0]).toEqual({ jobs: "0", outbox: "0" });
  });

  it("returns safe 422 and creates nothing for an invalid persisted projection", async () => {
    const app = createApp();
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createDocumentRepository(pool).create({
        projectId: mentor.defaultProjectId,
        envelope: EmptyPersistedDocumentEnvelope,
      });
      await pool.query(
        `
          UPDATE documents
          SET envelope_json = $1::jsonb
          WHERE id = $2
        `,
        [
          JSON.stringify({
            schemaVersion: 1,
            editor: {
              type: "doc",
              content: [{ type: "unknown-internal-node" }],
            },
          }),
          document.id,
        ],
      );
      const response = await createViaApi({
        app,
        cookie: mentor.cookie,
        documentId: document.id,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        error: "COMPILE_PROJECTION_INVALID",
      });
      const counts = await pool.query<{ jobs: string; outbox: string }>(
        `
          SELECT
            (SELECT count(*) FROM compile_jobs)::text AS jobs,
            (SELECT count(*) FROM compile_outbox)::text AS outbox
        `,
      );
      expect(counts.rows[0]).toEqual({ jobs: "0", outbox: "0" });
    } finally {
      await app.close();
    }
  });

  it("publishes the exact isolated pointer and marks both outbox and job", async () => {
    const created = await createAcceptedJob();
    const enqueue = vi.fn(async (_payload: CompileQueuePointer) => {
      void _payload;
    });
    const result = await publishCompileOutbox({
      pool,
      queue: { enqueue },
    });
    expect(result).toEqual({ selected: 1, published: 1, failed: 0 });
    expect(enqueue).toHaveBeenCalledWith({
      jobId: created.resource.jobId,
      snapshotHash: created.resource.snapshotHash,
    });
    expect(Object.keys(enqueue.mock.calls[0]![0]).sort()).toEqual([
      "jobId",
      "snapshotHash",
    ]);
    const stored = await pool.query<{
      published: boolean;
      attempt_count: number;
      last_error_code: string | null;
      status: string;
    }>(
      `
        SELECT
          outbox.published_at IS NOT NULL AS published,
          outbox.attempt_count,
          outbox.last_error_code,
          jobs.status
        FROM compile_outbox AS outbox
        JOIN compile_jobs AS jobs ON jobs.id = outbox.job_id
      `,
    );
    expect(stored.rows[0]).toEqual({
      published: true,
      attempt_count: 1,
      last_error_code: null,
      status: "queued",
    });
    expect(COMPILE_POINTER_QUEUE_NAME).not.toBe(COMPILE_QUEUE_NAME);
    expect(
      CompileJobPayloadSchema.safeParse(enqueue.mock.calls[0]![0]).success,
    ).toBe(false);
  });

  it("keeps failures unpublished and retries with the identical job ID and payload", async () => {
    await createAcceptedJob();
    const failedPayloads: CompileQueuePointer[] = [];
    const failingQueue: CompilePointerQueue = {
      enqueue: vi.fn(async (payload) => {
        failedPayloads.push(payload);
        throw new Error("raw redis detail must not persist");
      }),
    };
    expect(
      await publishCompileOutbox({ pool, queue: failingQueue }),
    ).toEqual({ selected: 1, published: 0, failed: 1 });
    const failed = await pool.query<{
      published_at: Date | null;
      attempt_count: number;
      last_error_code: string | null;
    }>(
      `
        SELECT published_at, attempt_count, last_error_code
        FROM compile_outbox
      `,
    );
    expect(failed.rows[0]).toEqual({
      published_at: null,
      attempt_count: 1,
      last_error_code: "QUEUE_UNAVAILABLE",
    });

    const retriedPayloads: CompileQueuePointer[] = [];
    const successQueue: CompilePointerQueue = {
      enqueue: vi.fn(async (payload) => {
        retriedPayloads.push(payload);
      }),
    };
    expect(
      await publishCompileOutbox({ pool, queue: successQueue }),
    ).toEqual({ selected: 1, published: 1, failed: 0 });
    expect(retriedPayloads).toEqual(failedPayloads);
    expect(retriedPayloads[0]?.jobId).toBe(failedPayloads[0]?.jobId);
    const retried = await pool.query<{
      published: boolean;
      attempt_count: number;
      last_error_code: string | null;
    }>(
      `
        SELECT
          published_at IS NOT NULL AS published,
          attempt_count,
          last_error_code
        FROM compile_outbox
      `,
    );
    expect(retried.rows[0]).toEqual({
      published: true,
      attempt_count: 2,
      last_error_code: null,
    });
  });

  it("uses row locks so concurrent publishers do not publish one row twice", async () => {
    await createAcceptedJob();
    const entered = deferred<void>();
    const release = deferred<void>();
    const enqueue = vi.fn(async () => {
      entered.resolve();
      await release.promise;
    });
    const first = publishCompileOutbox({
      pool,
      queue: { enqueue },
      batchSize: 1,
    });
    await entered.promise;
    const second = await publishCompileOutbox({
      pool,
      queue: { enqueue },
      batchSize: 1,
    });
    expect(second).toEqual({ selected: 0, published: 0, failed: 0 });
    release.resolve();
    expect(await first).toEqual({
      selected: 1,
      published: 1,
      failed: 0,
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
