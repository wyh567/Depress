import { create } from "zustand";
import type { DocMetadata } from "@depress/ast";

// In-memory document metadata (Phase 3 TODO #1). Persistence is Phase 4.
// Empty form → omit metadata on export (backward-compatible docs).
// Non-empty form → build a candidate object; DocSchema validates at export.

export interface DocumentMetadataDraft {
  title: string;
  abstract: string;
  keywordsText: string;
  authorsText: string;
  affiliationsText: string;
}

const EMPTY: DocumentMetadataDraft = {
  title: "",
  abstract: "",
  keywordsText: "",
  authorsText: "",
  affiliationsText: "",
};

interface DocumentMetadataState extends DocumentMetadataDraft {
  setField: <K extends keyof DocumentMetadataDraft>(
    key: K,
    value: DocumentMetadataDraft[K],
  ) => void;
  clear: () => void;
  // Builds the AST metadata candidate, or undefined when the form is empty.
  toMetadataCandidate: () => DocMetadata | undefined;
}

function parseAffiliations(text: string): { id: string; name: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const sep = line.indexOf("|");
      if (sep < 0) return { id: line, name: line };
      return {
        id: line.slice(0, sep).trim(),
        name: line.slice(sep + 1).trim(),
      };
    });
}

function parseAuthors(
  text: string,
): { name: string; affiliationIds?: string[] }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const sep = line.indexOf("|");
      if (sep < 0) return { name: line };
      const name = line.slice(0, sep).trim();
      const ids = line
        .slice(sep + 1)
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      return ids.length > 0 ? { name, affiliationIds: ids } : { name };
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
  const abstractText = draft.abstract.trim();
  const keywords = parseKeywords(draft.keywordsText);
  const authors = parseAuthors(draft.authorsText);
  const affiliations = parseAffiliations(draft.affiliationsText);

  if (
    title.length === 0 &&
    abstractText.length === 0 &&
    keywords.length === 0 &&
    authors.length === 0 &&
    affiliations.length === 0
  ) {
    return undefined;
  }

  return {
    ...(title.length > 0 ? { title } : {}),
    ...(abstractText.length > 0 ? { abstract: abstractText } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(affiliations.length > 0 ? { affiliations } : {}),
  };
}

export const useDocumentMetadata = create<DocumentMetadataState>()((set, get) => ({
  ...EMPTY,
  setField: (key, value) => set({ [key]: value }),
  clear: () => set({ ...EMPTY }),
  toMetadataCandidate: () => buildMetadataCandidate(get()),
}));
