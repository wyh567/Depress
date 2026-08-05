// DePress GB/T 7714-2015 numeric manuscript template using Typst 0.15 built-in style.
// Presentation is fixed here; callers can inject only semantic manuscript fields.
// Chinese front matter first; optional English block follows when provided.

export const GBT7714_TEMPLATE_PLACEHOLDERS = Object.freeze({
  title: "{{TITLE}}",
  authors: "{{AUTHORS}}",
  affiliations: "{{AFFILIATIONS}}",
  abstract: "{{ABSTRACT}}",
  keywords: "{{KEYWORDS}}",
  titleEn: "{{TITLE_EN}}",
  authorsEn: "{{AUTHORS_EN}}",
  affiliationsEn: "{{AFFILIATIONS_EN}}",
  abstractEn: "{{ABSTRACT_EN}}",
  keywordsEn: "{{KEYWORDS_EN}}",
  body: "{{BODY}}",
  bibliography: "{{BIBLIOGRAPHY}}",
});

export const GBT7714_TEMPLATE = `// DePress GB/T 7714-2015 numeric manuscript template -- immutable asset
#set page(
  paper: "a4",
  margin: (x: 25mm, top: 25mm, bottom: 25mm),
  columns: 1,
  numbering: "1",
  number-align: center,
)
#set text(font: ("Libertinus Serif", "Noto Sans CJK SC"), size: 10.5pt)
#set par(justify: true, leading: 0.85em, first-line-indent: 2em)
#set heading(numbering: "1.1")
#show heading.where(level: 1): set text(size: 12pt, weight: "bold")
#show heading.where(level: 2): set text(size: 11pt, weight: "bold")

#align(center)[
  #set par(first-line-indent: 0em, leading: 0.7em)
  #text(size: 16pt, weight: "bold")[{{TITLE}}]
  {{AUTHORS}}
  {{AFFILIATIONS}}
]

#set par(first-line-indent: 0em)
{{ABSTRACT}}

{{KEYWORDS}}

#align(center)[
  #set par(first-line-indent: 0em, leading: 0.7em)
  {{TITLE_EN}}
  {{AUTHORS_EN}}
  {{AFFILIATIONS_EN}}
]

{{ABSTRACT_EN}}

{{KEYWORDS_EN}}

#set par(first-line-indent: 2em)
{{BODY}}

{{BIBLIOGRAPHY}}
`;
