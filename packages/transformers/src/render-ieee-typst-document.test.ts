import { describe, expect, it } from "vitest";
import { AstValidationError } from "./ast-to-typst";
import { renderIeeeTypstDocument } from "./render-ieee-typst-document";

const smallPaper = {
  type: "doc",
  content: [
    { type: "heading", level: 1, content: [{ type: "text", text: "Introduction" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Structured editing is " },
        { type: "text", text: "essential", marks: ["bold"] },
        { type: "text", text: " for " },
        { type: "text", text: "reproducible", marks: ["italic"] },
        { type: "text", text: " publishing " },
        { type: "citation", citeKey: "smith2024" },
        { type: "text", text: "." },
      ],
    },
    { type: "heading", level: 2, content: [{ type: "text", text: "Prior Work" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See also " },
        { type: "citation", citeKey: "doe-2023" },
        { type: "text", text: " for a survey." },
      ],
    },
  ],
};

describe("renderIeeeTypstDocument", () => {
  it("renders a small paper into the IEEE template (snapshot)", () => {
    expect(renderIeeeTypstDocument(smallPaper)).toMatchSnapshot();
  });

  it("injects heading/paragraph/bold/italic/citation content into the body", () => {
    const out = renderIeeeTypstDocument(smallPaper);
    expect(out).toContain("= Introduction");
    expect(out).toContain("== Prior Work");
    expect(out).toContain("*essential*");
    expect(out).toContain("_reproducible_");
    expect(out).toContain("Structured editing is");
  });

  it("keeps citations as #cite(label(...)), never rendered text", () => {
    const out = renderIeeeTypstDocument(smallPaper);
    expect(out).toContain('#cite(label("smith2024"))');
    expect(out).toContain('#cite(label("doe-2023"))');
    expect(out).not.toMatch(/\[1\]/);
    expect(out).not.toMatch(/smith,?\s+2024/i);
  });

  it("contains the fixed IEEE style directives from the template", () => {
    const out = renderIeeeTypstDocument(smallPaper);
    expect(out).toContain("columns: 2");
    expect(out).toContain('font: "Times New Roman", size: 10pt');
    expect(out).toContain("margin: (x: 0.62in, top: 0.75in, bottom: 1in)");
    expect(out).toContain('#set heading(numbering: "I.A.1)")');
    // No metadata → backward-compatible fallback title.
    expect(out).toContain("DePress Draft");
    // No injection placeholders survive.
    expect(out).not.toContain("{{TITLE}}");
    expect(out).not.toContain("{{BODY}}");
  });

  it("uses metadata.title when present and escapes Typst specials", () => {
    const out = renderIeeeTypstDocument({
      type: "doc",
      metadata: { title: "A $Study$ of #Cite" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    });
    expect(out).toContain("A \\$Study\\$ of \\#Cite");
    expect(out).not.toContain("DePress Draft");
    expect(out).toContain("Body");
  });

  it("preserves authors/affiliations/abstract/keywords in AST without rendering them yet", () => {
    // TODO #1 stores front-matter in AST; full IEEE author block layout is
    // deferred. Title is the only metadata field injected into Typst now.
    const doc = {
      type: "doc",
      metadata: {
        title: "Real Title",
        authors: [{ name: "Ada", affiliationIds: ["a1"] }],
        affiliations: [{ id: "a1", name: "Lab" }],
        abstract: "An abstract.",
        keywords: ["AST", "Typst"],
      },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    };
    const out = renderIeeeTypstDocument(doc);
    expect(out).toContain("Real Title");
    expect(out).not.toContain("An abstract.");
    expect(out).not.toContain("Ada");
  });

  it("does not expose any user-controllable style parameters", () => {
    // Content is the only argument; there is no template/style/options input.
    expect(renderIeeeTypstDocument.length).toBe(1);
  });

  it("rejects invalid AST via @depress/ast", () => {
    expect(() =>
      renderIeeeTypstDocument({
        type: "doc",
        content: [{ type: "heading", level: 4, content: [] }],
      }),
    ).toThrow(AstValidationError);
    expect(() =>
      renderIeeeTypstDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "citation" }] }],
      }),
    ).toThrow(AstValidationError);
    expect(() => renderIeeeTypstDocument(null)).toThrow(AstValidationError);
  });

  it("does not let user text break out of the body injection point", () => {
    const out = renderIeeeTypstDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "evil $& #set text(size: 40pt)" }],
        },
      ],
    });
    // Typst-special chars are escaped; replace() substitution patterns inert.
    expect(out).toContain("\\#set text(size: 40pt)");
    expect(out).toContain("evil \\$& \\#set");
  });
});
