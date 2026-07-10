import { describe, expect, it } from "vitest";
import { AstValidationError } from "./ast-to-typst";
import {
  renderIeeeTypstProject,
  TYPST_BIBLIOGRAPHY_FILE,
  type TypstCompileProject,
} from "./render-ieee-typst-project";

const ast = {
  type: "doc" as const,
  metadata: { title: "Deterministic IEEE Citations" },
  content: [
    {
      type: "paragraph" as const,
      content: [
        { type: "text" as const, text: "A " },
        { type: "citation" as const, citeKey: "a" },
        { type: "text" as const, text: ", B " },
        { type: "citation" as const, citeKey: "b" },
        { type: "text" as const, text: ", A again " },
        { type: "citation" as const, citeKey: "a" },
        { type: "text" as const, text: "." },
      ],
    },
  ],
};

const references = [
  { id: "unused", type: "document" as const, title: "Unused" },
  { id: "b", type: "book" as const, title: "Work B" },
  { id: "a", type: "article-journal" as const, title: "Work A" },
];

describe("renderIeeeTypstProject", () => {
  it("renders immutable IEEE main source plus a fixed bibliography sidecar (snapshot)", () => {
    expect(renderIeeeTypstProject({ ast, references })).toMatchSnapshot();
  });

  it("keeps A B A citation calls and serializes bibliography entries as A B", () => {
    const project = renderIeeeTypstProject({ ast, references });
    const citationCalls = project.main.match(/#cite\(label\("[^"]+"\)\)/g);
    expect(citationCalls).toEqual([
      '#cite(label("a"))',
      '#cite(label("b"))',
      '#cite(label("a"))',
    ]);
    expect(project.bibliography).toBeDefined();
    const bibliography = project.bibliography ?? "";
    expect(bibliography.indexOf('"a":')).toBeLessThan(
      bibliography.indexOf('"b":'),
    );
    expect(bibliography).not.toContain("unused");
  });

  it("mounts the IEEE bibliography exactly once with a fixed path and style", () => {
    const project = renderIeeeTypstProject({ ast, references });
    expect(TYPST_BIBLIOGRAPHY_FILE).toBe("references.yml");
    expect(project.main.match(/#bibliography\(/g)).toHaveLength(1);
    expect(project.main).toContain(
      '#bibliography("references.yml", title: [References], style: "ieee")',
    );
  });

  it("omits the sidecar and bibliography mount for a citation-free document", () => {
    const project = renderIeeeTypstProject({
      ast: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "No cites" }] },
        ],
      },
      references: [{ id: "unused", type: "book", title: "Unused" }],
    });
    expect(project).not.toHaveProperty("bibliography");
    expect(project.main).not.toContain("#bibliography(");
    expect(project.main).not.toContain("References");
  });

  it("preserves metadata title and legacy fallback behavior", () => {
    expect(renderIeeeTypstProject({ ast, references }).main).toContain(
      "Deterministic IEEE Citations",
    );
    expect(
      renderIeeeTypstProject({
        ast: { type: "doc", content: [] },
        references: [],
      }).main,
    ).toContain("DePress Draft");
  });

  it("rejects missing references through the shared compile contract", () => {
    expect(() => renderIeeeTypstProject({ ast, references: [] })).toThrow(
      AstValidationError,
    );
  });

  it("uses canonical citeKeys directly, including punctuation and Unicode", () => {
    const keys = [
      "zhang-2025",
      "paper_01",
      "中文文献",
      "key.with.dots",
      "key/with/slash",
      'key"quote',
    ];
    const project = renderIeeeTypstProject({
      ast: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: keys.map((citeKey) => ({ type: "citation" as const, citeKey })),
          },
        ],
      },
      references: keys.map((id) => ({ id, type: "document", title: id })),
    });
    for (const key of keys) {
      const typstKey = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      expect(project.main).toContain(`#cite(label("${typstKey}"))`);
      expect(project.bibliography).toContain(`${JSON.stringify(key)}:`);
    }
  });

  it("is deterministic and does not mutate compile input", () => {
    const input = { ast: structuredClone(ast), references: structuredClone(references) };
    const before = structuredClone(input);
    const first: TypstCompileProject = renderIeeeTypstProject(input);
    const second = renderIeeeTypstProject(input);
    expect(second).toEqual(first);
    expect(input).toEqual(before);
  });
});
