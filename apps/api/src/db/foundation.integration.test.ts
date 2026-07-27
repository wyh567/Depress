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

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE project_references, documents, projects RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("enforces one concurrent-safe default project per user", async () => {
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

  it("stores an envelope hash and rejects a stale expectedRevision", async () => {
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
});
