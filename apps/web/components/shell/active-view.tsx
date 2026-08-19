"use client";

// Authenticated-app UI view state (T-06 Slices 5-6, extended Slice 7B-2):
// "papers" | "editor" | "references" | "pdf".
//
// This is NOT business state — no document data, no save/revision/compile
// state lives here, only which presentation is currently visible. It is
// deliberately NOT Zustand and NOT persisted (per owner instruction): a
// plain React Context, instantiated fresh by AuthenticatedAppGate each
// time it mounts (i.e. each authenticated session), so its lifetime
// matches "AuthenticatedAppGate owns activeView" exactly.
//
// Why Context and not props: TopBar and DocumentWorkspace both need to
// read/write this, but they are not parent/child of each other — TopBar
// is constructed directly by AuthenticatedAppGate, while DocumentWorkspace
// is nested inside AuthenticatedAppGate's opaque `children` prop (which
// must stay a plain ReactNode — auth-flow.test.tsx passes a bare `<p>` as
// children in two places, ruling out a render-prop shape). Context is the
// smallest mechanism that reaches both without lifting document state or
// touching that prop's type.
//
// The default value (used whenever a component calls useActiveView()
// outside a Provider — e.g. document-workspace.test.tsx renders
// DocumentWorkspace standalone) is activeView: "editor" with no-op
// setters, so every pre-Slice-5 test keeps seeing exactly the Editor grid
// it already asserts against, unchanged.
import { createContext, useContext, useState, type ReactNode } from "react";

export type ActiveView = "papers" | "editor" | "references" | "pdf";

export interface ActiveViewContextValue {
  activeView: ActiveView;
  showPapers: () => void;
  showEditor: () => void;
  showReferences: () => void;
  showPdf: () => void;
}

const DEFAULT_VALUE: ActiveViewContextValue = {
  activeView: "editor",
  showPapers: () => {},
  showEditor: () => {},
  showReferences: () => {},
  showPdf: () => {},
};

const ActiveViewContext = createContext<ActiveViewContextValue>(DEFAULT_VALUE);

export function useActiveView(): ActiveViewContextValue {
  return useContext(ActiveViewContext);
}

export function ActiveViewProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<ActiveView>("editor");
  const value: ActiveViewContextValue = {
    activeView,
    showPapers: () => setActiveView("papers"),
    showEditor: () => setActiveView("editor"),
    showReferences: () => setActiveView("references"),
    showPdf: () => setActiveView("pdf"),
  };
  return <ActiveViewContext.Provider value={value}>{children}</ActiveViewContext.Provider>;
}
