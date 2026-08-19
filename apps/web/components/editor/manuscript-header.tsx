"use client";

// Broadsheet manuscript header (T-06 Slice 4). Read-only, publication-style
// display of the document's own metadata — title/authors/affiliations/
// abstract/keywords — rendered above the editable body. This is DISPLAY
// only; it does not replace authoring, which stays in EditorInspector's
// Document tab (DocumentMetadataPanel, unchanged). Real data only: every
// field is omitted when empty rather than showing placeholder/fabricated
// text, and authors/affiliations are derived from the exact same exported
// `buildMetadataCandidate` the save path already uses — no second parser.
import { buildMetadataCandidate, useDocumentMetadata } from "@/stores/document-metadata";

export function ManuscriptHeader() {
  // Individual field selectors (not one object-returning selector): Zustand
  // needs each selector to return a stable/primitive value across renders,
  // the same pattern DocumentMetadataPanel already uses for this store. A
  // selector that builds a fresh object literal every call breaks
  // useSyncExternalStore's snapshot caching and causes an infinite
  // re-render loop.
  const title = useDocumentMetadata((s) => s.title);
  const titleEn = useDocumentMetadata((s) => s.titleEn);
  const abstract = useDocumentMetadata((s) => s.abstract);
  const abstractEn = useDocumentMetadata((s) => s.abstractEn);
  const keywordsText = useDocumentMetadata((s) => s.keywordsText);
  const keywordsEnText = useDocumentMetadata((s) => s.keywordsEnText);
  const authorsText = useDocumentMetadata((s) => s.authorsText);
  const affiliationsText = useDocumentMetadata((s) => s.affiliationsText);
  const metadata = buildMetadataCandidate({
    title,
    titleEn,
    abstract,
    abstractEn,
    keywordsText,
    keywordsEnText,
    authorsText,
    affiliationsText,
  });
  if (!metadata) return null;

  const affiliationName = (id: string) =>
    metadata.affiliations?.find((a) => a.id === id)?.name;
  const authorLine = metadata.authors
    ?.map((author) => {
      const affNames = (author.affiliationIds ?? [])
        .map(affiliationName)
        .filter((name): name is string => Boolean(name));
      return affNames.length > 0 ? `${author.name} (${affNames.join(", ")})` : author.name;
    })
    .join(", ");
  const keywords = [...(metadata.keywords ?? []), ...(metadata.keywordsEn ?? [])];

  return (
    <header className="mb-[30px] flex flex-col gap-[10px]">
      {metadata.title && (
        <h1 className="m-0 text-[35px] leading-[1.15] font-semibold tracking-[-.018em] text-[var(--color-neutral-900)]">
          {metadata.title}
        </h1>
      )}
      {metadata.titleEn && !metadata.title && (
        <h1 className="m-0 text-[35px] leading-[1.15] font-semibold tracking-[-.018em] text-[var(--color-neutral-900)]">
          {metadata.titleEn}
        </h1>
      )}
      {authorLine && (
        <p className="m-0 text-[13.5px] text-[var(--color-neutral-700)]">{authorLine}</p>
      )}
      {(metadata.abstract || metadata.abstractEn) && (
        <div className="mt-[10px] flex flex-col gap-[3px]">
          <span className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
            Abstract
          </span>
          <p className="m-0 text-[14px] leading-[1.6] text-[var(--color-neutral-700)]">
            {metadata.abstract ?? metadata.abstractEn}
          </p>
        </div>
      )}
      {keywords.length > 0 && (
        <div className="mt-[3px] flex flex-col gap-[3px]">
          <span className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
            Keywords
          </span>
          <p className="m-0 text-[13px] text-[var(--color-neutral-700)]">
            {keywords.join(", ")}
          </p>
        </div>
      )}
    </header>
  );
}
