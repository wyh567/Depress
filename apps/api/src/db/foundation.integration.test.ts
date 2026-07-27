import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "./migrate";
import { createProjectRepository } from "./project-repository";
import { createDocumentRepository } from "./document-repository";
import { createReferenceRepository } from "./reference-repository";

const databaseUrl = process.env["DEPRESS_POSTGRES_TEST_URL"];
const describeDatabase = databaseUrl ? describe : describe.skip;

const firstEnvelope = {
  schemaVersion: 1,
  editor: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Draft" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "First body." }] },
    ],
  },
  metadata: { title: "Draft one" },
} as const;

const secondEnvelope = {
  schemaVersion: 1,
  editor: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Revised draft" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Second body." }] },
    ],
  },
  metadata: { title: "Draft two" },
} as const;

describeDatabase("mentor MVP foundation repositories", () => {
  let pool: Pool;

  async function createUser(id: string): Promise<void> {
    await pool.query(
      `
        INSERT INTO "user" (
          "id", "name", "email", "emailVerified", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, true, now(), now())
      `,
      [id, `Test ${id}`, `${id}@example.test`],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE "verification", "account", "session", "user", project_references, documents, projects RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("enforces one concurrent-safe default project per user", async () => {
    await createUser("mentor-user");
    const projects = createProjectRepository(pool);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => projects.getOrCreateDefaultProject("mentor-user"))
    );

    expect(new Set(results.map((project) => project.id))).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ownerUserId: "mentor-user",
      isDefault: true,
      name: "Default Project",
    });
    const count = await pool.query<{ count: string }>(
      "SELECT count(*) FROM projects WHERE owner_user_id = $1 AND is_default",
      ["mentor-user"]
    );
    expect(count.rows[0]?.count).toBe("1");
  });

  it("rejects a project for an owner that does not exist", async () => {
    await expect(
      createProjectRepository(pool).getOrCreateDefaultProject("missing-owner"),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "projects_owner_user_id_fk",
    });
  });

  it("stores an envelope hash and rejects a stale expectedRevision", async () => {
    await createUser("mentor-user");
    const projects = createProjectRepository(pool);
    const documents = createDocumentRepository(pool);
    const project = await projects.getOrCreateDefaultProject("mentor-user");
    const created = await documents.create({
      projectId: project.id,
      envelope: firstEnvelope,
    });

    expect(created.revision).toBe(1);
    expect(created.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.envelope).toEqual(firstEnvelope);
    expect((await documents.list(project.id)).map((document) => document.id)).toEqual([
      created.id,
    ]);

    const saved = await documents.save({
      projectId: project.id,
      documentId: created.id,
      expectedRevision: 1,
      envelope: secondEnvelope,
    });
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") throw new Error("expected saved document");
    expect(saved.document.revision).toBe(2);
    expect(saved.document.contentHash).not.toBe(created.contentHash);

    const conflict = await documents.save({
      projectId: project.id,
      documentId: created.id,
      expectedRevision: 1,
      envelope: firstEnvelope,
    });
    expect(conflict).toEqual({ status: "conflict", currentRevision: 2 });

    const reloaded = await documents.get({
      projectId: project.id,
      documentId: created.id,
    });
    expect(reloaded?.revision).toBe(2);
    expect(reloaded?.envelope).toEqual(secondEnvelope);
  });

  it("scopes reference identity and mutations to a project", async () => {
    await createUser("mentor-a");
    await createUser("mentor-b");
    const projects = createProjectRepository(pool);
    const references = createReferenceRepository(pool);
    const firstProject = await projects.getOrCreateDefaultProject("mentor-a");
    const secondProject = await projects.getOrCreateDefaultProject("mentor-b");

    await references.upsert({
      projectId: firstProject.id,
      item: {
        id: "smith2024",
        type: "article-journal",
        title: "First title",
      },
    });
    await references.upsert({
      projectId: secondProject.id,
      item: {
        id: "smith2024",
        type: "article-journal",
        title: "Other project title",
      },
    });
    await references.upsert({
      projectId: firstProject.id,
      item: {
        id: "smith2024",
        type: "article-journal",
        title: "Updated title",
      },
    });

    expect((await references.list(firstProject.id)).map((row) => row.item.title)).toEqual([
      "Updated title",
    ]);
    expect((await references.list(secondProject.id)).map((row) => row.item.title)).toEqual([
      "Other project title",
    ]);
    expect(await references.remove(firstProject.id, "smith2024")).toBe(true);
    expect(await references.list(firstProject.id)).toEqual([]);
    expect(await references.list(secondProject.id)).toHaveLength(1);
  });

  it("cascades a deleted user through auth and all owned project data", async () => {
    await createUser("cascade-owner");
    const project = await createProjectRepository(pool).getOrCreateDefaultProject(
      "cascade-owner",
    );
    await createDocumentRepository(pool).create({
      projectId: project.id,
      envelope: firstEnvelope,
    });
    await createReferenceRepository(pool).create({
      projectId: project.id,
      item: {
        id: "cascade2026",
        type: "book",
        title: "Cascade reference",
      },
    });
    await pool.query(
      `
        INSERT INTO "session" (
          "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
        )
        VALUES ('cascade-session', now() + interval '1 hour', 'cascade-token', now(), now(), $1)
      `,
      ["cascade-owner"],
    );
    await pool.query(
      `
        INSERT INTO "account" (
          "id", "accountId", "providerId", "userId", "createdAt", "updatedAt"
        )
        VALUES ('cascade-account', 'cascade-owner', 'credential', $1, now(), now())
      `,
      ["cascade-owner"],
    );

    await pool.query(`DELETE FROM "user" WHERE "id" = $1`, ["cascade-owner"]);

    const counts = await pool.query<{
      projects: string;
      documents: string;
      references: string;
      sessions: string;
      accounts: string;
    }>(`
      SELECT
        (SELECT count(*) FROM projects) AS projects,
        (SELECT count(*) FROM documents) AS documents,
        (SELECT count(*) FROM project_references) AS references,
        (SELECT count(*) FROM "session") AS sessions,
        (SELECT count(*) FROM "account") AS accounts
    `);
    expect(counts.rows[0]).toEqual({
      projects: "0",
      documents: "0",
      references: "0",
      sessions: "0",
      accounts: "0",
    });
  });
});
