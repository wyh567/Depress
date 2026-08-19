"use client";

// Broadsheet editor inspector (T-06 Slice 4, extended Slice 6) — the
// right-column Document / References / Export tab structure. Purely
// presentational tab chrome: it owns only which tab is visually active,
// nothing else.
//
// All three panels are ALWAYS mounted (toggled with `hidden`, never
// conditionally rendered) — deliberately, per the owner's explicit
// instruction that inactive panels may not unmount if doing so could
// destroy state. Concretely: unmounting `children.export` (CompileControls)
// would abort an in-flight compile job's AbortController; unmounting
// `children.references` (LibraryPanel) would drop whatever a mentor has
// half-typed into the BibTeX textarea or the manual add-reference form.
// Keeping all three mounted avoids both.
//
// Slice 6 adds one link — "Open References →" — above the untouched
// `referencesPanel` (still the real, unmodified LibraryPanel), calling the
// shared `showReferences()` view-state setter. This is purely a navigation
// affordance into the richer dedicated References view; it does not
// change what this tab already renders or how.
//
// Slice 7B-2 adds the equivalent "Open PDF Output →" link above
// `exportPanel`, calling `showPdf()`. Also purely navigation: `exportPanel`
// itself (ExportAstButton + CompileControls) is untouched here — whether
// CompileControls renders its own presentation while the PDF view is
// active is decided inside CompileControls itself (it reads the shared
// active view), not by this component.
import { useState, type ReactNode } from "react";
import { useActiveView } from "@/components/shell/active-view";

export type EditorInspectorTab = "document" | "references" | "export";

const TABS: { id: EditorInspectorTab; label: string }[] = [
  { id: "document", label: "Document" },
  { id: "references", label: "References" },
  { id: "export", label: "Export" },
];

export interface EditorInspectorProps {
  documentPanel: ReactNode;
  referencesPanel: ReactNode;
  exportPanel: ReactNode;
}

export function EditorInspector({
  documentPanel,
  referencesPanel,
  exportPanel,
}: EditorInspectorProps) {
  const [active, setActive] = useState<EditorInspectorTab>("document");
  const { showReferences, showPdf } = useActiveView();

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-[var(--color-divider)] bg-[var(--color-bg)]">
      <div
        role="tablist"
        aria-label="Editor inspector"
        className="flex shrink-0 border-b border-[var(--color-divider)] px-[10px] pt-[10px]"
      >
        {TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.id)}
              className={`rounded-t-[var(--radius-md)] px-[12px] py-[8px] text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2 ${
                selected
                  ? "border-x border-t border-[var(--color-divider)] border-b-[var(--color-bg)] -mb-px bg-[var(--color-bg)] text-[var(--color-text)]"
                  : "text-[var(--color-neutral-600)] hover:text-[var(--color-text)]"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {/* Document/Export panels: plain block wrappers. The wrapper itself
          scrolls (`overflow-y-auto`) around their natural content height —
          no nested internal scroll container to bound.
          References panel: `grid` (not a plain block div), same fix as
          Slice 3A's InspectorRegion and for the same reason — LibraryPanel
          has its own internal `overflow-y-auto` list that needs a bounded
          ancestor height to actually engage, or it silently stops
          scrolling and this outer wrapper clips it instead. Grid's default
          align-items:stretch restores that bound without touching
          LibraryPanel itself, preserving its exact current scroll
          behavior from InspectorRegion. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div role="tabpanel" hidden={active !== "document"} className="h-full min-h-0 overflow-y-auto">
          {documentPanel}
        </div>
        <div
          role="tabpanel"
          hidden={active !== "references"}
          className="grid h-full min-h-0 grid-rows-[auto_1fr]"
        >
          <div className="border-b border-[var(--color-divider)] px-[14px] py-[10px]">
            <button
              type="button"
              onClick={showReferences}
              className="text-[12.5px] text-[var(--color-accent-700)] transition-colors hover:text-[var(--color-accent-600)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
            >
              Open References →
            </button>
          </div>
          <div className="grid min-h-0">{referencesPanel}</div>
        </div>
        <div
          role="tabpanel"
          hidden={active !== "export"}
          className="grid h-full min-h-0 grid-rows-[auto_1fr]"
        >
          <div className="border-b border-[var(--color-divider)] px-[14px] py-[10px]">
            <button
              type="button"
              onClick={showPdf}
              className="text-[12.5px] text-[var(--color-accent-700)] transition-colors hover:text-[var(--color-accent-600)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
            >
              Open PDF Output →
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto p-[14px]">{exportPanel}</div>
        </div>
      </div>
    </aside>
  );
}
