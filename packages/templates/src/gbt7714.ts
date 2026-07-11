// DePress GB/T 7714-2015 numeric manuscript template using Typst 0.15 built-in style.
// Presentation is fixed here; callers can inject only semantic manuscript fields.

export const GBT7714_TEMPLATE_PLACEHOLDERS = Object.freeze({
  title: "{{TITLE}}",
  authors: "{{AUTHORS}}",
  affiliations: "{{AFFILIATIONS}}",
  abstract: "{{ABSTRACT}}",
  keywords: "{{KEYWORDS}}",
  body: "{{BODY}}",
  bibliography: "{{BIBLIOGRAPHY}}",
});

export const GBT7714_TEMPLATE = `// DePress GB/T 7714-2015 numeric manuscript template -- immutable asset
#set page(
  paper: "a4",
  margin: (x: 22mm, top: 20mm, bottom: 22mm),
  columns: 1,
)
#set text(font: ("Libertinus Serif", "Noto Sans CJK SC"), size: 10.5pt)
#set par(justify: true, leading: 0.65em)
#set heading(numbering: "1.1")
#show heading.where(level: 1): set text(size: 14pt, weight: "bold")
#show heading.where(level: 2): set text(size: 12pt, weight: "bold")

#align(center)[
  #text(size: 22pt)[{{TITLE}}]

  {{AUTHORS}}

  #text(size: 9pt)[{{AFFILIATIONS}}]
]

{{ABSTRACT}}

{{KEYWORDS}}

{{BODY}}

{{BIBLIOGRAPHY}}
`;
