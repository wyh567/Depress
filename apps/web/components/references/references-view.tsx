"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AddReferenceForm } from "@/components/library/add-reference-form";
import { BibtexImport } from "@/components/library/bibtex-import";
import { SidebarRegion } from "@/components/shell/sidebar-region";
import { useActiveView } from "@/components/shell/active-view";
import { useReferenceLibrary } from "@/stores/reference-library";
import { ReferenceInspector } from "./reference-inspector";
import { ReferencesRail } from "./references-rail";
import { ReferencesTable } from "./references-table";

// Broadsheet dedicated References view (T-06 Slice 6). Genuinely
// conditionally rendered by DocumentWorkspace (mounted only while
// activeView === "references") — unlike the Editor grid, which must stay
// mounted at all times. This view owns no reference data of its own: it
// reads `useReferenceLibrary` directly (same store, same session-
// generation guard, zero duplicate fetch) and reuses AddReferenceForm /
// BibtexImport as fresh instances — their own local drafts are allowed to
// reset when this view unmounts (explicitly sanctioned by this slice's
// own instructions), while the Editor's separate, always-mounted copies
// of those same components (inside EditorInspector's References tab) are
// completely unaffected either way.
//
// T-06 Slice 9A: passes accessibleLabelPrefix="Reference view" to both,
// so this instance's accessible names never collide with the Editor's own
// copy, which stays CSS-hidden (not unmounted, to preserve its draft)
// whenever this view is active. Visible UI is unaffected; only the two
// components' aria-labels differ between the two instances.
//
// 312px right inspector (not 296px): built inline here rather than
// widening the shared InspectorRegion, so the Editor shell's own 296px
// column is untouched.
export function ReferencesView({ activePaperTitle }: { activePaperTitle: string | undefined }) {
  const { showEditor } = useActiveView();
  const items = useReferenceLibrary((state) => state.items);
  const loading = useReferenceLibrary((state) => state.loading);
  const error = useReferenceLibrary((state) => state.error);
  const [explicitSelection, setExplicitSelection] = useState<string | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);

  const selectedId = explicitSelection ?? items[0]?.id;
  const selected = items.find((item) => item.id === selectedId);

  return (
    <div data-testid="references-view" className="grid h-full grid-cols-[232px_minmax(0,1fr)_312px]">
      <SidebarRegion>
        <ReferencesRail activePaperTitle={activePaperTitle} />
      </SidebarRegion>

      <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_1fr] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-divider)] px-[24px] py-[16px]">
          <div>
            <h1 className="m-0 text-[20px] font-semibold tracking-[-.01em] text-[var(--color-text)]">
              References
            </h1>
            <p className="m-0 mt-[2px] text-[13px] text-[var(--color-neutral-600)]">
              {items.length} reference{items.length === 1 ? "" : "s"} in your library.
            </p>
          </div>
          <div className="flex items-center gap-[8px]">
            <Button variant="secondary" onClick={() => setAddOpen((current) => !current)}>
              {addOpen ? "Close" : "Add Reference"}
            </Button>
            <Button variant="primary" onClick={showEditor}>
              Open Editor
            </Button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto">
          {addOpen && (
            <div className="border-b border-[var(--color-divider)] p-[16px]">
              <div className="grid grid-cols-2 gap-[16px]">
                <AddReferenceForm accessibleLabelPrefix="Reference view" />
                <BibtexImport accessibleLabelPrefix="Reference view" />
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="px-[24px] py-[10px] text-[13px] text-[var(--color-accent-2-700)]">
              {error}
            </p>
          )}
          <ReferencesTable
            items={items}
            loading={loading}
            selectedId={selectedId}
            onSelect={setExplicitSelection}
          />
        </div>
      </div>

      <div className="grid h-full min-h-0 w-[312px] shrink-0 overflow-hidden border-l border-[var(--color-divider)] bg-[var(--color-bg)]">
        <ReferenceInspector selected={selected} />
      </div>
    </div>
  );
}
