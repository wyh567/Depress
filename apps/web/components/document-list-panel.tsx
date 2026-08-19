import type { DocumentSummary } from "@depress/ast";
import { Button } from "@/components/ui/button";

interface DocumentListPanelProps {
  documents: DocumentSummary[];
  activeDocumentId?: string;
  loading: boolean;
  onCreate: () => void;
  onOpen: (documentId: string) => void;
}

// Broadsheet left sidebar alignment (T-06 Slice 4A). Presentation only —
// every prop, callback, and accessible name below is unchanged from the
// pre-Slice-4A version: same `onCreate`/`onOpen`, same argumentless "New"
// button (document-workspace.test.tsx renders this component for real and
// asserts getByRole("button", { name: "New" }) verbatim), same
// `document.id === activeDocumentId` selection logic, same title-then-
// revision DOM order in each row (document-workspace.test.tsx also
// matches row buttons via `getByRole("button", { name: /^Second/ })`,
// which depends on the title text being the row button's first content).
export function DocumentListPanel({
  documents,
  activeDocumentId,
  loading,
  onCreate,
  onOpen,
}: DocumentListPanelProps) {
  return (
    // `min-w-0` (Slice 4A, verified necessary by measurement): this
    // aside is a grid item of shell/sidebar-region.tsx's 232px column.
    // CSS Grid's automatic-minimum-size rule floors an item's width at
    // its content's min-content size when the item's own overflow is
    // 'visible' (the default) — so a long, un-truncated document title
    // was pushing this aside wider than its 232px column instead of
    // truncating. `min-w-0` lets the grid's stretch actually win, which
    // is what makes the existing `truncate` class on the title span
    // below able to engage at all.
    <aside className="flex min-w-0 flex-col border-r border-[var(--color-divider)] bg-[var(--color-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--color-divider)] px-[16px] py-[12px]">
        <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
          Documents
        </h2>
        <Button variant="ghost" onClick={onCreate} disabled={loading}>
          New
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-[8px]">
        {loading ? (
          <p role="status" className="p-[8px] text-[13px] text-[var(--color-neutral-500)]">
            Loading documents…
          </p>
        ) : documents.length === 0 ? (
          <p className="p-[8px] text-[13px] text-[var(--color-neutral-500)]">
            No documents yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-[2px]">
            {documents.map((document) => {
              const active = document.id === activeDocumentId;
              return (
                <li key={document.id}>
                  <button
                    type="button"
                    className={`w-full rounded-[var(--radius-md)] border-l-2 py-[8px] pr-[10px] pl-[8px] text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2 ${
                      active
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-100)]"
                        : "border-transparent hover:bg-[var(--color-neutral-100)]"
                    }`}
                    onClick={() => onOpen(document.id)}
                  >
                    <span
                      className={`block truncate ${
                        active
                          ? "font-semibold text-[var(--color-text)]"
                          : "font-medium text-[var(--color-neutral-800)]"
                      }`}
                    >
                      {document.title}
                    </span>
                    <span className="block text-[11px] text-[var(--color-neutral-500)]">
                      Revision {document.revision}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
