import { describe, expect, it } from "vitest";
import { AstValidationError, astToTypst } from "./ast-to-typst";

const text = (t: string, marks?: ("bold" | "italic")[]) => ({
  type: "text" as const,
  text: t,
  ...(marks ? { marks } : {}),
});

describe("astToTypst — headings", () => {
  it("maps heading levels 1/2/3 to =/==/===", () => {
    const out = astToTypst({
      type: "doc",
      content: [
        { type: "heading", level: 1, content: [text("Introduction")] },
        { type: "heading", level: 2, content: [text("Background")] },
        { type: "heading", level: 3, content: [text("Prior Work")] },
      ],
    });
    expect(out).toMatchSnapshot();
  });
});

describe("astToTypst — paragraphs and marks", () => {
  it("maps text, bold, italic, and bold+italic", () => {
    const out = astToTypst({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            text("Plain, "),
            text("bold", ["bold"]),
            text(", "),
            text("italic", ["italic"]),
            text(", and "),
            text("both", ["bold", "italic"]),
            text("."),
          ],
        },
      ],
    });
    expect(out).toMatchSnapshot();
  });

  it("escapes Typst special characters in text", () => {
    const out = astToTypst({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [text("50% of *raw* _text_ with #let, $x$, @ref, [brackets], a\\b, <tag>, ~, / and -")],
        },
      ],
    });
    expect(out).toMatchSnapshot();
  });
});

describe("astToTypst — citations", () => {
  it("emits #cite(label(...)) with no rendered text", () => {
    const out = astToTypst({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "citation", citeKey: "smith2024" }] },
      ],
    });
    expect(out).toBe('#cite(label("smith2024"))\n');
    // No pre-rendered forms like [1] or (Smith, 2024).
    expect(out).not.toMatch(/\[\d+\]|\(\w+,\s*\d{4}\)/);
  });

  it("handles BibTeX-style keys with special characters", () => {
    const out = astToTypst({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "citation", citeKey: "DBLP:books/lib/Knuth86a" }],
        },
      ],
    });
    expect(out).toBe('#cite(label("DBLP:books/lib/Knuth86a"))\n');
  });

  it("escapes double quotes and backslashes in citeKey", () => {
    const out = astToTypst({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "citation", citeKey: 'weird"key\\2024' }],
        },
      ],
    });
    expect(out).toBe('#cite(label("weird\\"key\\\\2024"))\n');
  });

  it("keeps mixed text + citation + text stable", () => {
    const out = astToTypst({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            text("As shown by "),
            { type: "citation", citeKey: "smith2024" },
            text(" and later confirmed "),
            { type: "citation", citeKey: "lee2025" },
            text(", the effect is robust."),
          ],
        },
      ],
    });
    expect(out).toMatchSnapshot();
  });
});

describe("astToTypst — stubs", () => {
  it("renders figure/table stubs as comments", () => {
    const out = astToTypst({
      type: "doc",
      content: [{ type: "figure" }, { type: "table" }],
    });
    expect(out).toMatchSnapshot();
  });
});

describe("astToTypst — validation", () => {
  it("rejects heading level 4", () => {
    expect(() =>
      astToTypst({
        type: "doc",
        content: [{ type: "heading", level: 4, content: [text("Too deep")] }],
      }),
    ).toThrow(AstValidationError);
  });

  it("rejects citation without citeKey", () => {
    expect(() =>
      astToTypst({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "citation" }] }],
      }),
    ).toThrow(AstValidationError);
  });

  it("rejects non-doc input", () => {
    expect(() => astToTypst({ type: "paragraph", content: [] })).toThrow(
      AstValidationError,
    );
    expect(() => astToTypst(null)).toThrow(AstValidationError);
  });
});

describe("astToTypst — full sample paper", () => {
  it("transforms a small paper", () => {
    const out = astToTypst({
      type: "doc",
      content: [
        { type: "heading", level: 1, content: [text("A Study of Structured Authoring")] },
        {
          type: "paragraph",
          content: [
            text("Decoupling content from layout improves reproducibility "),
            { type: "citation", citeKey: "knuth1984" },
            text("."),
          ],
        },
        { type: "heading", level: 2, content: [text("Methods")] },
        {
          type: "paragraph",
          content: [
            text("We evaluated "),
            text("E. coli", ["italic"]),
            text(" samples under "),
            text("strict", ["bold"]),
            text(" conditions (n=42, p<0.05) "),
            { type: "citation", citeKey: "smith2024" },
            { type: "citation", citeKey: "lee2025" },
            text("."),
          ],
        },
        { type: "figure" },
        { type: "heading", level: 2, content: [text("Results & Discussion")] },
        { type: "table" },
        {
          type: "paragraph",
          content: [text("The results confirm prior findings.")],
        },
      ],
    });
    expect(out).toMatchSnapshot();
  });
});
