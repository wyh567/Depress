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
