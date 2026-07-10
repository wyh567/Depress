import { CslItemSchema, type CslAuthor, type CslItem, type CslItemType } from "@depress/ast";
import type { CrossrefWorkMessage } from "./provider-schema";

// Pure Crossref work → CslItem mapper. No network, no mutation, no randomness.

export type CrossrefMapResult =
  | { ok: true; item: CslItem }
  | { ok: false; error: "INVALID_CROSSREF_METADATA" };

const TYPE_MAP: Record<string, CslItemType> = {
  "journal-article": "article-journal",
  book: "book",
  monograph: "book",
  "reference-book": "book",
  "book-chapter": "chapter",
  "proceedings-article": "paper-conference",
  dissertation: "thesis",
  // Crossref posted-content is typically preprint/eprint, not a web page.
  // Prefer CSL "document" (Hayagriva Misc) over "webpage" (Hayagriva Web).
  "posted-content": "document",
  report: "document",
};

function firstNonEmptyString(values: readonly string[] | undefined): string | undefined {
  if (!values) return undefined;
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function asOptionalString(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function mapType(crossrefType: string | undefined): CslItemType {
  if (!crossrefType) return "document";
  return TYPE_MAP[crossrefType] ?? "document";
}

function mapAuthors(
  authors: CrossrefWorkMessage["author"],
): CslAuthor[] | undefined {
  if (!authors || authors.length === 0) return undefined;
  const mapped: CslAuthor[] = [];
  for (const author of authors) {
    const family = author.family?.trim();
    const given = author.given?.trim();
    const literal = author.name?.trim();
    if (family) {
      mapped.push({
        family,
        ...(given ? { given } : {}),
      });
      continue;
    }
    if (literal) {
      mapped.push({ literal });
    }
    // Skip given-only / empty records — CslAuthor requires family or literal.
  }
  return mapped.length > 0 ? mapped : undefined;
}

function pickIssued(
  work: CrossrefWorkMessage,
): { "date-parts": number[][] } | undefined {
  // Deterministic precedence: print → online → published → issued.
  const candidates = [
    work["published-print"],
    work["published-online"],
    work.published,
    work.issued,
  ] as const;
  for (const candidate of candidates) {
    const parts = candidate?.["date-parts"];
    if (!parts || parts.length === 0) continue;
    const first = parts[0];
    if (!first || first.length === 0) continue;
    if (!Number.isInteger(first[0])) continue;
    return { "date-parts": parts.map((row) => [...row]) };
  }
  return undefined;
}

export function crossrefWorkToCslItem(
  work: CrossrefWorkMessage,
  normalizedDoi: string,
): CrossrefMapResult {
  const title = firstNonEmptyString(work.title);
  if (!title) {
    return { ok: false, error: "INVALID_CROSSREF_METADATA" };
  }

  const candidate: CslItem = {
    id: normalizedDoi,
    type: mapType(work.type),
    title,
    DOI: normalizedDoi,
  };

  const authors = mapAuthors(work.author);
  if (authors) candidate.author = authors;

  const issued = pickIssued(work);
  if (issued) candidate.issued = issued;

  const containerTitle = firstNonEmptyString(work["container-title"]);
  if (containerTitle) candidate["container-title"] = containerTitle;

  const volume = asOptionalString(work.volume);
  if (volume) candidate.volume = volume;

  const issue = asOptionalString(work.issue);
  if (issue) candidate.issue = issue;

  const page = asOptionalString(work.page);
  if (page) candidate.page = page;

  const publisher = asOptionalString(work.publisher);
  if (publisher) candidate.publisher = publisher;

  const url = asOptionalString(work.URL);
  if (url) candidate.URL = url;

  const parsed = CslItemSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: "INVALID_CROSSREF_METADATA" };
  }
  return { ok: true, item: parsed.data };
}
