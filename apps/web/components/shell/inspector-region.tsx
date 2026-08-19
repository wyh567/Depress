// Broadsheet right inspector region (T-06 Slice 3 + 3A height-propagation
// fix) — a fixed-width, full-height slot for the current, unchanged
// LibraryPanel. Same rationale as SidebarRegion: no competing
// background/border, LibraryPanel already renders its own
// (`border-l border-gray-200 bg-gray-50`) and is not being redesigned
// this slice. Enforces the approved 296px width and contains overflow.
//
// `grid` (Slice 3A): same root cause and fix as SidebarRegion — see that
// file's comment. Restores the stretch behavior LibraryPanel had as a
// direct CSS Grid child before Slice 3 wrapped it, without touching
// LibraryPanel itself.
import type { ReactNode } from "react";

export function InspectorRegion({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full min-h-0 w-[296px] shrink-0 overflow-hidden">
      {children}
    </div>
  );
}
