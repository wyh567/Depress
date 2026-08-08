import { parseDoc, type Doc, type DocMetadata } from "@depress/ast";
import {
  GBT7714_TEMPLATE,
  GBT7714_TEMPLATE_PLACEHOLDERS,
} from "@depress/templates";
import { AstValidationError, docToTypst, escapeTypst } from "./ast-to-typst";
import { TYPST_BIBLIOGRAPHY_FILE } from "./typst-compile-project";

const FALLBACK_TITLE = "DePress Draft";

type Gbt7714Placeholder = keyof typeof GBT7714_TEMPLATE_PLACEHOLDERS;

function affiliationNumberById(metadata: DocMetadata | undefined) {
  return new Map(
    (metadata?.affiliations ?? []).map((affiliation, index) => [
      affiliation.id,
      index + 1,
    ]),
  );
}

function renderAuthorLine(
  metadata: DocMetadata | undefined,
  preferEnglish: boolean,
  numberJoiner: string,
  nameJoiner: string,
): string {
  const numbersById = affiliationNumberById(metadata);
  return (metadata?.authors ?? [])
    .map((author) => {
      const displayName = preferEnglish
        ? (author.nameEn ?? author.name)
        : author.name;
      const numbers = (author.affiliationIds ?? [])
        .map((id) => numbersById.get(id))
        .filter((n): n is number => n !== undefined);
      const markers =
        numbers.length > 0 ? `#super[${numbers.join(numberJoiner)}]` : "";
      return `${escapeTypst(displayName)}${markers}`;
    })
    .join(nameJoiner);
}

function renderAffiliationLines(
  metadata: DocMetadata | undefined,
  preferEnglish: boolean,
): string[] {
  return (metadata?.affiliations ?? []).map((affiliation, index) => {
    const displayName = preferEnglish
      ? (affiliation.nameEn ?? affiliation.name)
      : affiliation.name;
    return `#super[${index + 1}]${escapeTypst(displayName)}`;
  });
}

function hasEnglishFrontMatter(metadata: DocMetadata | undefined): boolean {
  if (!metadata) return false;
  return Boolean(
    metadata.titleEn ||
      metadata.abstractEn ||
      (metadata.keywordsEn && metadata.keywordsEn.length > 0) ||
      metadata.authors?.some((author) => author.nameEn) ||
      metadata.affiliations?.some((affiliation) => affiliation.nameEn),
  );
}

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
  const authorNames = renderAuthorLine(metadata, false, "，", "，");
  const authors =
    authorNames.length > 0
      ? `\n  #v(0.45em)\n  #text(size: 12pt)[${authorNames}]`
      : "";
  const affiliationLines = renderAffiliationLines(metadata, false);
  const affiliations =
    affiliationLines.length > 0
      ? `\n  #v(0.3em)\n  #text(size: 9pt)[${affiliationLines.join(" \\\n")}]`
      : "";
  const abstract = metadata?.abstract
    ? `#par(first-line-indent: 0em)[#strong[摘要：]#h(0.5em)${escapeTypst(metadata.abstract)}]\n\n`
    : "";
  const keywords = metadata?.keywords?.length
    ? `#par(first-line-indent: 0em)[#strong[关键词：]#h(0.5em)${metadata.keywords.map(escapeTypst).join("；")}]\n\n`
    : "";

  const showEnglish = hasEnglishFrontMatter(metadata);
  const titleEn = showEnglish
    ? metadata?.titleEn
      ? `#text(size: 14pt, weight: "bold")[${escapeTypst(metadata.titleEn)}]`
      : ""
    : "";
  const authorNamesEn = showEnglish
    ? renderAuthorLine(metadata, true, ", ", ", ")
    : "";
  const authorsEn =
    showEnglish && authorNamesEn.length > 0
      ? `\n  #v(0.45em)\n  #text(size: 11pt)[${authorNamesEn}]`
      : "";
  const affiliationLinesEn = showEnglish
    ? renderAffiliationLines(metadata, true)
    : [];
  const affiliationsEn =
    affiliationLinesEn.length > 0
      ? `\n  #v(0.3em)\n  #text(size: 9pt)[${affiliationLinesEn.join(" \\\n")}]`
      : "";
  const abstractEn =
    showEnglish && metadata?.abstractEn
      ? `#par(first-line-indent: 0em)[#strong[Abstract:]#h(0.5em)${escapeTypst(metadata.abstractEn)}]\n\n`
      : "";
  const keywordsEn =
    showEnglish && metadata?.keywordsEn?.length
      ? `#par(first-line-indent: 0em)[#strong[Key words:]#h(0.5em)${metadata.keywordsEn.map(escapeTypst).join("; ")}]\n\n`
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
    titleEn,
    authorsEn,
    affiliationsEn,
    abstractEn,
    keywordsEn,
    body: docToTypst(doc),
    bibliography,
  };

  return GBT7714_TEMPLATE.replace(
    /{{(TITLE_EN|AUTHORS_EN|AFFILIATIONS_EN|ABSTRACT_EN|KEYWORDS_EN|TITLE|AUTHORS|AFFILIATIONS|ABSTRACT|KEYWORDS|BODY|BIBLIOGRAPHY)}}/g,
    (_match, name: string) => {
      const key = name
        .toLowerCase()
        .replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase()) as Gbt7714Placeholder;
      return replacements[key];
    },
  );
}
