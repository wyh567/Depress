import {
  EmptyPersistedDocumentEnvelope,
  PersistedDocumentEnvelopeSchema,
  type PersistedDocumentEnvelope,
} from "@depress/ast";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createMentorAuth } from "../auth/auth";
import { seedMentorAccount } from "../auth/seed-mentor";
import { runMigrations } from "../db/migrate";

const databaseUrl = process.env["DEPRESS_POSTGRES_TEST_URL"];
const describeDatabase = databaseUrl ? describe : describe.skip;
const AUTH_ORIGIN = "http://localhost:3000";
const AUTH_SECRET = "day3-documents-test-secret-at-least-32-characters";
const MENTOR_A = {
  email: "mentor-a@example.test",
  password: "mentor-a-password",
  name: "Mentor A",
};
const MENTOR_B = {
  email: "mentor-b@example.test",
  password: "mentor-b-password",
  name: "Mentor B",
};

type TestResponseHeaders = Record<string, string | string[] | number | undefined>;

function cookieFrom(response: { headers: TestResponseHeaders }): string {
  const value = response.headers["set-cookie"];
  if (typeof value === "number") throw new Error("Invalid numeric Set-Cookie header");
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("Expected an authentication cookie");
  return first.split(";", 1)[0]!;
}

const revisedEnvelope: PersistedDocumentEnvelope = {
  schemaVersion: 1,
  editor: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Reopened draft" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Saved without data loss." }],
      },
    ],
  },
  metadata: {
    title: "Mentor article",
    authors: [{ name: "Mentor" }],
    abstract: "A persisted abstract.",
    keywords: ["persistence", "MVP"],
  },
};

describeDatabase("authenticated document API", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE "verification", "account", "session", "user", project_references, documents, projects CASCADE`,
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
  ): Promise<string> {
    await seedMentorAccount(
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
      payload: {
        email: mentor.email,
        password: mentor.password,
      },
    });
    expect(response.statusCode).toBe(200);
    return cookieFrom(response);
  }

  it("rejects every document operation without a validated session", async () => {
    const app = createApp();
    const id = "39e35789-2e60-4d40-840a-ef10cf05fab7";
    try {
      const responses = await Promise.all([
        app.inject({ method: "GET", url: "/api/documents" }),
        app.inject({ method: "POST", url: "/api/documents", payload: {} }),
        app.inject({ method: "GET", url: `/api/documents/${id}` }),
        app.inject({
          method: "PUT",
          url: `/api/documents/${id}`,
          payload: { expectedRevision: 1, envelope: EmptyPersistedDocumentEnvelope },
        }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401]);
    } finally {
      await app.close();
    }
  });

  it("creates, lists, reads, saves, and reports only the current revision on conflict", async () => {
    const app = createApp();
    try {
      const cookie = await seedAndLogin(app, MENTOR_A);
      const created = await app.inject({
        method: "POST",
        url: "/api/documents",
        headers: { cookie },
        payload: {},
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        envelope: EmptyPersistedDocumentEnvelope,
        revision: 1,
      });
      expect(PersistedDocumentEnvelopeSchema.safeParse(created.json().envelope).success).toBe(true);
      const documentId = created.json().id as string;

      const listed = await app.inject({
        method: "GET",
        url: "/api/documents",
        headers: { cookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toEqual([
        {
          id: documentId,
          title: "Untitled",
          revision: 1,
          updatedAt: created.json().updatedAt,
        },
      ]);

      const read = await app.inject({
        method: "GET",
        url: `/api/documents/${documentId}`,
        headers: { cookie },
      });
      expect(read.statusCode).toBe(200);
      expect(read.json()).toEqual(created.json());

      const saved = await app.inject({
        method: "PUT",
        url: `/api/documents/${documentId}`,
        headers: { cookie },
        payload: { expectedRevision: 1, envelope: revisedEnvelope },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        id: documentId,
        envelope: revisedEnvelope,
        revision: 2,
      });

      const reloaded = await app.inject({
        method: "GET",
        url: `/api/documents/${documentId}`,
        headers: { cookie },
      });
      expect(reloaded.json().envelope).toEqual(revisedEnvelope);
      expect(reloaded.json().revision).toBe(2);

      const conflict = await app.inject({
        method: "PUT",
        url: `/api/documents/${documentId}`,
        headers: { cookie },
        payload: { expectedRevision: 1, envelope: EmptyPersistedDocumentEnvelope },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toEqual({ currentRevision: 2 });
    } finally {
      await app.close();
    }
  });

  it("returns 400 for malformed IDs, envelopes, and owner-controlled create data", async () => {
    const app = createApp();
    try {
      const cookie = await seedAndLogin(app, MENTOR_A);
      const ownerControlled = await app.inject({
        method: "POST",
        url: "/api/documents",
        headers: { cookie },
        payload: { ownerId: "attacker" },
      });
      expect(ownerControlled.statusCode).toBe(400);

      const malformedId = await app.inject({
        method: "GET",
        url: "/api/documents/not-a-uuid",
        headers: { cookie },
      });
      expect(malformedId.statusCode).toBe(400);

      const malformedEnvelope = await app.inject({
        method: "PUT",
        url: "/api/documents/39e35789-2e60-4d40-840a-ef10cf05fab7",
        headers: { cookie },
        payload: {
          expectedRevision: 1,
          envelope: {
            schemaVersion: 1,
            editor: { type: "doc", content: [], ownerId: "attacker" },
          },
        },
      });
      expect(malformedEnvelope.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("isolates lists and returns 404 for cross-user reads and saves", async () => {
    const app = createApp();
    try {
      const cookieA = await seedAndLogin(app, MENTOR_A);
      const cookieB = await seedAndLogin(app, MENTOR_B);
      const created = await app.inject({
        method: "POST",
        url: "/api/documents",
        headers: { cookie: cookieA },
        payload: {},
      });
      const documentId = created.json().id as string;

      const listB = await app.inject({
        method: "GET",
        url: "/api/documents",
        headers: { cookie: cookieB },
      });
      expect(listB.json()).toEqual([]);

      const readB = await app.inject({
        method: "GET",
        url: `/api/documents/${documentId}`,
        headers: { cookie: cookieB },
      });
      expect(readB.statusCode).toBe(404);

      const saveB = await app.inject({
        method: "PUT",
        url: `/api/documents/${documentId}`,
        headers: { cookie: cookieB },
        payload: { expectedRevision: 1, envelope: revisedEnvelope },
      });
      expect(saveB.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("restores the exact document after reconstructing the application", async () => {
    const firstApp = createApp();
    const cookie = await seedAndLogin(firstApp, MENTOR_A);
    const created = await firstApp.inject({
      method: "POST",
      url: "/api/documents",
      headers: { cookie },
      payload: {},
    });
    const documentId = created.json().id as string;
    await firstApp.inject({
      method: "PUT",
      url: `/api/documents/${documentId}`,
      headers: { cookie },
      payload: { expectedRevision: 1, envelope: revisedEnvelope },
    });
    await firstApp.close();

    const reconstructedApp = createApp();
    try {
      const restored = await reconstructedApp.inject({
        method: "GET",
        url: `/api/documents/${documentId}`,
        headers: { cookie },
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toMatchObject({
        id: documentId,
        revision: 2,
        envelope: revisedEnvelope,
      });
    } finally {
      await reconstructedApp.close();
    }
  });
});
