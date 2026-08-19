// Broadsheet left sidebar region (T-06 Slice 3 + 3A height-propagation fix)
// — a fixed-width, full-height slot for the current, unchanged
// DocumentListPanel. Deliberately does not add its own background/border:
// DocumentListPanel already renders its own surface
// (`border-r border-gray-200 bg-gray-50`), and per this slice's scope that
// content is not being redesigned. This wrapper enforces the approved
// 232px width and contains overflow so the region's own internal
// scrolling (already implemented inside DocumentListPanel) can't leak
// into an outer page-level scrollbar.
//
// `grid` (Slice 3A): before Slice 3, DocumentListPanel was a direct CSS
// Grid child of DocumentWorkspace's own grid, so the browser's default
// `align-items: stretch` bounded it to the workspace height automatically.
// Wrapping it in a plain block `<div>` broke that — a block container
// never stretches its children's height, so DocumentListPanel grew to fit
// its own content instead, and its internal `overflow-y-auto` list never
// had a bounded height to scroll within. Making this wrapper itself a
// grid (default `align-items`/`justify-items: stretch`, one implicit
// cell) restores exactly the same stretch behavior one level deeper,
// without touching DocumentListPanel itself.
//
// `[&>*]:min-h-0` (Slice 3A, verified necessary by measurement — grid
// stretch alone wasn't sufficient here): DocumentListPanel's own root
// element doesn't carry `min-h-0` itself (unlike EditorArea's `<main>` and
// LibraryPanel's `<aside>`, which both already do — that's exactly why
// those two started scrolling correctly from the grid fix alone). Without
// it, the flex column's automatic-minimum-size behavior keeps
// DocumentListPanel's own box sized to its content instead of shrinking
// to the grid-stretched 232-column height, so its internal
// `overflow-y-auto` list never gets a bounded height to scroll within.
// This applies `min-height: 0` to DocumentListPanel's root purely via a
// CSS child-combinator rule emitted from this wrapper's className — its
// own source file is not touched.
import type { ReactNode } from "react";

export function SidebarRegion({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full min-h-0 w-[232px] shrink-0 overflow-hidden [&>*]:min-h-0">
      {children}
    </div>
  );
}
