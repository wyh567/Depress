import { parseDoc, type Doc } from "@depress/ast";
import {
  GBT7714_TEMPLATE,
  GBT7714_TEMPLATE_PLACEHOLDERS,
} from "@depress/templates";
import { AstValidationError, docToTypst, escapeTypst } from "./ast-to-typst";
import { TYPST_BIBLIOGRAPHY_FILE } from "./typst-compile-project";

const FALLBACK_TITLE = "DePress Draft";

type Gbt7714Placeholder = keyof typeof GBT7714_TEMPLATE_PLACEHOLDERS;

export function renderGbt7714TypstDocument(input: unknown): string {
  const parsed = parseDoc(input);
  if (!parsed.success) {
    throw new AstValidationError(parsed.error.issues);
  }

  return renderValidatedGbt7714TypstDocument(parsed.data, false);
}

export function renderValidatedGbt7714TypstDocument(
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
    .join("，");
  const affiliations = (metadata?.affiliations ?? [])
    .map((affiliation, index) => `#super[${index + 1}] ${escapeTypst(affiliation.name)}`)
    .join("\n");
  const abstract = metadata?.abstract
    ? `#strong[摘要]\n\n${escapeTypst(metadata.abstract)}`
    : "";
  const keywords = metadata?.keywords?.length
    ? `#strong[关键词]\n\n${metadata.keywords.map(escapeTypst).join("；")}`
    : "";
  const bibliography = withBibliography
    ? `#bibliography(\n  "${TYPST_BIBLIOGRAPHY_FILE}",\n  title: [参考文献],\n  style: "gb-7714-2015-numeric",\n)`
    : "";
  const replacements: Record<Gbt7714Placeholder, string> = {
    title: escapeTypst(metadata?.title ?? FALLBACK_TITLE),
    authors,
    affiliations,
    abstract,
    keywords,
    body: docToTypst(doc),
    bibliography,
  };

  return GBT7714_TEMPLATE.replace(
    /{{(TITLE|AUTHORS|AFFILIATIONS|ABSTRACT|KEYWORDS|BODY|BIBLIOGRAPHY)}}/g,
    (_match, name: string) =>
      replacements[name.toLowerCase() as Gbt7714Placeholder],
  );
}
