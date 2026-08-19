"use client";

import type { DocumentSummary } from "@depress/ast";
import { Button } from "@/components/ui/button";

export interface PapersTableProps {
  documents: DocumentSummary[];
  loading: boolean;
  activeDocumentId: string | undefined;
  selectedId: string | undefined;
  onSelect: (documentId: string) => void;
  onCreateNew: () => void;
}

// Real-updatedAt-only, computed at render time — no timer, no new
// dependency. `updatedAt` is when the document was last saved, so this is
// deliberately worded "Updated", never a compile-time claim like
// "Compiled N ago" (T-06 Slice 5 instruction: those are semantically
// different and this app has no compile-completion timestamp to show).
function formatUpdated(updatedAt: string): string {
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return "Updated —";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
  return `Updated ${new Date(updatedAt).toLocaleDateString()}`;
}

export function PapersTable({
  documents,
  loading,
  activeDocumentId,
  selectedId,
  onSelect,
  onCreateNew,
}: PapersTableProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-divider)] px-[24px] py-[16px]">
        <div>
          <h1 className="m-0 text-[20px] font-semibold tracking-[-.01em] text-[var(--color-text)]">
            Papers
          </h1>
          <p className="m-0 mt-[2px] text-[13px] text-[var(--color-neutral-600)]">
            Your manuscripts and publication-ready documents.
          </p>
        </div>
        <Button variant="primary" onClick={onCreateNew} disabled={loading}>
          New Paper
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[12px]">
        {loading ? (
          // No `role="status"` here deliberately: DocumentListPanel
          // (always mounted alongside this component — see
          // document-workspace.tsx) already owns that live-region role
          // for the same `loading` state, and document-workspace.test.tsx
          // asserts `getByRole("status")` singularly. Two simultaneous
          // status regions for the same underlying loading state would
          // make that query ambiguous even though this table is visually
          // hidden whenever the Editor view is active.
          <p className="p-[8px] text-[13px] text-[var(--color-neutral-500)]">
            Loading documents…
          </p>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-start gap-[12px] p-[8px]">
            <p className="m-0 text-[13px] text-[var(--color-neutral-500)]">
              No papers yet.
            </p>
            <Button variant="secondary" onClick={onCreateNew}>
              New Paper
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-[2px]">
            {documents.map((document) => {
              const selected = document.id === selectedId;
              const active = document.id === activeDocumentId;
              return (
                <li key={document.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(document.id)}
                    className={`flex w-full items-center gap-[12px] rounded-[var(--radius-md)] border-l-2 px-[12px] py-[10px] text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2 ${
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
                        {document.title}
                      </span>
                      <span className="block text-[11.5px] text-[var(--color-neutral-500)]">
                        Revision {document.revision} · {formatUpdated(document.updatedAt)}
                      </span>
                    </span>
                    {active && (
                      <span className="shrink-0 text-[10px] tracking-[.1em] text-[var(--color-accent-700)] uppercase">
                        Open
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
