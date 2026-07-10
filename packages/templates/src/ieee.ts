// IEEE journal template — code-reviewed immutable asset (architecture.md §5.4).
// All presentation (page, columns, fonts, sizes, margins, heading style) is
// hardcoded here; user AST supplies content only (Invariant #1). The template
// exposes exactly two content injection points ({{TITLE}}, {{BODY}}) and no
// presentation-layer parameters of any kind.
//
// Kept as a TS string constant (not a runtime-read .typ file) so the package
// stays I/O-free and bundler-agnostic.
// TODO(compile-worker): the sandbox/compile worker stage owns writing this
// out as a .typ file (or piping it to the Typst CLI equivalently); do not
// introduce runtime I/O here before then.

export const IEEE_TEMPLATE_PLACEHOLDERS = Object.freeze({
  title: "{{TITLE}}",
  body: "{{BODY}}",
  bibliography: "{{BIBLIOGRAPHY}}",
});

export const IEEE_TEMPLATE = `// DePress IEEE template (immutable asset — never user-editable)
#set page(
  paper: "us-letter",
  margin: (x: 0.62in, top: 0.75in, bottom: 1in),
  columns: 2,
)
#set columns(gutter: 0.2in)
#set text(font: "Times New Roman", size: 10pt)
#set par(justify: true, first-line-indent: 1em)
#set heading(numbering: "I.A.1)")
#show heading.where(level: 1): set align(center)
#show heading.where(level: 1): set text(size: 10pt, weight: "regular")
#show heading.where(level: 1): upper

#place(
  top + center,
  float: true,
  scope: "parent",
  clearance: 2em,
)[
  #set align(center)
  #text(size: 24pt)[{{TITLE}}]
]

{{BODY}}

{{BIBLIOGRAPHY}}
`;
