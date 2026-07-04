import { describe, expect, it } from "vitest";
import { CslItemSchema } from "./csl";

describe("CslItemSchema accepts valid items", () => {
  it("accepts a full article-journal item", () => {
    const item = {
      id: "smith2024",
      type: "article-journal",
      title: "A Great Study",
      author: [{ family: "Smith", given: "John" }, { literal: "王伟" }],
      issued: { "date-parts": [[2024]] },
      "container-title": "Nature",
      DOI: "10.1000/j.issn.1234-5678(2024)01",
    };
    expect(CslItemSchema.safeParse(item).success).toBe(true);
  });

  it("accepts a minimal item (id + type + title)", () => {
    expect(
      CslItemSchema.safeParse({ id: "k1", type: "document", title: "无类型文档" }).success
    ).toBe(true);
  });
});

describe("CslItemSchema trims string fields", () => {
  it("trims leading/trailing whitespace on id and title", () => {
    const result = CslItemSchema.safeParse({
      id: "  smith2024  ",
      type: "book",
      title: "  A Study  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("smith2024");
      expect(result.data.title).toBe("A Study");
    }
  });
});

describe("CslItemSchema rejects invalid items", () => {
  it.each([
    ["missing id", { type: "book", title: "T" }],
    ["empty id", { id: "", type: "book", title: "T" }],
    ["whitespace id", { id: "   ", type: "book", title: "T" }],
    ["unknown type", { id: "k", type: "misc", title: "T" }],
    ["missing title", { id: "k", type: "book" }],
    ["whitespace-only title", { id: "k", type: "book", title: "   " }],
    ["whitespace-only author literal", { id: "k", type: "book", title: "T", author: [{ literal: "  " }] }],
  ])("rejects %s", (_label, item) => {
    expect(CslItemSchema.safeParse(item).success).toBe(false);
  });
});
