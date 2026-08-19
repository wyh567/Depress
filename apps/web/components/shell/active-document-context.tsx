"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// T-06 Slice 8: a purely presentational value — the title of whichever
// document is currently open, so `TopBar` (rendered by
// `AuthenticatedAppGate`, a sibling of `DocumentWorkspace` rather than an
// ancestor/descendant) can show real breadcrumb context without any
// business-state lifting. Same category as `ActiveViewContext`: plain
// React Context, not persisted, not routing, not API state.
// `DocumentWorkspace` already owns the real document list and
// `activeDocumentId` — this only mirrors the current title string for
// display in a component outside that subtree. No document loading,
// switching, or save behavior lives here.
export interface ActiveDocumentContextValue {
  activeDocumentTitle: string | undefined;
  setActiveDocumentTitle: (title: string | undefined) => void;
}

const DEFAULT_VALUE: ActiveDocumentContextValue = {
  activeDocumentTitle: undefined,
  setActiveDocumentTitle: () => {},
};

const ActiveDocumentContext = createContext<ActiveDocumentContextValue>(DEFAULT_VALUE);

export function useActiveDocumentTitle(): ActiveDocumentContextValue {
  return useContext(ActiveDocumentContext);
}

export function ActiveDocumentProvider({ children }: { children: ReactNode }) {
  const [activeDocumentTitle, setActiveDocumentTitle] = useState<string | undefined>(undefined);
  return (
    <ActiveDocumentContext.Provider value={{ activeDocumentTitle, setActiveDocumentTitle }}>
      {children}
    </ActiveDocumentContext.Provider>
  );
}
