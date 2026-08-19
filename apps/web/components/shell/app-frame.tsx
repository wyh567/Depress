// Broadsheet authenticated-app shell (T-06 Slice 3). Purely structural —
// owns no business logic, no auth state, no data fetching. The top bar is
// passed in as a slot so its behavior (sign-out, session) stays owned by
// AuthenticatedAppGate, not duplicated here.
//
// Layout contract: full-height column, top bar fixed at its own height and
// never scrolls, the content region beneath it is the only place height
// gets divided further (by whatever grid the caller renders inside
// `children` — e.g. DocumentWorkspace's sidebar/center/inspector columns).
// `overflow-hidden` here is deliberate: it stops the body from ever
// becoming the authenticated workspace's scroll container — each region
// inside `children` is expected to manage its own vertical scroll, same as
// today.
import type { ReactNode } from "react";

export interface AppFrameProps {
  topBar: ReactNode;
  children: ReactNode;
}

export function AppFrame({ topBar, children }: AppFrameProps) {
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--color-surface)]">
      {topBar}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
