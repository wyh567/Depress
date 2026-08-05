import { parseDoc, type Doc } from "@depress/ast";
import { IEEE_TEMPLATE, IEEE_TEMPLATE_PLACEHOLDERS } from "@depress/templates";
import { AstValidationError, docToTypst, escapeTypst } from "./ast-to-typst";
import { TYPST_BIBLIOGRAPHY_FILE } from "./typst-compile-project";

// Fallback only for backward-compatible docs that omit metadata.title
// (Phase 1/2 fixtures). Never a caller-supplied compile parameter —
// AST remains the single content source of truth (Invariant #3).
const FALLBACK_TITLE = "DePress Draft";

type IeeePlaceholder = keyof typeof IEEE_TEMPLATE_PLACEHOLDERS;

// Injects the validated AST into the built-in IEEE template
// (architecture.md §3 step 2). Takes content only — no template, style, or
// presentation parameters are accepted (Invariant #1; templates are
// immutable code-reviewed assets, §5.4).
export function renderIeeeTypstDocument(input: unknown): string {
  const parsed = parseDoc(input);
  if (!parsed.success) {
    throw new AstValidationError(parsed.error.issues);
  }

  return renderValidatedIeeeTypstDocument(parsed.data, false);
}

// Package-internal template renderer. The bibliography mount is a boolean,
// not caller-supplied Typst, and expands to one immutable directive.
export function renderValidatedIeeeTypstDocument(
  doc: Doc,
  withBibliography: boolean,
): string {
  const metadata = doc.metadata;
  const affiliationNumberById = new Map(
    (metadata?.affiliations ?? []).map((affiliation, index) => [
      affiliation.id,
      index + 1,
    ]),
  );
  // English-primary journal: prefer English display fields when present.
  const authorNames = (metadata?.authors ?? [])
    .map((author) => {
      const displayName = author.nameEn ?? author.name;
      const numbers = (author.affiliationIds ?? [])
        .map((id) => affiliationNumberById.get(id))
        .filter((n): n is number => n !== undefined);
      const markers = numbers.length > 0 ? `#super[${numbers.join(", ")}]` : "";
      return `${escapeTypst(displayName)}${markers}`;
    })
    .join(", ");
  const authors =
    authorNames.length > 0
      ? `\n  #v(0.4em)\n  #text(size: 10pt)[${authorNames}]`
      : "";
  const affiliationLines = (metadata?.affiliations ?? []).map(
    (affiliation, index) => {
      const displayName = affiliation.nameEn ?? affiliation.name;
      return `#super[${index + 1}] ${escapeTypst(displayName)}`;
    },
  );
  const affiliations =
    affiliationLines.length > 0
      ? `\n  #v(0.25em)\n  #text(size: 8pt)[${affiliationLines.join(" \\\n")}]`
      : "";
  const abstractText = metadata?.abstractEn ?? metadata?.abstract;
  const abstract = abstractText
    ? `*Abstract*—_${escapeTypst(abstractText)}_\n\n`
    : "";
  const keywordList = metadata?.keywordsEn ?? metadata?.keywords;
  const keywords = keywordList?.length
    ? `*Index Terms*—${keywordList.map(escapeTypst).join(", ")}\n`
    : "";
  const bibliography = withBibliography
    ? `#bibliography("${TYPST_BIBLIOGRAPHY_FILE}", title: [References], style: "ieee")`
    : "";
  const replacements: Record<IeeePlaceholder, string> = {
    title: escapeTypst(metadata?.titleEn ?? metadata?.title ?? FALLBACK_TITLE),
    authors,
    affiliations,
    abstract,
    keywords,
    body: docToTypst(doc),
    bibliography,
  };

  return IEEE_TEMPLATE.replace(
    /{{(TITLE|AUTHORS|AFFILIATIONS|ABSTRACT|KEYWORDS|BODY|BIBLIOGRAPHY)}}/g,
    (_match, name: string) =>
      replacements[name.toLowerCase() as IeeePlaceholder],
  );
}
