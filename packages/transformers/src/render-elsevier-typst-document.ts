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
  const authors = (metadata?.authors ?? [])
    .map((author) => {
      const numbers = (author.affiliationIds ?? []).map(
        (id) => affiliationNumberById.get(id)!,
      );
      const markers = numbers.length > 0 ? `#super[${numbers.join(", ")}]` : "";
      return `${escapeTypst(author.name)}${markers}`;
    })
    .join(", ");
  const affiliations = (metadata?.affiliations ?? [])
    .map((affiliation, index) => `#super[${index + 1}] ${escapeTypst(affiliation.name)}`)
    .join("\n");
  const abstract = metadata?.abstract
    ? `#strong[Abstract]\n\n${escapeTypst(metadata.abstract)}`
    : "";
  const keywords = metadata?.keywords?.length
    ? `#strong[Keywords]\n\n${metadata.keywords.map(escapeTypst).join(", ")}`
    : "";
  const bibliography = withBibliography
    ? `#bibliography("${TYPST_BIBLIOGRAPHY_FILE}", title: [References], style: "elsevier-harvard")`
    : "";
  const replacements: Record<ElsevierPlaceholder, string> = {
    title: escapeTypst(metadata?.title ?? FALLBACK_TITLE),
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