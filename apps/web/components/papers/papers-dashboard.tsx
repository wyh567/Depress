"use client";

import type { DocumentSummary } from "@depress/ast";
import { useState } from "react";
import { InspectorRegion } from "@/components/shell/inspector-region";
import { SidebarRegion } from "@/components/shell/sidebar-region";
import { PaperDashboardRail } from "./paper-dashboard-rail";
import { PaperPreviewPanel } from "./paper-preview-panel";
import { PapersTable } from "./papers-table";

export interface PapersDashboardProps {
  documents: DocumentSummary[];
  activeDocumentId: string | undefined;
  loading: boolean;
  onCreateNew: () => void;
  onOpenDocument: (documentId: string) => void;
}

// Broadsheet Papers Dashboard (T-06 Slice 5). Reuses DocumentWorkspace's
// own already-loaded `documents`/`activeDocumentId`/`loading` — no
// duplicate fetch, no new store. `dashboardSelectedDocumentId` is local,
// presentation-only state that exists purely to drive the inspector
// preview; it is never written to `activeDocumentId` by selecting a row —
// only clicking "Open Editor" calls back into the real document-opening
// path (`onOpenDocument`, DocumentWorkspace's `openEditorFor`), which is
// what actually may change the active document (through the existing,
// unmodified mayReplaceLocalState guard).
export function PapersDashboard({
  documents,
  activeDocumentId,
  loading,
  onCreateNew,
  onOpenDocument,
}: PapersDashboardProps) {
  // `undefined` means "the user has not explicitly picked a row yet" — in
  // that case the effective selection falls back to the real active
  // document, then the first row, computed at render time rather than
  // synced via an effect (no extra render pass, nothing to get out of
  // sync). Once the user clicks a row, their explicit choice always wins.
  const [explicitSelection, setExplicitSelection] = useState<string | undefined>(undefined);
  const dashboardSelectedDocumentId =
    explicitSelection ?? activeDocumentId ?? documents[0]?.id;
  const selected = documents.find((document) => document.id === dashboardSelectedDocumentId);

  return (
    <div className="grid h-full grid-cols-[232px_minmax(0,1fr)_296px]">
      <SidebarRegion>
        <PaperDashboardRail />
      </SidebarRegion>
      <div className="grid h-full min-h-0 min-w-0 overflow-hidden">
        <PapersTable
          documents={documents}
          loading={loading}
          activeDocumentId={activeDocumentId}
          selectedId={dashboardSelectedDocumentId}
          onSelect={setExplicitSelection}
          onCreateNew={onCreateNew}
        />
      </div>
      <InspectorRegion>
        <PaperPreviewPanel selected={selected} onOpenEditor={onOpenDocument} />
      </InspectorRegion>
    </div>
  );
}
