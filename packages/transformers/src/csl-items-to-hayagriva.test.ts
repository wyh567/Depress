import { describe, expect, it } from "vitest";
import type { CslItem } from "@depress/ast";
import { cslItemsToHayagriva } from "./csl-items-to-hayagriva";

const allTypes: CslItem[] = [
  {
    id: "journal",
    type: "article-journal",
    title: "A Journal Article",
    author: [
      { family: "Smith", given: "Alice" },
      { literal: "中国科学院" },
    ],
    issued: { "date-parts": [[2024, 5, 1]] },
    "container-title": "Journal of Determinism",
    DOI: "10.1000/example.1",
    volume: "12",
    issue: "3",
    page: "10-20",
    publisher: "Example Society",
    URL: "https://doi.org/10.1000/example.1",
  },
  {
    id: "book",
    type: "book",
    title: "A Book",
    author: [{ family: "Doe", given: "Jane" }],
    issued: { "date-parts": [[2023]] },
    volume: "2",
    publisher: "DePress Press",
  },
  {
    id: "conference",
    type: "paper-conference",
    title: "A Conference Paper",
    "container-title": "Proceedings of Stable Systems",
    page: "21-29",
    publisher: "IEEE",
  },
  {
    id: "chapter",
    type: "chapter",
    title: "A Chapter",
    "container-title": "Collected Compiler Studies",
    page: "30-44",
    publisher: "Academic Press",
  },
  {
    id: "thesis",
    type: "thesis",
    title: "A Thesis",
    publisher: "Example University",
  },
  {
    id: "web",
    type: "webpage",
    title: "A Web Page",
    URL: "https://example.com/docs?a=1&b=2",
  },
  {
    id: "document",
    type: "document",
    title: "A Generic Document",
  },
];

describe("cslItemsToHayagriva", () => {
  it("serializes every supported CSL type and field in stable order (snapshot)", () => {
    expect(cslItemsToHayagriva(allTypes)).toMatchSnapshot();
  });

  it("supports family/given, literal, and multiple authors", () => {
    const yaml = cslItemsToHayagriva([allTypes[0]!]);
    expect(yaml).toContain('name: "Smith"');
    expect(yaml).toContain('given-name: "Alice"');
    expect(yaml).toContain('name: "中国科学院"');
    expect(yaml.match(/^    - name:/gm)).toHaveLength(2);
  });

  it("preserves Unicode and safely quotes YAML strings and canonical citeKeys", () => {
    const keys = [
      "smith2024",
      "Smith2024",
      "zhang-2025",
      "paper_01",
      "中文文献",
      "key.with.dots",
      "key/with/slash",
      'key"quote',
    ];
    const items: CslItem[] = keys.map((id, index) => ({
      id,
      type: "document",
      title:
        index === 4
          ? "中文标题"
          : index === 7
            ? 'A "quoted" title: #tag\nsecond line \\ path'
            : `Title ${index}`,
      ...(index === 4 ? { author: [{ literal: "王伟" }] } : {}),
    }));
    const yaml = cslItemsToHayagriva(items);
    for (const key of keys) {
      expect(yaml).toContain(`${JSON.stringify(key)}:`);
    }
    expect(yaml).toContain("中文标题");
    expect(yaml).toContain("王伟");
    expect(yaml).toContain('A \\"quoted\\" title: #tag\\nsecond line \\\\ path');
    expect(yaml).not.toContain("#set");
  });

  it("omits absent optional values", () => {
    expect(
      cslItemsToHayagriva([
        { id: "minimal", type: "document", title: "Minimal" },
      ]),
    ).toBe('"minimal":\n  type: Misc\n  title: "Minimal"\n');
  });

  it("preserves the first valid CSL issued date tuple at its available precision", () => {
    const yaml = cslItemsToHayagriva([
      {
        id: "year",
        type: "document",
        title: "Year only",
        issued: { "date-parts": [[2025]] },
      },
      {
        id: "year-month",
        type: "document",
        title: "Year and month",
        issued: { "date-parts": [[2025, 6]] },
      },
      {
        id: "full-date",
        type: "document",
        title: "Full date 中文",
        issued: { "date-parts": [[2025, 6, 15]] },
      },
      {
        id: "no-date",
        type: "document",
        title: "No date 王伟",
      },
    ]);

    expect(yaml).toContain('"year":\n  type: Misc\n  title: "Year only"\n  date: 2025\n');
    expect(yaml).toContain('"year-month":\n  type: Misc\n  title: "Year and month"\n  date: 2025-06\n');
    expect(yaml).toContain('"full-date":\n  type: Misc\n  title: "Full date 中文"\n  date: 2025-06-15\n');
    expect(yaml).toContain('"no-date":\n  type: Misc\n  title: "No date 王伟"\n');
    expect(yaml).not.toContain('"no-date":\n  type: Misc\n  title: "No date 王伟"\n  date:');
  });

  it("is deterministic and does not mutate input", () => {
    const input = structuredClone(allTypes);
    const before = structuredClone(input);
    const first = cslItemsToHayagriva(input);
    const second = cslItemsToHayagriva(input);
    expect(second).toBe(first);
    expect(input).toEqual(before);
    expect(first).not.toMatch(/timestamp|generated-at|random/i);
  });
});
