import { describe, expect, it } from "vitest";
import { CslItemSchema } from "@depress/ast";
import { crossrefWorkToCslItem } from "./crossref-work-to-csl";
import type { CrossrefWorkMessage } from "./provider-schema";

const baseJournal: CrossrefWorkMessage = {
  DOI: "10.1000/XYZ",
  type: "journal-article",
  title: ["  A Journal Title  "],
  author: [
    { family: "Smith", given: "Ada" },
    { family: "Jones", given: "Bob" },
  ],
  "container-title": ["  Nature  "],
  volume: "12",
  issue: "3",
  page: "1-10",
  publisher: "Example Press",
  URL: "https://doi.org/10.1000/xyz",
  "published-print": { "date-parts": [[2020, 5]] },
  issued: { "date-parts": [[2019]] },
};

describe("crossrefWorkToCslItem", () => {
  it("maps a journal article", () => {
    const result = crossrefWorkToCslItem(baseJournal, "10.1000/xyz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item).toMatchObject({
      id: "10.1000/xyz",
      DOI: "10.1000/xyz",
      type: "article-journal",
      title: "A Journal Title",
      "container-title": "Nature",
      volume: "12",
      issue: "3",
      page: "1-10",
      publisher: "Example Press",
      URL: "https://doi.org/10.1000/xyz",
      author: [
        { family: "Smith", given: "Ada" },
        { family: "Jones", given: "Bob" },
      ],
      issued: { "date-parts": [[2020, 5]] },
    });
    expect(CslItemSchema.parse(result.item)).toEqual(result.item);
  });

  it("maps book / chapter / conference / thesis types; posted-content → document", () => {
    expect(
      (crossrefWorkToCslItem({ ...baseJournal, type: "book" }, "10.1000/a") as { ok: true; item: { type: string } }).item.type,
    ).toBe("book");
    expect(
      (crossrefWorkToCslItem({ ...baseJournal, type: "monograph" }, "10.1000/a") as { ok: true; item: { type: string } }).item.type,
    ).toBe("book");
    expect(
      (crossrefWorkToCslItem({ ...baseJournal, type: "book-chapter" }, "10.1000/a") as { ok: true; item: { type: string } }).item.type,
    ).toBe("chapter");
    expect(
      (crossrefWorkToCslItem({ ...baseJournal, type: "proceedings-article" }, "10.1000/a") as { ok: true; item: { type: string } }).item.type,
    ).toBe("paper-conference");
    expect(
      (crossrefWorkToCslItem({ ...baseJournal, type: "dissertation" }, "10.1000/a") as { ok: true; item: { type: string } }).item.type,
    ).toBe("thesis");
    expect(
      (crossrefWorkToCslItem({ ...baseJournal, type: "posted-content" }, "10.1000/a") as { ok: true; item: { type: string } }).item.type,
    ).toBe("document");
  });

  it("falls back unknown types to document", () => {
    const result = crossrefWorkToCslItem(
      { ...baseJournal, type: "future-crossref-type" },
      "10.1000/xyz",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.type).toBe("document");
  });

  it("selects the first non-empty title and container-title", () => {
    const result = crossrefWorkToCslItem(
      {
        ...baseJournal,
        title: ["  ", "Primary Title", "Secondary"],
        "container-title": ["", " Journal One ", "Journal Two"],
      },
      "10.1000/xyz",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.title).toBe("Primary Title");
    expect(result.item["container-title"]).toBe("Journal One");
  });

  it("maps Chinese literal-style names via Crossref name field and Unicode titles", () => {
    const result = crossrefWorkToCslItem(
      {
        type: "journal-article",
        title: ["深度学习综述"],
        author: [{ name: "张三" }, { family: "李", given: "四" }],
      },
      "10.1000/cn",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.title).toBe("深度学习综述");
    expect(result.item.author).toEqual([
      { literal: "张三" },
      { family: "李", given: "四" },
    ]);
  });

  it("omits authors when none are usable and does not invent placeholders", () => {
    const result = crossrefWorkToCslItem(
      {
        ...baseJournal,
        author: [{ given: "OnlyGiven" }, {}],
      },
      "10.1000/xyz",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.author).toBeUndefined();
    expect(JSON.stringify(result.item)).not.toContain("Unknown");
    expect(JSON.stringify(result.item)).not.toContain("Anonymous");
    expect(JSON.stringify(result.item)).not.toContain("Untitled");
  });

  it("uses published-print before issued for date precedence", () => {
    const result = crossrefWorkToCslItem(baseJournal, "10.1000/xyz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.issued).toEqual({ "date-parts": [[2020, 5]] });
  });

  it("rejects missing title", () => {
    expect(
      crossrefWorkToCslItem({ ...baseJournal, title: ["  ", ""] }, "10.1000/xyz"),
    ).toEqual({ ok: false, error: "INVALID_CROSSREF_METADATA" });
  });

  it("does not mutate input and is deterministic", () => {
    const work = structuredClone(baseJournal);
    const snapshot = structuredClone(work);
    const a = crossrefWorkToCslItem(work, "10.1000/xyz");
    const b = crossrefWorkToCslItem(work, "10.1000/xyz");
    expect(work).toEqual(snapshot);
    expect(a).toEqual(b);
  });
});
