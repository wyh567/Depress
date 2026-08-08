import type { CslItem } from "@depress/ast";
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
const AUTH_SECRET = "day5-references-test-secret-at-least-32-characters";
const MENTOR_A = {
  email: "reference-a@example.test",
  password: "reference-a-password",
  name: "Reference Mentor A",
};
const MENTOR_B = {
  email: "reference-b@example.test",
  password: "reference-b-password",
  name: "Reference Mentor B",
};
const FIRST_ITEM: CslItem = {
  id: "smith2024",
  type: "article-journal",
  title: "Persisted reference",
  author: [{ family: "Smith", given: "A." }],
  issued: { "date-parts": [[2024]] },
  DOI: "10.1000/shared",
};

type TestResponseHeaders = Record<string, string | string[] | number | undefined>;

function cookieFrom(response: { headers: TestResponseHeaders }): string {
  const value = response.headers["set-cookie"];
  if (typeof value === "number") throw new Error("Invalid numeric Set-Cookie header");
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("Expected an authentication cookie");
  return first.split(";", 1)[0]!;
}

describeDatabase("authenticated project reference API", () => {
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
    return buildApp({ auth, authOrigin: AUTH_ORIGIN, database: pool });
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
      payload: { email: mentor.email, password: mentor.password },
    });
    expect(response.statusCode).toBe(200);
    return cookieFrom(response);
  }

  it("rejects every reference operation without a validated session", async () => {
    const app = createApp();
    try {
      const responses = await Promise.all([
        app.inject({ method: "GET", url: "/api/references" }),
        app.inject({
          method: "POST",
          url: "/api/references",
          payload: { item: FIRST_ITEM },
        }),
        app.inject({
          method: "PUT",
          url: `/api/references/${FIRST_ITEM.id}`,
          payload: { item: FIRST_ITEM },
        }),
        app.inject({
          method: "DELETE",
          url: `/api/references/${FIRST_ITEM.id}`,
        }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401]);
    } finally {
      await app.close();
    }
  });

  it("creates and lists strict CSL items with deterministic citeKey conflicts", async () => {
    const app = createApp();
    try {
      const cookie = await seedAndLogin(app, MENTOR_A);
      const empty = await app.inject({
        method: "GET",
        url: "/api/references",
        headers: { cookie },
      });
      expect(empty.json()).toEqual([]);

      const created = await app.inject({
        method: "POST",
        url: "/api/references",
        headers: { cookie },
        payload: { item: FIRST_ITEM },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toEqual(FIRST_ITEM);

      const duplicate = await app.inject({
        method: "POST",
        url: "/api/references",
        headers: { cookie },
        payload: { item: { ...FIRST_ITEM, title: "Must not overwrite" } },
      });
      expect(duplicate.statusCode).toBe(409);

      const sameDoiDifferentIdentity = await app.inject({
        method: "POST",
        url: "/api/references",
        headers: { cookie },
        payload: {
          item: {
            ...FIRST_ITEM,
            id: "other2024",
            title: "Same DOI is not database-unique",
          },
        },
      });
      expect(sameDoiDifferentIdentity.statusCode).toBe(201);

      const listed = await app.inject({
        method: "GET",
        url: "/api/references",
        headers: { cookie },
      });
      expect(listed.json().map((item: CslItem) => item.id)).toEqual([
        "other2024",
        "smith2024",
      ]);
    } finally {
      await app.close();
    }
  });

  it("returns 400 for malformed CSL, owner fields, and identity changes", async () => {
    const app = createApp();
    try {
      const cookie = await seedAndLogin(app, MENTOR_A);
      const malformed = await app.inject({
        method: "POST",
        url: "/api/references",
        headers: { cookie },
        payload: {
          ownerId: "attacker",
          item: { id: "bad", type: "book", title: "" },
        },
      });
      expect(malformed.statusCode).toBe(400);

      await app.inject({
        method: "POST",
        url: "/api/references",
        headers: { cookie },
        payload: { item: FIRST_ITEM },
      });
      const changedIdentity = await app.inject({
        method: "PUT",
        url: `/api/references/${FIRST_ITEM.id}`,
        headers: { cookie },
        payload: { item: { ...FIRST_ITEM, id: "different" } },
      });
      expect(changedIdentity.statusCode).toBe(400);
      const unchanged = await app.inject({
        method: "GET",
        url: "/api/references",
        headers: { cookie },
      });
      expect(unchanged.json()).toEqual([FIRST_ITEM]);
    } finally {
      await app.close();
    }
  });

  it("handles encoded identities safely and rejects unrouteable identities", async () => {
    const app = createApp();
    try {
      const cookie = await seedAndLogin(app, MENTOR_A);
      const identities = [
        "space key",
        "引用2026",
        "slash/key",
        "question?key",
        "hash#key",
      ];
      for (const identity of identities) {
        const item = { ...FIRST_ITEM, id: identity, title: `Title for ${identity}` };
        const path = `/api/references/${encodeURIComponent(identity)}`;
        const created = await app.inject({
          method: "POST",
          url: "/api/references",
          headers: { cookie },
          payload: { item },
        });
        expect(created.statusCode).toBe(201);

        const updated = await app.inject({
          method: "PUT",
          url: path,
          headers: { cookie },
          payload: { item: { ...item, title: `Updated ${identity}` } },
        });
        expect(updated.statusCode).toBe(200);
        const removed = await app.inject({
          method: "DELETE",
          url: path,
          headers: { cookie },
        });
        expect(removed.statusCode).toBe(204);
      }

      const overlongIdentity = "x".repeat(513);
      const overlongCreate = await app.inject({
        method: "POST",
        url: "/api/references",
        headers: { cookie },
        payload: {
          item: { ...FIRST_ITEM, id: overlongIdentity },
        },
      });
      const overlongDelete = await app.inject({
        method: "DELETE",
        url: `/api/references/${overlongIdentity}`,
        headers: { cookie },
      });
      const malformedEncoding = await app.inject({
        method: "DELETE",
        url: "/api/references/%E0%A4%A",
        headers: { cookie },
      });
      expect(overlongCreate.statusCode).toBe(400);
      expect(overlongDelete.statusCode).toBe(400);
      expect([400, 404]).toContain(malformedEncoding.statusCode);
      expect(malformedEncoding.statusCode).not.toBe(500);
    } finally {
      await app.close();
    }
  });

  it("sanitizes internal reference failures", async () => {
    const app = createApp();
    try {
      const cookie = await seedAndLogin(app, MENTOR_A);
      const project = await pool.query<{ id: string }>(
        `
          SELECT projects.id
          FROM projects
          JOIN "user" ON "user".id = projects.owner_user_id
          WHERE "user".email = $1 AND projects.is_default = true
        `,
        [MENTOR_A.email],
      );
      await pool.query(
        `
          INSERT INTO project_references (project_id, cite_key, item_json)
          VALUES ($1, $2, $3::jsonb)
        `,
        [
          project.rows[0]!.id,
          "invalid-stored-item",
          JSON.stringify({
            id: "invalid-stored-item",
            type: "book",
            title: "Stored item",
            internalDetail: "must not be exposed",
          }),
        ],
      );

      const response = await app.inject({
        method: "GET",
        url: "/api/references",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "REFERENCE_SERVICE_ERROR" });
      expect(response.body).not.toContain("internalDetail");
    } finally {
      await app.close();
    }
  });

  it("updates, deletes, and preserves state across application reconstruction", async () => {
    const firstApp = createApp();
    const cookie = await seedAndLogin(firstApp, MENTOR_A);
    await firstApp.inject({
      method: "POST",
      url: "/api/references",
      headers: { cookie },
      payload: { item: FIRST_ITEM },
    });
    const updatedItem = {
      ...FIRST_ITEM,
      title: "Updated title",
      author: [{ family: "Updated", given: "Author" }],
      issued: { "date-parts": [[2025]] },
    };
    const updated = await firstApp.inject({
      method: "PUT",
      url: `/api/references/${FIRST_ITEM.id}`,
      headers: { cookie },
      payload: { item: updatedItem },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id: FIRST_ITEM.id,
      title: "Updated title",
      author: [{ family: "Updated", given: "Author" }],
      issued: { "date-parts": [[2025]] },
    });
    await firstApp.close();

    const reconstructed = createApp();
    try {
      const reloaded = await reconstructed.inject({
        method: "GET",
        url: "/api/references",
        headers: { cookie },
      });
      expect(reloaded.json()).toEqual([updatedItem]);

      const removed = await reconstructed.inject({
        method: "DELETE",
        url: `/api/references/${FIRST_ITEM.id}`,
        headers: { cookie },
      });
      expect(removed.statusCode).toBe(204);
      const afterDelete = await reconstructed.inject({
        method: "GET",
        url: "/api/references",
        headers: { cookie },
      });
      expect(afterDelete.json()).toEqual([]);
    } finally {
      await reconstructed.close();
    }
  });

  it("isolates users and returns 404 for foreign update and delete", async () => {
    const app = createApp();
    try {
      const cookieA = await seedAndLogin(app, MENTOR_A);
      const cookieB = await seedAndLogin(app, MENTOR_B);
      await app.inject({
        method: "POST",
        url: "/api/references",
        headers: { cookie: cookieA },
        payload: { item: FIRST_ITEM },
      });

      const listB = await app.inject({
        method: "GET",
        url: "/api/references",
        headers: { cookie: cookieB },
      });
      expect(listB.json()).toEqual([]);

      const updateB = await app.inject({
        method: "PUT",
        url: `/api/references/${FIRST_ITEM.id}`,
        headers: { cookie: cookieB },
        payload: { item: { ...FIRST_ITEM, title: "Foreign update" } },
      });
      expect(updateB.statusCode).toBe(404);
      const deleteB = await app.inject({
        method: "DELETE",
        url: `/api/references/${FIRST_ITEM.id}`,
        headers: { cookie: cookieB },
      });
      expect(deleteB.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
