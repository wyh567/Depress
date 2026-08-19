"use client";

import type { CslItem } from "@depress/ast";
import { formatAuthors, formatYear } from "@/components/library/format-reference";

export interface ReferencesTableProps {
  items: CslItem[];
  loading: boolean;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  "article-journal": "Journal article",
  book: "Book",
  "paper-conference": "Conference paper",
  chapter: "Chapter",
  thesis: "Thesis",
  webpage: "Web page",
  document: "Other document",
};

// Broadsheet References table (T-06 Slice 6). Real CslItem fields only —
// citeKey (item.id), type, title, formatted author/year (the same pure
// helpers LibraryPanel already uses). No usage count, no formatted
// GB/T 7714 / IEEE citation preview, no fabricated "missing field" styling
// beyond what the item genuinely lacks.
export function ReferencesTable({ items, loading, selectedId, onSelect }: ReferencesTableProps) {
  if (loading) {
    return (
      <p className="p-[24px] text-[13px] text-[var(--color-neutral-500)]">
        Loading references…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="p-[24px] text-[13px] text-[var(--color-neutral-500)]">
        No references yet.
      </p>
    );
  }

  return (
    <ul className="flex min-w-0 flex-col gap-[2px] overflow-x-auto p-[16px]">
      {items.map((item) => {
        const selected = item.id === selectedId;
        const missingYear = item.issued?.["date-parts"]?.[0]?.[0] === undefined;
        return (
          <li key={item.id} className="min-w-[520px]">
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-center gap-[16px] rounded-[var(--radius-md)] border-l-2 px-[14px] py-[10px] text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2 ${
                selected
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-100)]"
                  : "border-transparent hover:bg-[var(--color-neutral-100)]"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[14px] ${
                    selected ? "font-semibold" : "font-medium"
                  } text-[var(--color-text)]`}
                >
                  {formatAuthors(item)} {formatYear(item)}
                </span>
                <span className="block truncate text-[12.5px] text-[var(--color-neutral-600)]">
                  {item.title}
                </span>
                <span className="text-[11px] text-[var(--color-neutral-500)]">@{item.id}</span>
              </span>
              <span className="shrink-0 text-[10.5px] tracking-[.08em] text-[var(--color-neutral-500)] uppercase">
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
              {missingYear && (
                <span className="shrink-0 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-accent-2-300)] bg-[var(--color-accent-2-100)] px-[6px] py-[2px] text-[10px] tracking-[.06em] text-[var(--color-accent-2-700)] uppercase">
                  Missing year
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
