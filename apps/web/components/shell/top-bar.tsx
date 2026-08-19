// Broadsheet top bar (T-06 Slice 3, extended Slices 5-6, 8). 56px product
// bar: brand mark + Papers/References navigation on the left, real
// authenticated-user context on the right. No fabricated data — only
// `userName` (from the live session), the sign-out affordance, the
// current UI view (papers/editor/references/pdf, from the shared
// ActiveViewProvider — not business data), and (Slice 8) the current
// document's real title (from the shared ActiveDocumentContext,
// DocumentWorkspace's own publish-only mirror of its real
// `documents`/`activeDocumentId` — not a second source of document data)
// are rendered.
//
// Sign-out behavior is NOT implemented here. `onSignOut` / `signingOut` are
// passed in from AuthenticatedAppGate, which owns the auth call, the
// COMPILE_POLLING_INVALIDATE_EVENT dispatch, the reference-library clear,
// and the redirect — this component only renders the button and forwards
// the click.
import { Button } from "@/components/ui/button";
import { useActiveDocumentTitle } from "@/components/shell/active-document-context";
import { useActiveView } from "@/components/shell/active-view";

export interface TopBarProps {
  userName: string;
  signingOut: boolean;
  onSignOut: () => void;
}

export function TopBar({ userName, signingOut, onSignOut }: TopBarProps) {
  const { activeView, showPapers, showEditor, showReferences } = useActiveView();
  const { activeDocumentTitle } = useActiveDocumentTitle();

  const navButtonClass = (active: boolean) =>
    `transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2 ${
      active
        ? "font-semibold text-[var(--color-text)]"
        : "text-[var(--color-neutral-600)] hover:text-[var(--color-text)]"
    }`;

  return (
    <header className="flex h-[56px] shrink-0 items-center justify-between border-b border-[var(--color-divider)] bg-[var(--color-bg)] px-[20px]">
      <div className="flex items-center gap-[24px]">
        <div className="flex items-baseline gap-[6px]">
          <span className="text-[16px] font-semibold tracking-[-.01em]">DePress</span>
          <span className="mb-[1px] h-[5px] w-[5px] self-center rounded-[var(--radius-sm)] bg-[var(--color-accent)]" />
        </div>
        <nav className="flex items-center gap-[16px] text-[13px]">
          <button
            type="button"
            aria-current={activeView === "papers" ? "page" : undefined}
            onClick={showPapers}
            className={navButtonClass(activeView === "papers")}
          >
            Papers
          </button>
          <button
            type="button"
            aria-current={activeView === "references" ? "page" : undefined}
            onClick={showReferences}
            className={navButtonClass(activeView === "references")}
          >
            References
          </button>
          {activeView !== "editor" && (
            <button
              type="button"
              onClick={showEditor}
              className="text-[var(--color-neutral-600)] transition-colors hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
            >
              Editor
            </button>
          )}
        </nav>
        {/* Slice 8: real-document breadcrumb context, shown only once a
            document is actually open and the current view is about that
            document (not the Papers list itself). Plain text, not a
            second navigation control — "Papers"/"References"/"Editor"
            above already own navigation. */}
        {activeDocumentTitle && activeView !== "papers" && (
          <div className="flex min-w-0 items-center gap-[8px] text-[13px]">
            <span className="text-[var(--color-neutral-400)]">/</span>
            <span className="max-w-[320px] truncate text-[var(--color-text)]">
              {activeDocumentTitle}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-[12px] text-[13px] text-[var(--color-neutral-700)]">
        <span>{userName}</span>
        <Button variant="ghost" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </header>
  );
}
