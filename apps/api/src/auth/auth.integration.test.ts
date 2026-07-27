import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { buildApp } from "../app";
import { runMigrations } from "../db/migrate";
import { createMentorAuth } from "./auth";
import { seedMentorAccount } from "./seed-mentor";

const databaseUrl = process.env["DEPRESS_POSTGRES_TEST_URL"];
const describeDatabase = databaseUrl ? describe : describe.skip;
const AUTH_ORIGIN = "http://localhost:3000";
const AUTH_SECRET = "day2-auth-test-secret-at-least-32-characters";
const MENTOR = {
  email: "mentor@example.test",
  password: "correct-password",
  name: "Mentor",
};
const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../db/migrations",
);

type TestResponseHeaders = Record<string, string | string[] | number | undefined>;

function cookieFrom(response: { headers: TestResponseHeaders }): string {
  const value = response.headers["set-cookie"];
  if (typeof value === "number") throw new Error("Invalid numeric Set-Cookie header");
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("Expected an authentication cookie");
  return first.split(";", 1)[0]!;
}

function setCookieText(response: {
  headers: TestResponseHeaders;
}): string {
  const value = response.headers["set-cookie"];
  if (typeof value === "number") throw new Error("Invalid numeric Set-Cookie header");
  return Array.isArray(value) ? value.join("\n") : (value ?? "");
}

describeDatabase("invite-only mentor authentication", () => {
  let pool: Pool;
  let migrationApply: string[] = [];
  let migrationRerun: string[] = [];
  let orphanMigrationError: unknown;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    const foundationOnly = await mkdtemp(join(tmpdir(), "depress-foundation-migration-"));
    try {
      await copyFile(
        join(migrationsDirectory, "0001_mentor_mvp_foundation.sql"),
        join(foundationOnly, "0001_mentor_mvp_foundation.sql"),
      );
      await runMigrations(pool, foundationOnly);
      await pool.query(
        `
          INSERT INTO projects (id, owner_user_id, name, is_default)
          VALUES ('00000000-0000-4000-8000-000000000003', 'orphan-owner', 'Orphan', true)
        `,
      );
      try {
        await runMigrations(pool, migrationsDirectory);
      } catch (error) {
        orphanMigrationError = error;
      }
      await pool.query(
        `DELETE FROM projects WHERE id = '00000000-0000-4000-8000-000000000003'`,
      );
      migrationApply = (await runMigrations(pool, migrationsDirectory)).applied;
      migrationRerun = (await runMigrations(pool, migrationsDirectory)).applied;
    } finally {
      await rm(foundationOnly, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE "verification", "account", "session", "user", project_references, documents, projects CASCADE`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seed() {
    return seedMentorAccount(
      pool,
      {
        secret: AUTH_SECRET,
        origin: AUTH_ORIGIN,
        isProduction: false,
      },
      MENTOR,
    );
  }

  function createApp() {
    const auth = createMentorAuth(pool, {
      secret: AUTH_SECRET,
      origin: AUTH_ORIGIN,
      isProduction: false,
    });
    return buildApp({ auth, authOrigin: AUTH_ORIGIN });
  }

  async function login(app: ReturnType<typeof createApp>, password = MENTOR.password) {
    return app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: AUTH_ORIGIN },
      payload: {
        email: MENTOR.email,
        password,
        rememberMe: true,
      },
    });
  }

  it("refuses orphan projects, then applies pending migrations and reruns idempotently", () => {
    expect(orphanMigrationError).toMatchObject({
      code: "23503",
      message: "Cannot add projects_owner_user_id_fk: orphan projects exist",
    });
    expect(migrationApply).toEqual([
      "0002_better_auth.sql",
      "0003_project_owner_fk.sql",
    ]);
    expect(migrationRerun).toEqual([]);
  });

  it("seeds one Better Auth user and one default project idempotently", async () => {
    const first = await seed();
    const second = await seed();
    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      userId: first.userId,
      defaultProjectId: first.defaultProjectId,
    });
    const users = await pool.query<{ count: string }>(`SELECT count(*) FROM "user"`);
    const projects = await pool.query<{ count: string }>(
      `SELECT count(*) FROM projects WHERE owner_user_id = $1 AND is_default`,
      [first.userId],
    );
    expect(users.rows[0]?.count).toBe("1");
    expect(projects.rows[0]?.count).toBe("1");
  });

  it("rejects public signup, bad passwords, and unknown accounts", async () => {
    await seed();
    const app = createApp();
    try {
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers: { origin: AUTH_ORIGIN },
        payload: {
          email: "other@example.test",
          password: "another-password",
          name: "Other",
        },
      });
      expect(signup.statusCode).toBe(400);

      const invalidPassword = await login(app, "wrong-password");
      expect(invalidPassword.statusCode).toBe(401);

      const unknown = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin: AUTH_ORIGIN },
        payload: {
          email: "unknown@example.test",
          password: "unknown-password",
        },
      });
      expect(unknown.statusCode).toBe(401);
      const users = await pool.query<{ count: string }>(`SELECT count(*) FROM "user"`);
      expect(users.rows[0]?.count).toBe("1");
    } finally {
      await app.close();
    }
  });

  it("restores a database session, protects the probe, and invalidates logout", async () => {
    const mentor = await seed();
    const app = createApp();
    try {
      const signedIn = await login(app);
      expect(signedIn.statusCode).toBe(200);
      const setCookie = setCookieText(signedIn);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).not.toContain("Secure");
      const cookie = cookieFrom(signedIn);

      const restored = await app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie },
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toMatchObject({
        user: { id: mentor.userId, email: MENTOR.email },
      });

      const protectedResponse = await app.inject({
        method: "GET",
        url: "/api/protected-probe",
        headers: { cookie },
      });
      expect(protectedResponse.statusCode).toBe(200);
      expect(protectedResponse.json()).toEqual({ userId: mentor.userId });

      const signedOut = await app.inject({
        method: "POST",
        url: "/api/auth/sign-out",
        headers: { cookie, origin: AUTH_ORIGIN },
      });
      expect(signedOut.statusCode).toBe(200);

      const afterLogout = await app.inject({
        method: "GET",
        url: "/api/protected-probe",
        headers: { cookie },
      });
      expect(afterLogout.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid and expired cookies at the protected boundary", async () => {
    const mentor = await seed();
    const app = createApp();
    try {
      const invalid = await app.inject({
        method: "GET",
        url: "/api/protected-probe",
        headers: { cookie: "depress.session_token=invalid" },
      });
      expect(invalid.statusCode).toBe(401);

      const signedIn = await login(app);
      const cookie = cookieFrom(signedIn);
      await pool.query(`UPDATE "session" SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1`, [
        mentor.userId,
      ]);
      const expired = await app.inject({
        method: "GET",
        url: "/api/protected-probe",
        headers: { cookie },
      });
      expect(expired.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("marks production cookies Secure without weakening localhost development", async () => {
    await seed();
    const productionOrigin = "https://depress.example.test";
    const auth = createMentorAuth(pool, {
      secret: AUTH_SECRET,
      origin: productionOrigin,
      isProduction: true,
    });
    const app = buildApp({ auth, authOrigin: productionOrigin });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin: productionOrigin },
        payload: {
          email: MENTOR.email,
          password: MENTOR.password,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(setCookieText(response)).toContain("Secure");
    } finally {
      await app.close();
    }
  });
});
