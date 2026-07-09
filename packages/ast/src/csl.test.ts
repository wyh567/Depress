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
      volume: "42",
      issue: "3",
      page: "101-110",
      publisher: "Nature Publishing Group",
      URL: "https://doi.org/10.1000/j.issn.1234-5678(2024)01",
    };
    expect(CslItemSchema.safeParse(item).success).toBe(true);
  });

  it("accepts a minimal item (id + type + title)", () => {
    expect(
      CslItemSchema.safeParse({ id: "k1", type: "document", title: "无类型文档" }).success
    ).toBe(true);
  });

  it.each([
    ["volume", "12"],
    ["issue", "3"],
    ["page", "10-20"],
    ["publisher", "MIT Press"],
    ["URL", "https://example.com/paper"],
  ] as const)("accepts optional %s", (field, value) => {
    const result = CslItemSchema.safeParse({
      id: "k",
      type: "article-journal",
      title: "T",
      [field]: value,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[field]).toBe(value);
    }
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

  it("trims bibliography optional string fields", () => {
    const result = CslItemSchema.safeParse({
      id: "k",
      type: "book",
      title: "T",
      volume: "  1  ",
      issue: "  2  ",
      page: "  3-4  ",
      publisher: "  Press  ",
      URL: "  https://example.com  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.volume).toBe("1");
      expect(result.data.issue).toBe("2");
      expect(result.data.page).toBe("3-4");
      expect(result.data.publisher).toBe("Press");
      expect(result.data.URL).toBe("https://example.com");
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
    ["whitespace-only volume", { id: "k", type: "book", title: "T", volume: "   " }],
    ["whitespace-only issue", { id: "k", type: "book", title: "T", issue: "   " }],
    ["whitespace-only page", { id: "k", type: "book", title: "T", page: "   " }],
    ["whitespace-only publisher", { id: "k", type: "book", title: "T", publisher: "   " }],
    ["whitespace-only URL", { id: "k", type: "book", title: "T", URL: "   " }],
  ])("rejects %s", (_label, item) => {
    expect(CslItemSchema.safeParse(item).success).toBe(false);
  });
});
