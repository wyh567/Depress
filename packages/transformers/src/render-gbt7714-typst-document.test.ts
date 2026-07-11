import { describe, expect, it } from "vitest";
import { renderGbt7714TypstDocument } from "./render-gbt7714-typst-document";
import { renderGbt7714TypstProject } from "./render-typst-project";

const paper = {
  type: "doc" as const,
  metadata: {
    title: "中文期刊论文：Café",
    authors: [
      { name: "张三", affiliationIds: ["aff-1"] },
      { name: "Jane Smith", affiliationIds: ["aff-1", "aff-2"] },
      { name: "独立作者" },
    ],
    affiliations: [
      { id: "aff-1", name: "某大学心理学院" },
      { id: "aff-2", name: "Digital Health Laboratory" },
    ],
    abstract: '含有 $、"引号"、C:\\docs、[方括号] 与中文标点。',
    keywords: ["抑郁症", "数字干预", "Café"],
  },
  content: [
    { type: "heading" as const, level: 1 as const, content: [{ type: "text" as const, text: "引言" }] },
    { type: "paragraph" as const, content: [{ type: "text" as const, text: "中文正文。" }] },
  ],
};

describe("renderGbt7714TypstDocument", () => {
  it("renders deterministic immutable Chinese manuscript source (snapshot)", () => {
    expect(renderGbt7714TypstDocument(paper)).toMatchSnapshot();
  });

  it("renders ordered authors, affiliations, Chinese labels, and Unicode", () => {
    const source = renderGbt7714TypstDocument(paper);
    expect(source.indexOf("张三")).toBeLessThan(source.indexOf("Jane Smith"));
    expect(source.indexOf("Jane Smith")).toBeLessThan(source.indexOf("独立作者"));
    expect(source).toContain("张三#super[1]");
    expect(source).toContain("Jane Smith#super[1, 2]");
    expect(source).toContain("#super[1] 某大学心理学院");
    expect(source).toContain("#super[2] Digital Health Laboratory");
    expect(source).toContain("#strong[摘要]");
    expect(source).toContain("#strong[关键词]");
    expect(source).toContain("抑郁症；数字干预；Café");
    expect(source).not.toContain("aff-1");
    expect(source).not.toContain("aff-2");
  });

  it("omits absent optional metadata and uses the safe title fallback", () => {
    const source = renderGbt7714TypstDocument({ type: "doc", content: [] });
    expect(source).toContain("DePress Draft");
    expect(source).not.toContain("#strong[摘要]");
    expect(source).not.toContain("#strong[关键词]");
    expect(source).not.toContain("Unknown Author");
    expect(source).not.toContain("#super[");
  });

  it("escapes Typst-sensitive metadata without unresolved placeholders", () => {
    const source = renderGbt7714TypstDocument(paper);
    expect(source).toContain('含有 \\$、"引号"、C:\\\\docs、\\[方括号\\]');
    for (const placeholder of ["TITLE", "AUTHORS", "AFFILIATIONS", "ABSTRACT", "KEYWORDS", "BODY", "BIBLIOGRAPHY"]) {
      expect(source).not.toContain(`{{${placeholder}}}`);
    }
  });

  it("mounts exactly the fixed numeric bibliography only when cited", () => {
    const cited = renderGbt7714TypstProject({
      ast: {
        ...paper,
        content: [{ type: "paragraph", content: [{ type: "citation", citeKey: "a" }] }],
      },
      references: [{ id: "a", type: "book", title: "参考书" }],
    });
    expect(cited.main).toContain(
      '#bibliography(\n  "references.yml",\n  title: [参考文献],\n  style: "gb-7714-2015-numeric",\n)',
    );
    expect(cited.bibliography).toContain('"a":');

    const citationFree = renderGbt7714TypstProject({
      ast: { type: "doc", content: [] },
      references: [],
    });
    expect(citationFree).not.toHaveProperty("bibliography");
    expect(citationFree.main).not.toContain("#bibliography(");
  });

  it("is deterministic and does not mutate input", () => {
    const input = structuredClone(paper);
    const before = structuredClone(input);
    expect(renderGbt7714TypstDocument(input)).toBe(renderGbt7714TypstDocument(input));
    expect(input).toEqual(before);
  });
});
