import { describe, expect, it } from "vitest";
import {
  CompileJobPayloadSchema,
  CompileRequestSchema,
  collectCiteKeys,
} from "./compile";
import type { Doc } from "./schema";

const validAst = {
  type: "doc" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [
        { type: "text" as const, text: "See " },
        { type: "citation" as const, citeKey: "smith2024" },
      ],
    },
  ],
};

const validRef = {
  id: "smith2024",
  type: "article-journal" as const,
  title: "A Study",
  volume: "12",
  issue: "3",
  page: "10-20",
  publisher: "Nature Publishing",
  URL: "https://example.com/smith2024",
};

describe("CompileRequestSchema", () => {
  it("accepts a valid AST plus references", () => {
    const result = CompileRequestSchema.safeParse({
      ast: validAst,
      references: [validRef],
      templateId: "ieee",
      format: "pdf",
    });
    expect(result.success).toBe(true);
  });

  it("accepts references: []", () => {
    expect(
      CompileRequestSchema.safeParse({
        ast: { type: "doc", content: [] },
        references: [],
        templateId: "ieee",
        format: "pdf",
      }).success,
    ).toBe(true);
  });

  it("rejects when references is missing", () => {
    expect(
      CompileRequestSchema.safeParse({
        ast: validAst,
        templateId: "ieee",
        format: "pdf",
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid CSL item in references", () => {
    expect(
      CompileRequestSchema.safeParse({
        ast: validAst,
        references: [{ id: "   ", type: "book", title: "T" }],
        templateId: "ieee",
        format: "pdf",
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed AST", () => {
    expect(
      CompileRequestSchema.safeParse({
        ast: { type: "doc", content: [{ type: "heading", level: 4, content: [] }] },
        references: [],
        templateId: "ieee",
        format: "pdf",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown templateId", () => {
    expect(
      CompileRequestSchema.safeParse({
        ast: validAst,
        references: [],
        templateId: "elsevier",
        format: "pdf",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown format", () => {
    expect(
      CompileRequestSchema.safeParse({
        ast: validAst,
        references: [],
        templateId: "ieee",
        format: "docx",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    expect(
      CompileRequestSchema.safeParse({
        ast: validAst,
        references: [],
        templateId: "ieee",
        format: "pdf",
        fontSize: 72,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate CslItem.id values in references", () => {
    const result = CompileRequestSchema.safeParse({
      ast: validAst,
      references: [
        { id: "smith2024", type: "article-journal", title: "Paper A" },
        { id: "smith2024", type: "article-journal", title: "Paper B" },
      ],
      templateId: "ieee",
      format: "pdf",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "references.1.id")).toBe(
        true,
      );
    }
  });
});

describe("CompileJobPayloadSchema", () => {
  it("accepts a valid request plus jobId", () => {
    const result = CompileJobPayloadSchema.safeParse({
      jobId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
      ast: validAst,
      references: [validRef],
      templateId: "ieee",
      format: "pdf",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid references", () => {
    expect(
      CompileJobPayloadSchema.safeParse({
        jobId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
        ast: validAst,
        references: [{ type: "book", title: "T" }],
        templateId: "ieee",
        format: "pdf",
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid jobId", () => {
    expect(
      CompileJobPayloadSchema.safeParse({
        jobId: "not-a-uuid",
        ast: validAst,
        references: [],
        templateId: "ieee",
        format: "pdf",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields and duplicate reference ids", () => {
    expect(
      CompileJobPayloadSchema.safeParse({
        jobId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
        ast: validAst,
        references: [],
        templateId: "ieee",
        format: "pdf",
        fontSize: 72,
      }).success,
    ).toBe(false);
    expect(
      CompileJobPayloadSchema.safeParse({
        jobId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
        ast: validAst,
        references: [
          { id: "smith2024", type: "book", title: "A" },
          { id: "smith2024", type: "book", title: "B" },
        ],
        templateId: "ieee",
        format: "pdf",
      }).success,
    ).toBe(false);
  });
});

describe("collectCiteKeys", () => {
  it("returns first-occurrence order and collapses duplicates", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "citation", citeKey: "b" },
            { type: "text", text: " " },
            { type: "citation", citeKey: "a" },
            { type: "citation", citeKey: "b" },
          ],
        },
        {
          type: "heading",
          level: 1,
          content: [{ type: "citation", citeKey: "c" }],
        },
      ],
    };
    expect(collectCiteKeys(doc)).toEqual(["b", "a", "c"]);
  });

  it("returns [] when the document has no citations", () => {
    expect(
      collectCiteKeys({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
      }),
    ).toEqual([]);
  });
});
