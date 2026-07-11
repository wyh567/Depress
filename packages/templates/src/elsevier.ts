// DePress Elsevier author-date manuscript template -- immutable code-reviewed asset.
// Presentation is fixed here; callers can inject only semantic manuscript fields.

export const ELSEVIER_TEMPLATE_PLACEHOLDERS = Object.freeze({
  title: "{{TITLE}}",
  authors: "{{AUTHORS}}",
  affiliations: "{{AFFILIATIONS}}",
  abstract: "{{ABSTRACT}}",
  keywords: "{{KEYWORDS}}",
  body: "{{BODY}}",
  bibliography: "{{BIBLIOGRAPHY}}",
});

export const ELSEVIER_TEMPLATE = `// DePress Elsevier author-date manuscript template (immutable asset -- never user-editable)
#set page(
  paper: "us-letter",
  margin: (x: 0.9in, top: 0.8in, bottom: 0.9in),
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