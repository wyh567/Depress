// IEEE journal template — code-reviewed immutable asset (architecture.md §5.4).
// All presentation (page, columns, fonts, sizes, margins, heading style) is
// hardcoded here; user AST supplies content only (Invariant #1). The template
// exposes semantic content injection points only and no presentation-layer
// parameters of any kind.
//
// Kept as a TS string constant (not a runtime-read .typ file) so the package
// stays I/O-free and bundler-agnostic.
// TODO(compile-worker): the sandbox/compile worker stage owns writing this
// out as a .typ file (or piping it to the Typst CLI equivalently); do not
// introduce runtime I/O here before then.

export const IEEE_TEMPLATE_PLACEHOLDERS = Object.freeze({
  title: "{{TITLE}}",
  authors: "{{AUTHORS}}",
  affiliations: "{{AFFILIATIONS}}",
  abstract: "{{ABSTRACT}}",
  keywords: "{{KEYWORDS}}",
  body: "{{BODY}}",
  bibliography: "{{BIBLIOGRAPHY}}",
});

export const IEEE_TEMPLATE = `// DePress IEEE template (immutable asset — never user-editable)
#set page(
  paper: "us-letter",
  margin: (x: 0.75in, top: 0.75in, bottom: 1in),
  columns: 2,
  numbering: "1",
  number-align: center,
)
#set columns(gutter: 0.2in)
#set text(font: "Times New Roman", size: 10pt)
#set par(justify: true, first-line-indent: 1em, leading: 0.65em)
#set heading(numbering: "I.A.1)")
#show heading.where(level: 1): set align(center)
#show heading.where(level: 1): set text(size: 10pt, weight: "regular")
#show heading.where(level: 1): upper

#place(
  top + center,
  float: true,
  scope: "parent",
  clearance: 1.25em,
)[
  #set align(center)
  #set par(first-line-indent: 0em, leading: 0.55em)
  #text(size: 18pt)[{{TITLE}}]
  {{AUTHORS}}
  {{AFFILIATIONS}}
]

#place(
  top,
  float: true,
  scope: "parent",
  clearance: 1em,
)[
  #set par(first-line-indent: 0em, justify: true, leading: 0.55em)
  #text(size: 9pt)[
    {{ABSTRACT}}
    {{KEYWORDS}}
  ]
]

{{BODY}}

{{BIBLIOGRAPHY}}
`;
