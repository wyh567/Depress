import { describe, expect, it } from "vitest";
import { AstValidationError } from "./ast-to-typst";
import {
  renderElsevierTypstProject,
  renderIeeeTypstProject,
  renderTypstProject,
} from "./render-typst-project";

const ast = {
  type: "doc" as const,
  metadata: { title: "Shared Citation Pipeline" },
  content: [{
    type: "paragraph" as const,
    content: [
      { type: "text" as const, text: "A " },
      { type: "citation" as const, citeKey: "a" },
      { type: "text" as const, text: ", B " },
      { type: "citation" as const, citeKey: "b" },
      { type: "text" as const, text: ", A again " },
      { type: "citation" as const, citeKey: "a" },
    ],
  }],
};

const references = [
  { id: "unused", type: "document" as const, title: "Unused" },
  { id: "b", type: "book" as const, title: "Work B" },
  { id: "a", type: "article-journal" as const, title: "Work A" },
];

describe("renderTypstProject", () => {
  it("dispatches IEEE through its compatibility wrapper", () => {
    const generic = renderTypstProject({ ast, references, templateId: "ieee" });
    expect(generic).toEqual(renderIeeeTypstProject({ ast, references }));
    expect(generic.main).toContain("DePress IEEE template");
    expect(generic.main).toContain('style: "ieee"');
  });

  it("dispatches Elsevier through its compatibility wrapper", () => {
    const generic = renderTypstProject({ ast, references, templateId: "elsevier" });
    expect(generic).toEqual(renderElsevierTypstProject({ ast, references }));
    expect(generic.main).toContain("DePress Elsevier author-date manuscript template");
    expect(generic.main).toContain('style: "elsevier-harvard"');
  });

  it("uses byte-identical cited-only bibliography output", () => {
    const ieee = renderTypstProject({ ast, references, templateId: "ieee" });
    const elsevier = renderTypstProject({ ast, references, templateId: "elsevier" });
    expect(elsevier.bibliography).toBe(ieee.bibliography);
    const bibliography = ieee.bibliography ?? "";
    expect(bibliography.indexOf('"a":')).toBeLessThan(bibliography.indexOf('"b":'));
    expect(bibliography.match(/^"a":/gm)).toHaveLength(1);
    expect(bibliography.match(/^"b":/gm)).toHaveLength(1);
    expect(bibliography).not.toContain("unused");
  });

  it("preserves A B A citation calls for both templates", () => {
    for (const templateId of ["ieee", "elsevier"] as const) {
      const project = renderTypstProject({ ast, references, templateId });
      expect(project.main.match(/#cite\(label\("[^"]+"\)\)/g)).toEqual([
        '#cite(label("a"))', '#cite(label("b"))', '#cite(label("a"))',
      ]);
    }
  });

  it("omits bibliography output for citation-free input", () => {
    for (const templateId of ["ieee", "elsevier"] as const) {
      const project = renderTypstProject({
        ast: { type: "doc", content: [] },
        references,
        templateId,
      });
      expect(project).not.toHaveProperty("bibliography");
      expect(project.main).not.toContain("#bibliography(");
    }
  });

  it("rejects missing references for both templates", () => {
    for (const templateId of ["ieee", "elsevier"] as const) {
      expect(() => renderTypstProject({ ast, references: [], templateId })).toThrow(
        AstValidationError,
      );
    }
  });

  it("is deterministic and does not mutate input", () => {
    const input = {
      ast: structuredClone(ast),
      references: structuredClone(references),
      templateId: "elsevier" as const,
    };
    const before = structuredClone(input);
    expect(renderTypstProject(input)).toEqual(renderTypstProject(input));
    expect(input).toEqual(before);
  });
});
