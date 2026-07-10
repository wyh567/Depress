import { describe, expect, it } from "vitest";
import { BlockNodeSchema, DocSchema, parseDoc } from "./schema";

const text = (t: string) => ({ type: "text", text: t });

describe("DocSchema accepts valid input", () => {
  it("accepts a full document with all node types", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", level: 1, content: [text("Introduction")] },
        {
          type: "paragraph",
          content: [
            text("As shown by "),
            { type: "citation", citeKey: "smith2024" },
            { type: "text", text: "E. coli", marks: ["italic"] },
            { type: "text", text: "v", marks: ["bold", "italic"] },
          ],
        },
        { type: "heading", level: 3, content: [text("Sub-sub")] },
        { type: "figure" },
        { type: "table" },
      ],
    };
    expect(DocSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts an empty doc and an empty paragraph", () => {
    expect(parseDoc({ type: "doc", content: [] }).success).toBe(true);
    expect(
      parseDoc({ type: "doc", content: [{ type: "paragraph", content: [] }] }).success
    ).toBe(true);
  });

  it("accepts a document without metadata (backward compatible)", () => {
    expect(
      parseDoc({
        type: "doc",
        content: [{ type: "paragraph", content: [text("Hi")] }],
      }).success,
    ).toBe(true);
  });

  it("accepts full semantic metadata", () => {
    const result = parseDoc({
      type: "doc",
      metadata: {
        title: "A Structured Editor for Academic Publishing",
        authors: [
          { name: "Ada Lovelace", affiliationIds: ["aff-1"] },
          { name: "王伟", affiliationIds: ["aff-1", "aff-2"] },
        ],
        affiliations: [
          { id: "aff-1", name: "Analytical Engines Lab" },
          { id: "aff-2", name: "计算机学院" },
        ],
        abstract: "We separate content from layout.",
        keywords: ["academic publishing", "AST", "Typst"],
      },
      content: [{ type: "paragraph", content: [text("Body")] }],
    });
    expect(result.success).toBe(true);
  });
});

describe("DocSchema metadata validation", () => {
  it("trims title/author/affiliation/abstract/keywords", () => {
    const result = parseDoc({
      type: "doc",
      metadata: {
        title: "  Title  ",
        authors: [{ name: "  Ada  ", affiliationIds: ["  aff-1  "] }],
        affiliations: [{ id: "  aff-1  ", name: "  Lab  " }],
        abstract: "  Abstract  ",
        keywords: ["  kw1  ", "kw2"],
      },
      content: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({
        title: "Title",
        authors: [{ name: "Ada", affiliationIds: ["aff-1"] }],
        affiliations: [{ id: "aff-1", name: "Lab" }],
        abstract: "Abstract",
        keywords: ["kw1", "kw2"],
      });
    }
  });

  it("deduplicates keywords by first occurrence (case-sensitive)", () => {
    const result = parseDoc({
      type: "doc",
      metadata: { keywords: ["AST", "Typst", "AST", "typst"] },
      content: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata?.keywords).toEqual(["AST", "Typst", "typst"]);
    }
  });

  it("rejects blank-only metadata strings", () => {
    expect(
      parseDoc({ type: "doc", metadata: { title: "   " }, content: [] }).success,
    ).toBe(false);
    expect(
      parseDoc({
        type: "doc",
        metadata: { authors: [{ name: "   " }] },
        content: [],
      }).success,
    ).toBe(false);
    expect(
      parseDoc({
        type: "doc",
        metadata: { keywords: ["ok", "   "] },
        content: [],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate affiliation ids", () => {
    const result = parseDoc({
      type: "doc",
      metadata: {
        affiliations: [
          { id: "aff-1", name: "A" },
          { id: "aff-1", name: "B" },
        ],
      },
      content: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.join(".") === "metadata.affiliations.1.id"),
      ).toBe(true);
    }
  });

  it("rejects author affiliationIds that are unknown", () => {
    const result = parseDoc({
      type: "doc",
      metadata: {
        authors: [{ name: "Ada", affiliationIds: ["missing"] }],
        affiliations: [{ id: "aff-1", name: "Lab" }],
      },
      content: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.path.join(".").startsWith("metadata.authors.0.affiliationIds"),
        ),
      ).toBe(true);
    }
  });

  it("rejects presentation fields on metadata (strict)", () => {
    expect(
      parseDoc({
        type: "doc",
        metadata: { title: "T", fontSize: 12 },
        content: [],
      }).success,
    ).toBe(false);
  });
});

describe("DocSchema rejects invalid input", () => {
  const docWith = (block: unknown) => ({ type: "doc", content: [block] });

  it.each([4, 0, 1.5])("rejects heading level %p", (level) => {
    expect(parseDoc(docWith({ type: "heading", level, content: [] })).success).toBe(false);
  });

  it("rejects citation without citeKey", () => {
    expect(
      parseDoc(docWith({ type: "paragraph", content: [{ type: "citation" }] })).success
    ).toBe(false);
  });

  it("rejects citation with whitespace-only citeKey", () => {
    expect(
      parseDoc(docWith({ type: "paragraph", content: [{ type: "citation", citeKey: "   " }] }))
        .success
    ).toBe(false);
  });

  it("trims surrounding whitespace on citeKey but preserves case", () => {
    const result = parseDoc(
      docWith({
        type: "paragraph",
        content: [{ type: "citation", citeKey: "  Smith2024  " }],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const para = result.data.content[0];
      expect(para?.type).toBe("paragraph");
      if (para?.type === "paragraph") {
        expect(para.content[0]).toEqual({ type: "citation", citeKey: "Smith2024" });
      }
    }
  });

  it("rejects citation with empty citeKey", () => {
    expect(
      parseDoc(docWith({ type: "paragraph", content: [{ type: "citation", citeKey: "" }] }))
        .success
    ).toBe(false);
  });

  it("rejects unknown block node type", () => {
    expect(parseDoc(docWith({ type: "pagebreak" })).success).toBe(false);
  });

  it("rejects unknown inline node type", () => {
    expect(
      parseDoc(docWith({ type: "paragraph", content: [{ type: "footnote", text: "x" }] }))
        .success
    ).toBe(false);
  });

  it("rejects citation at block level", () => {
    expect(BlockNodeSchema.safeParse({ type: "citation", citeKey: "smith2024" }).success).toBe(
      false
    );
  });

  it("rejects visual marks", () => {
    expect(
      parseDoc(
        docWith({
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: ["font-size"] }],
        })
      ).success
    ).toBe(false);
  });
});
