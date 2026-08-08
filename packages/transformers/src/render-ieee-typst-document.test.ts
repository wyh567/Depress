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
    expect(out).toContain("margin: (x: 0.75in, top: 0.75in, bottom: 1in)");
    expect(out).toContain('numbering: "1"');
    expect(out).toContain('#set heading(numbering: "I.A.1)")');
    expect(out).toContain("#text(size: 18pt)[DePress Draft]");
    // No metadata → backward-compatible fallback title.
    expect(out).toContain("DePress Draft");
    // No injection placeholders survive.
    expect(out).not.toContain("{{TITLE}}");
    expect(out).not.toContain("{{AUTHORS}}");
    expect(out).not.toContain("{{AFFILIATIONS}}");
    expect(out).not.toContain("{{ABSTRACT}}");
    expect(out).not.toContain("{{KEYWORDS}}");
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

  it("renders ordered authors, affiliations, abstract, and index terms", () => {
    const doc = {
      type: "doc",
      metadata: {
        title: "Real Title",
        authors: [
          { name: "Ada Lovelace", affiliationIds: ["a1"] },
          { name: "李华", affiliationIds: ["a1", "a2"] },
          { name: "Independent Author" },
        ],
        affiliations: [
          { id: "a1", name: "Lab" },
          { id: "a2", name: "数字出版研究中心" },
        ],
        abstract: 'Costs $5, uses "quotes", and Unicode 王伟。',
        keywords: ["AST", "Typst", "中文"],
      },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    };
    const out = renderIeeeTypstDocument(doc);
    expect(out).toContain("Real Title");
    expect(out.indexOf("Ada Lovelace")).toBeLessThan(out.indexOf("李华"));
    expect(out).toContain("Ada Lovelace#super[1]");
    expect(out).toContain("李华#super[1, 2]");
    expect(out).toContain("#super[1] Lab");
    expect(out).toContain("#super[2] 数字出版研究中心");
    expect(out).toContain(
      "*Abstract*—_Costs \\$5, uses \"quotes\", and Unicode 王伟。_",
    );
    expect(out).toContain("*Index Terms*—AST, Typst, 中文");
    expect(out).toContain(" \\\n");
    expect(out).not.toContain("a1");
    expect(out).not.toContain("a2");
  });

  it("prefers English metadata fields for IEEE front matter", () => {
    const out = renderIeeeTypstDocument({
      type: "doc",
      metadata: {
        title: "中文标题",
        titleEn: "English Title",
        authors: [
          { name: "王伟", nameEn: "WANG Wei", affiliationIds: ["a1"] },
        ],
        affiliations: [
          { id: "a1", name: "计算机学院", nameEn: "School of CS" },
        ],
        abstract: "中文摘要",
        abstractEn: "English abstract",
        keywords: ["中文"],
        keywordsEn: ["AST", "Typst"],
      },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    });
    expect(out).toContain("English Title");
    expect(out).not.toContain("中文标题");
    expect(out).toContain("WANG Wei#super[1]");
    expect(out).toContain("#super[1] School of CS");
    expect(out).toContain("*Abstract*—_English abstract_");
    expect(out).toContain("*Index Terms*—AST, Typst");
  });

  it("omits abstract and index terms when metadata fields are absent", () => {
    const out = renderIeeeTypstDocument({
      type: "doc",
      metadata: {
        title: "Title Only",
        authors: [{ name: "Ada" }],
      },
      content: [],
    });
    expect(out).toContain("Ada");
    expect(out).not.toContain("*Abstract*—");
    expect(out).not.toContain("*Index Terms*—");
    expect(out).not.toContain("#super[");
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
