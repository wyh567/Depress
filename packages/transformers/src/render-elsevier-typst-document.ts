import { parseDoc, type Doc } from "@depress/ast";
import {
  ELSEVIER_TEMPLATE,
  ELSEVIER_TEMPLATE_PLACEHOLDERS,
} from "@depress/templates";
import { AstValidationError, docToTypst, escapeTypst } from "./ast-to-typst";
import { TYPST_BIBLIOGRAPHY_FILE } from "./typst-compile-project";

const FALLBACK_TITLE = "DePress Draft";

type ElsevierPlaceholder = keyof typeof ELSEVIER_TEMPLATE_PLACEHOLDERS;

export function renderElsevierTypstDocument(input: unknown): string {
  const parsed = parseDoc(input);
  if (!parsed.success) {
    throw new AstValidationError(parsed.error.issues);
  }

  return renderValidatedElsevierTypstDocument(parsed.data, false);
}

export function renderValidatedElsevierTypstDocument(
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
  // English-primary manuscript: prefer English display fields when present.
  const authors = (metadata?.authors ?? [])
    .map((author) => {
      const displayName = author.nameEn ?? author.name;
      const numbers = (author.affiliationIds ?? [])
        .map((id) => affiliationNumberById.get(id))
        .filter((n): n is number => n !== undefined);
      const markers = numbers.length > 0 ? `#super[${numbers.join(", ")}]` : "";
      return `${escapeTypst(displayName)}${markers}`;
    })
    .join(", ");
  const affiliations = (metadata?.affiliations ?? [])
    .map((affiliation, index) => {
      const displayName = affiliation.nameEn ?? affiliation.name;
      return `#super[${index + 1}] ${escapeTypst(displayName)}`;
    })
    .join(" \\\n");
  const abstractText = metadata?.abstractEn ?? metadata?.abstract;
  const abstract = abstractText
    ? `#strong[Abstract]\n\n${escapeTypst(abstractText)}`
    : "";
  const keywordList = metadata?.keywordsEn ?? metadata?.keywords;
  const keywords = keywordList?.length
    ? `#strong[Keywords]\n\n${keywordList.map(escapeTypst).join(", ")}`
    : "";
  const bibliography = withBibliography
    ? `#bibliography("${TYPST_BIBLIOGRAPHY_FILE}", title: [References], style: "elsevier-harvard")`
    : "";
  const replacements: Record<ElsevierPlaceholder, string> = {
    title: escapeTypst(metadata?.titleEn ?? metadata?.title ?? FALLBACK_TITLE),
    authors,
    affiliations,
    abstract,
    keywords,
    body: docToTypst(doc),
    bibliography,
  };

  return ELSEVIER_TEMPLATE.replace(
    /{{(TITLE|AUTHORS|AFFILIATIONS|ABSTRACT|KEYWORDS|BODY|BIBLIOGRAPHY)}}/g,
    (_match, name: string) =>
      replacements[name.toLowerCase() as ElsevierPlaceholder],
  );
}
