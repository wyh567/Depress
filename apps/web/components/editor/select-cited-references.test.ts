import { describe, expect, it } from "vitest";
import type { CslItem, Doc } from "@depress/ast";
import { selectCitedReferences } from "./select-cited-references";

const smith: CslItem = {
  id: "smith2024",
  type: "article-journal",
  title: "A Study",
  volume: "1",
};
const lee: CslItem = {
  id: "lee2023",
  type: "book",
  title: "Another",
  publisher: "Press",
};
const unused: CslItem = {
  id: "unused",
  type: "document",
  title: "Not cited",
};

function docWithKeys(...keys: string[]): Doc {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: keys.map((citeKey) => ({ type: "citation" as const, citeKey })),
      },
    ],
  };
}

describe("selectCitedReferences", () => {
  it("one citation sends one matching reference", () => {
    const result = selectCitedReferences(docWithKeys("smith2024"), [smith, unused]);
    expect(result).toEqual({ success: true, references: [smith] });
  });

  it("repeated citation sends one reference", () => {
    const result = selectCitedReferences(
      docWithKeys("smith2024", "smith2024"),
      [smith, unused],
    );
    expect(result).toEqual({ success: true, references: [smith] });
  });

  it("multiple citations produce deterministic first-occurrence ordering", () => {
    const result = selectCitedReferences(
      docWithKeys("lee2023", "smith2024", "lee2023"),
      [smith, lee, unused],
    );
    expect(result).toEqual({ success: true, references: [lee, smith] });
  });

  it("no citations sends an empty array", () => {
    const result = selectCitedReferences(
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
      },
      [smith],
    );
    expect(result).toEqual({ success: true, references: [] });
  });

  it("missing reference fails with a structured issue", () => {
    const result = selectCitedReferences(docWithKeys("missing"), [smith]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual([
        { path: "references.0", message: "缺少被引用文献: missing" },
      ]);
    }
  });

  it("does not mutate the library array", () => {
    const library: CslItem[] = [smith, lee];
    const snapshot = structuredClone(library);
    selectCitedReferences(docWithKeys("smith2024", "lee2023"), library);
    expect(library).toEqual(snapshot);
  });
});
