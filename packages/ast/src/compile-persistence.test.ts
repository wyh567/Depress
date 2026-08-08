import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CompileJobCreateRequestSchema,
  CompileQueuePointerSchema,
  CompileSnapshotSchema,
} from "./compile";
import { projectPersistedDocumentToAst } from "./persisted-pm-to-ast";

const documentId = randomUUID();
const projectId = randomUUID();

describe("persisted compile contracts", () => {
  it("accepts only the strict authenticated create boundary", () => {
    expect(
      CompileJobCreateRequestSchema.parse({
        documentId,
        revision: 2,
        templateId: "ieee",
        format: "pdf",
      }),
    ).toEqual({
      documentId,
      revision: 2,
      templateId: "ieee",
      format: "pdf",
    });
    expect(
      CompileJobCreateRequestSchema.safeParse({
        documentId,
        revision: 0,
        templateId: "ieee",
        format: "pdf",
      }).success,
    ).toBe(false);
    expect(
      CompileJobCreateRequestSchema.safeParse({
        documentId,
        revision: 1,
        templateId: "ieee",
        format: "pdf",
        projectId,
      }).success,
    ).toBe(false);
  });

  it("validates a strict immutable snapshot", () => {
    const snapshot = {
      schemaVersion: 1,
      documentId,
      revision: 1,
      projectId,
      compileRequest: {
        ast: { type: "doc", content: [] },
        references: [],
        templateId: "gbt7714",
        format: "pdf",
      },
    };
    expect(CompileSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      CompileSnapshotSchema.safeParse({ ...snapshot, ownerId: "mentor" })
        .success,
    ).toBe(false);
  });

  it("allows exactly a UUID job pointer and lowercase SHA-256 hash", () => {
    const pointer = {
      jobId: randomUUID(),
      snapshotHash: "a".repeat(64),
    };
    expect(CompileQueuePointerSchema.parse(pointer)).toEqual(pointer);
    expect(
      CompileQueuePointerSchema.safeParse({
        ...pointer,
        snapshotHash: "A".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      CompileQueuePointerSchema.safeParse({
        ...pointer,
        url: "https://example.test",
      }).success,
    ).toBe(false);
  });

  it("projects persisted PM plus metadata into the semantic Doc AST", () => {
    expect(
      projectPersistedDocumentToAst({
        schemaVersion: 1,
        editor: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [
                { type: "text", text: "Title", marks: [{ type: "bold" }] },
              ],
            },
            {
              type: "paragraph",
              content: [
                { type: "citation", attrs: { citeKey: "smith2026" } },
              ],
            },
          ],
        },
        metadata: { title: "Persisted title" },
      }),
    ).toEqual({
      type: "doc",
      metadata: { title: "Persisted title" },
      content: [
        {
          type: "heading",
          level: 2,
          content: [{ type: "text", text: "Title", marks: ["bold"] }],
        },
        {
          type: "paragraph",
          content: [{ type: "citation", citeKey: "smith2026" }],
        },
      ],
    });
  });
});
