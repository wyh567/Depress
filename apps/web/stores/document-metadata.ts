import { create } from "zustand";
import type { DocAffiliation, DocAuthor, DocMetadata } from "@depress/ast";

// In-memory document metadata (Phase 3 TODO #1). Persistence is Phase 4.
// Empty form → omit metadata on export (backward-compatible docs).
// Non-empty form → build a candidate object; DocSchema validates at export.

export interface DocumentMetadataDraft {
  title: string;
  titleEn: string;
  abstract: string;
  abstractEn: string;
  keywordsText: string;
  keywordsEnText: string;
  authorsText: string;
  affiliationsText: string;
}

const EMPTY: DocumentMetadataDraft = {
  title: "",
  titleEn: "",
  abstract: "",
  abstractEn: "",
  keywordsText: "",
  keywordsEnText: "",
  authorsText: "",
  affiliationsText: "",
};

interface DocumentMetadataState extends DocumentMetadataDraft {
  setField: <K extends keyof DocumentMetadataDraft>(
    key: K,
    value: DocumentMetadataDraft[K],
  ) => void;
  clear: () => void;
  hydrate: (metadata: DocMetadata | undefined) => void;
  // Builds the AST metadata candidate, or undefined when the form is empty.
  toMetadataCandidate: () => DocMetadata | undefined;
}

function formatAuthorLine(author: DocAuthor): string {
  const namePart = author.nameEn ? `${author.name} / ${author.nameEn}` : author.name;
  return author.affiliationIds?.length
    ? `${namePart} | ${author.affiliationIds.join(",")}`
    : namePart;
}

function formatAffiliationLine(affiliation: DocAffiliation): string {
  const namePart = affiliation.nameEn
    ? `${affiliation.name} / ${affiliation.nameEn}`
    : affiliation.name;
  return `${affiliation.id} | ${namePart}`;
}

export function metadataToDraft(
  metadata: DocMetadata | undefined,
): DocumentMetadataDraft {
  if (!metadata) return { ...EMPTY };
  return {
    title: metadata.title ?? "",
    titleEn: metadata.titleEn ?? "",
    abstract: metadata.abstract ?? "",
    abstractEn: metadata.abstractEn ?? "",
    keywordsText: (metadata.keywords ?? []).join(", "),
    keywordsEnText: (metadata.keywordsEn ?? []).join(", "),
    authorsText: (metadata.authors ?? []).map(formatAuthorLine).join("\n"),
    affiliationsText: (metadata.affiliations ?? [])
      .map(formatAffiliationLine)
      .join("\n"),
  };
}

function parseAffiliations(
  text: string,
): { id: string; name: string; nameEn?: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const sep = line.indexOf("|");
      if (sep < 0) return { id: line, name: line };
      const id = line.slice(0, sep).trim();
      const nameField = line.slice(sep + 1).trim();
      const slash = nameField.indexOf(" / ");
      if (slash < 0) return { id, name: nameField };
      const name = nameField.slice(0, slash).trim();
      const nameEn = nameField.slice(slash + 3).trim();
      return nameEn.length > 0 ? { id, name, nameEn } : { id, name };
    });
}

function parseAuthors(
  text: string,
): { name: string; nameEn?: string; affiliationIds?: string[] }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const sep = line.indexOf("|");
      const nameField = (sep < 0 ? line : line.slice(0, sep)).trim();
      const slash = nameField.indexOf(" / ");
      const name =
        slash < 0 ? nameField : nameField.slice(0, slash).trim();
      const nameEn =
        slash < 0 ? undefined : nameField.slice(slash + 3).trim() || undefined;
      if (sep < 0) {
        return nameEn ? { name, nameEn } : { name };
      }
      const ids = line
        .slice(sep + 1)
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      return {
        name,
        ...(nameEn ? { nameEn } : {}),
        ...(ids.length > 0 ? { affiliationIds: ids } : {}),
      };
    });
}

function parseKeywords(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function buildMetadataCandidate(
  draft: DocumentMetadataDraft,
): DocMetadata | undefined {
  const title = draft.title.trim();
  const titleEn = draft.titleEn.trim();
  const abstractText = draft.abstract.trim();
  const abstractEn = draft.abstractEn.trim();
  const keywords = parseKeywords(draft.keywordsText);
  const keywordsEn = parseKeywords(draft.keywordsEnText);
  const authors = parseAuthors(draft.authorsText);
  const affiliations = parseAffiliations(draft.affiliationsText);

  if (
    title.length === 0 &&
    titleEn.length === 0 &&
    abstractText.length === 0 &&
    abstractEn.length === 0 &&
    keywords.length === 0 &&
    keywordsEn.length === 0 &&
    authors.length === 0 &&
    affiliations.length === 0
  ) {
    return undefined;
  }

  return {
    ...(title.length > 0 ? { title } : {}),
    ...(titleEn.length > 0 ? { titleEn } : {}),
    ...(abstractText.length > 0 ? { abstract: abstractText } : {}),
    ...(abstractEn.length > 0 ? { abstractEn } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(keywordsEn.length > 0 ? { keywordsEn } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(affiliations.length > 0 ? { affiliations } : {}),
  };
}

export const useDocumentMetadata = create<DocumentMetadataState>()((set, get) => ({
  ...EMPTY,
  setField: (key, value) => set({ [key]: value }),
  clear: () => set({ ...EMPTY }),
  hydrate: (metadata) => set(metadataToDraft(metadata)),
  toMetadataCandidate: () => buildMetadataCandidate(get()),
}));
