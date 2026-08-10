import {
  CompileQueuePointerSchema,
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
  CompileJobLimitError,
  createCompileJobRepository,
} from "../db/compile-job-repository";
import { createDocumentRepository } from "../db/document-repository";
import { runMigrations } from "../db/migrate";
import { createReferenceRepository } from "../db/reference-repository";
import {
  COMPILE_POINTER_QUEUE_NAME,
  type CompilePointerQueue,
} from "../queue/compile-pointer-queue";
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

async function waitForBarrierOrOperationFailure(
  barrier: Promise<void>,
  operation: Promise<unknown>,
  operationName: string,
): Promise<void> {
  await Promise.race([
    barrier,
    operation.then(
      () => {
        throw new Error(`${operationName} completed before its test barrier`);
      },
      (error: unknown) => {
        throw error;
      },
    ),
  ]);
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

  function createApp(options: {
    compileActiveJobLimit?: number;
    compileSnapshotMaxBytes?: number;
  } = {}): FastifyInstance {
    const auth = createMentorAuth(pool, {
      secret: AUTH_SECRET,
      origin: AUTH_ORIGIN,
      isProduction: false,
    });
    return buildApp({
      auth,
      authOrigin: AUTH_ORIGIN,
      database: pool,
      ...options,
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
      const jobs = createCompileJobRepository(pool, { activeJobLimit: 10 });
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
      await expect(
        createCompileJobRepository(pool).createForOwner({
          ownerUserId: mentor.userId,
          request: { documentId: document.id, ...COMPILE_INPUT },
        }),
      ).resolves.toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("maps the per-owner active-job quota to 429 without creating job or outbox rows", async () => {
    const app = createApp();
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(mentor.defaultProjectId);
      expect((await createViaApi({ app, cookie: mentor.cookie, documentId: document.id })).statusCode).toBe(202);
      expect((await createViaApi({ app, cookie: mentor.cookie, documentId: document.id })).statusCode).toBe(202);

      const rejected = await createViaApi({
        app,
        cookie: mentor.cookie,
        documentId: document.id,
      });
      expect(rejected.statusCode).toBe(429);
      expect(rejected.json()).toEqual({ error: "COMPILE_JOB_LIMIT" });
      const counts = await pool.query<{ jobs: string; outbox: string }>(`
        SELECT
          (SELECT count(*) FROM compile_jobs)::text AS jobs,
          (SELECT count(*) FROM compile_outbox)::text AS outbox
      `);
      expect(counts.rows[0]).toEqual({ jobs: "2", outbox: "2" });
    } finally {
      await app.close();
    }
  });

  it("serializes simultaneous creates so one owner never exceeds two active jobs", async () => {
    const app = createApp();
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(mentor.defaultProjectId);
      const repository = createCompileJobRepository(pool);
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          repository.createForOwner({
            ownerUserId: mentor.userId,
            request: { documentId: document.id, ...COMPILE_INPUT },
          }),
        ),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(rejected).toHaveLength(2);
      expect(rejected.every((result) => result.reason instanceof CompileJobLimitError)).toBe(true);
      const counts = await pool.query<{ active: string; outbox: string }>(`
        SELECT
          (SELECT count(*) FROM compile_jobs
           WHERE status IN ('accepted', 'queued', 'processing'))::text AS active,
          (SELECT count(*) FROM compile_outbox)::text AS outbox
      `);
      expect(counts.rows[0]).toEqual({ active: "2", outbox: "2" });
    } finally {
      await app.close();
    }
  });

  it("establishes a waiting repeatable-read snapshot after the prior owner transaction commits", async () => {
    const app = createApp();
    const firstReachedOutbox = deferred<void>();
    const releaseFirst = deferred<void>();
    let firstCreate: Promise<unknown> | undefined;
    let waitingCreate: Promise<unknown> | undefined;
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(mentor.defaultProjectId);
      const firstRepository = createCompileJobRepository(pool, {
        activeJobLimit: 1,
        beforeOutboxInsert: async (client) => {
          const isolation = await client.query<{ transaction_isolation: string }>(
            "SHOW transaction_isolation",
          );
          expect(isolation.rows[0]?.transaction_isolation).toBe("repeatable read");
          firstReachedOutbox.resolve();
          await releaseFirst.promise;
        },
      });
      const waitingRepository = createCompileJobRepository(pool, {
        activeJobLimit: 1,
      });

      firstCreate = firstRepository.createForOwner({
        ownerUserId: mentor.userId,
        request: { documentId: document.id, ...COMPILE_INPUT },
      });
      await waitForBarrierOrOperationFailure(
        firstReachedOutbox.promise,
        firstCreate,
        "first same-owner create",
      );

      let waitingCreateSettled = false;
      waitingCreate = waitingRepository.createForOwner({
        ownerUserId: mentor.userId,
        request: { documentId: document.id, ...COMPILE_INPUT },
      });
      const waitingOutcome = waitingCreate.then(
          (value) => ({ status: "fulfilled", value }) as const,
          (reason: unknown) => ({ status: "rejected", reason }) as const,
        );
      void waitingOutcome.then(() => {
        waitingCreateSettled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(waitingCreateSettled).toBe(false);

      releaseFirst.resolve();
      await expect(firstCreate).resolves.toBeDefined();
      const outcome = await waitingOutcome;
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(CompileJobLimitError);
      }
      const counts = await pool.query<{ jobs: string; outbox: string }>(`
        SELECT
          (SELECT count(*) FROM compile_jobs)::text AS jobs,
          (SELECT count(*) FROM compile_outbox)::text AS outbox
      `);
      expect(counts.rows[0]).toEqual({ jobs: "1", outbox: "1" });
    } finally {
      releaseFirst.resolve();
      await Promise.allSettled(
        [firstCreate, waitingCreate].filter(
          (operation): operation is Promise<unknown> => operation !== undefined,
        ),
      );
      await app.close();
    }
  });

  it.each(["accepted", "queued", "processing"] as const)(
    "counts %s jobs, including stale processing, against the quota",
    async (status) => {
      const app = createApp();
      try {
        const mentor = await seedAndLogin(app, MENTOR_A);
        const document = await createPersistedDocument(mentor.defaultProjectId);
        const repository = createCompileJobRepository(pool);
        const first = await repository.createForOwner({ ownerUserId: mentor.userId, request: { documentId: document.id, ...COMPILE_INPUT } });
        const second = await repository.createForOwner({ ownerUserId: mentor.userId, request: { documentId: document.id, ...COMPILE_INPUT } });
        if (status === "queued") {
          await pool.query("UPDATE compile_jobs SET status = 'queued'");
        } else if (status === "processing") {
          await pool.query(
            "UPDATE compile_jobs SET status = 'processing', processing_token = id, processing_started_at = now() - interval '30 days'",
          );
        }
        expect([first.resource.status, second.resource.status]).toEqual(["accepted", "accepted"]);
        await expect(repository.createForOwner({ ownerUserId: mentor.userId, request: { documentId: document.id, ...COMPILE_INPUT } })).rejects.toBeInstanceOf(CompileJobLimitError);
      } finally {
        await app.close();
      }
    },
  );

  it.each(["succeeded", "failed"] as const)(
    "%s jobs release quota capacity",
    async (status) => {
      const app = createApp();
      try {
        const mentor = await seedAndLogin(app, MENTOR_A);
        const document = await createPersistedDocument(mentor.defaultProjectId);
        const repository = createCompileJobRepository(pool);
        const first = await repository.createForOwner({ ownerUserId: mentor.userId, request: { documentId: document.id, ...COMPILE_INPUT } });
        await repository.createForOwner({ ownerUserId: mentor.userId, request: { documentId: document.id, ...COMPILE_INPUT } });
        if (status === "succeeded") {
          await pool.query(
            "UPDATE compile_jobs SET status = 'succeeded', artifact_key = 'test.pdf', artifact_byte_length = 5, expires_at = now() + interval '7 days' WHERE id = $1",
            [first.resource.jobId],
          );
        } else {
          await pool.query(
            "UPDATE compile_jobs SET status = 'failed', error_code = 'COMPILE_FAILED' WHERE id = $1",
            [first.resource.jobId],
          );
        }
        await expect(repository.createForOwner({ ownerUserId: mentor.userId, request: { documentId: document.id, ...COMPILE_INPUT } })).resolves.toBeDefined();
      } finally {
        await app.close();
      }
    },
  );

  it("scopes quota and advisory locking per owner", async () => {
    const app = createApp();
    const entered = deferred<void>();
    const release = deferred<void>();
    let blockedA: Promise<unknown> | undefined;
    let ownerB: Promise<unknown> | undefined;
    try {
      const mentorA = await seedAndLogin(app, MENTOR_A);
      const mentorB = await seedAndLogin(app, MENTOR_B);
      const documentA = await createPersistedDocument(mentorA.defaultProjectId);
      const documentB = await createPersistedDocument(mentorB.defaultProjectId);
      blockedA = createCompileJobRepository(pool, {
        beforeOutboxInsert: async () => {
          entered.resolve();
          await release.promise;
        },
      }).createForOwner({ ownerUserId: mentorA.userId, request: { documentId: documentA.id, ...COMPILE_INPUT } });
      await waitForBarrierOrOperationFailure(
        entered.promise,
        blockedA,
        "owner A create",
      );
      ownerB = createCompileJobRepository(pool).createForOwner({
        ownerUserId: mentorB.userId,
        request: { documentId: documentB.id, ...COMPILE_INPUT },
      });
      void ownerB.catch(() => undefined);
      await expect(Promise.race([
        ownerB,
        new Promise((_, reject) => setTimeout(() => reject(new Error("owner B blocked")), 1_000)),
      ])).resolves.toBeDefined();
      release.resolve();
      await expect(blockedA).resolves.toBeDefined();
    } finally {
      release.resolve();
      await Promise.allSettled(
        [blockedA, ownerB].filter(
          (operation): operation is Promise<unknown> => operation !== undefined,
        ),
      );
      await app.close();
    }
  });

  it("allows an owner with capacity when another owner is quota-saturated", async () => {
    const app = createApp();
    try {
      const mentorA = await seedAndLogin(app, MENTOR_A);
      const mentorB = await seedAndLogin(app, MENTOR_B);
      const documentA = await createPersistedDocument(mentorA.defaultProjectId);
      const documentB = await createPersistedDocument(mentorB.defaultProjectId);
      const repository = createCompileJobRepository(pool);

      await repository.createForOwner({
        ownerUserId: mentorA.userId,
        request: { documentId: documentA.id, ...COMPILE_INPUT },
      });
      await repository.createForOwner({
        ownerUserId: mentorA.userId,
        request: { documentId: documentA.id, ...COMPILE_INPUT },
      });
      await expect(
        repository.createForOwner({
          ownerUserId: mentorA.userId,
          request: { documentId: documentA.id, ...COMPILE_INPUT },
        }),
      ).rejects.toBeInstanceOf(CompileJobLimitError);

      await expect(
        repository.createForOwner({
          ownerUserId: mentorB.userId,
          request: { documentId: documentB.id, ...COMPILE_INPUT },
        }),
      ).resolves.toBeDefined();

      const counts = await pool.query<{ count: string; owner_user_id: string }>(`
        SELECT projects.owner_user_id, count(*)::text AS count
        FROM compile_jobs AS jobs
        JOIN projects ON projects.id = jobs.project_id
        GROUP BY projects.owner_user_id
      `);
      const countsByOwner = new Map(
        counts.rows.map((row) => [row.owner_user_id, Number(row.count)]),
      );
      expect(countsByOwner.get(mentorA.userId)).toBe(2);
      expect(countsByOwner.get(mentorB.userId)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("maps oversized canonical snapshots to 422 and creates nothing", async () => {
    const app = createApp({ compileSnapshotMaxBytes: 128 });
    try {
      const mentor = await seedAndLogin(app, MENTOR_A);
      const document = await createPersistedDocument(mentor.defaultProjectId);
      const response = await createViaApi({ app, cookie: mentor.cookie, documentId: document.id });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: "COMPILE_INPUT_TOO_LARGE" });
      const counts = await pool.query<{ jobs: string; outbox: string }>(`
        SELECT
          (SELECT count(*) FROM compile_jobs)::text AS jobs,
          (SELECT count(*) FROM compile_outbox)::text AS outbox
      `);
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
    expect(COMPILE_POINTER_QUEUE_NAME).toBe("compile-pointers");
    expect(CompileQueuePointerSchema.parse(enqueue.mock.calls[0]![0])).toEqual({
      jobId: created.resource.jobId,
      snapshotHash: created.resource.snapshotHash,
    });
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
