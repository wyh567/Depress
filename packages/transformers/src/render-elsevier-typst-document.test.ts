import { describe, expect, it } from "vitest";
import { renderElsevierTypstProject } from "./render-typst-project";
import { renderElsevierTypstDocument } from "./render-elsevier-typst-document";

const paper = {
  type: "doc" as const,
  metadata: {
    title: "Elsevier Manuscript — Café",
    authors: [
      { name: "Ada Lovelace", affiliationIds: ["aff-1"] },
      { name: "李华", affiliationIds: ["aff-1", "aff-2"] },
      { name: "Independent Author" },
    ],
    affiliations: [
      { id: "aff-1", name: "Compiler Systems Lab" },
      { id: "aff-2", name: "计算语言学实验室" },
    ],
    abstract: 'Costs $5, uses "quotes", C:\\docs, [brackets],\nand Unicode 王伟。',
    keywords: ["AST", "Café", "中文"],
  },
  content: [
    { type: "heading" as const, level: 1 as const, content: [{ type: "text" as const, text: "Introduction" }] },
    { type: "paragraph" as const, content: [{ type: "text" as const, text: "Body text." }] },
  ],
};

describe("renderElsevierTypstDocument", () => {
  it("renders the deterministic immutable manuscript template (snapshot)", () => {
    expect(renderElsevierTypstDocument(paper)).toMatchSnapshot();
  });

  it("is visibly distinct from IEEE and single-column", () => {
    const source = renderElsevierTypstDocument(paper);
    expect(source).toContain("DePress Elsevier author-date manuscript template");
    expect(source).toContain("columns: 1");
    expect(source).not.toContain("columns: 2");
    expect(source).toContain('font: ("Libertinus Serif", "Noto Sans CJK SC")');
  });

  it("renders title, ordered authors, and deterministic affiliation markers", () => {
    const source = renderElsevierTypstDocument(paper);
    expect(source.indexOf("Ada Lovelace")).toBeLessThan(source.indexOf("李华"));
    expect(source.indexOf("李华")).toBeLessThan(source.indexOf("Independent Author"));
    expect(source).toContain("Ada Lovelace#super[1]");
    expect(source).toContain("李华#super[1, 2]");
    expect(source).toContain("#super[1] Compiler Systems Lab");
    expect(source).toContain("#super[2] 计算语言学实验室");
    expect(source).not.toContain("aff-1");
    expect(source).not.toContain("aff-2");
  });

  it("renders abstract and keywords only when present", () => {
    const source = renderElsevierTypstDocument(paper);
    expect(source).toContain("#strong[Abstract]");
    expect(source).toContain("#strong[Keywords]");
    expect(source).toContain("AST, Café, 中文");

    const minimal = renderElsevierTypstDocument({ type: "doc", content: [] });
    expect(minimal).not.toContain("#strong[Abstract]");
    expect(minimal).not.toContain("#strong[Keywords]");
    expect(minimal).not.toContain("#super[");
  });

  it("uses the legacy fallback title without fake optional metadata", () => {
    const source = renderElsevierTypstDocument({ type: "doc", content: [] });
    expect(source).toContain("DePress Draft");
    expect(source).not.toContain("No abstract");
    expect(source).not.toContain("No keywords");
    expect(source).not.toContain("Unknown Author");
  });

  it("escapes dollars, quotes, backslashes, brackets, newlines, and Unicode", () => {
    const source = renderElsevierTypstDocument(paper);
    expect(source).toContain('Costs \\$5, uses "quotes", C:\\\\docs, \\[brackets\\]');
    expect(source).toContain("and Unicode 王伟。");
    expect(source).not.toContain("{{TITLE}}");
    expect(source).not.toContain("{{AUTHORS}}");
    expect(source).not.toContain("{{AFFILIATIONS}}");
    expect(source).not.toContain("{{ABSTRACT}}");
    expect(source).not.toContain("{{KEYWORDS}}");
    expect(source).not.toContain("{{BODY}}");
    expect(source).not.toContain("{{BIBLIOGRAPHY}}");
  });

  it("mounts exactly the immutable elsevier-harvard bibliography style", () => {
    const project = renderElsevierTypstProject({
      ast: {
        ...paper,
        content: [{ type: "paragraph", content: [{ type: "citation", citeKey: "a" }] }],
      },
      references: [{ id: "a", type: "book", title: "Work A" }],
    });
    expect(project.main.match(/#bibliography\(/g)).toHaveLength(1);
    expect(project.main).toContain(
      '#bibliography("references.yml", title: [References], style: "elsevier-harvard")',
    );
    expect(project.main).not.toContain('style: "ieee"');
  });

  it("is deterministic and does not mutate input", () => {
    const input = structuredClone(paper);
    const before = structuredClone(input);
    expect(renderElsevierTypstDocument(input)).toBe(renderElsevierTypstDocument(input));
    expect(input).toEqual(before);
  });
});
