"use client";

import { CompileTemplateIdSchema, type CompileTemplateId } from "@depress/ast";
import { Button } from "@/components/ui/button";
import { useActiveView } from "@/components/shell/active-view";
import type { CompileJobApiClient } from "@/lib/compile-job-client";
import { CompileSessionProvider, useCompileSession } from "./compile-session-context";
import type { DocumentSaveState } from "./editor-area";
import type { Sleep } from "./use-compile-job-session";

// T-06 Slice 7A: `COMPILE_POLLING_INVALIDATE_EVENT` lives in
// `use-compile-job-session.ts` (the compile state machine that listens for
// it) — re-exported here unchanged so existing importers
// (`authenticated-app-gate.tsx`, `compile-controls.test.tsx`) keep working
// against this file's public path without any change on their side.
export { COMPILE_POLLING_INVALIDATE_EVENT } from "./use-compile-job-session";

export const COMPILE_TEMPLATE_OPTIONS = [
  { id: "ieee", label: "IEEE" },
  { id: "elsevier", label: "Elsevier" },
  { id: "gbt7714", label: "GB/T 7714" },
] as const satisfies readonly { id: CompileTemplateId; label: string }[];

interface CompileControlsProps {
  activeDocumentId?: string;
  activeRevision?: number;
  saveState: DocumentSaveState;
  client?: CompileJobApiClient;
  sleep?: Sleep;
  openDownload?: (url: string) => void;
}

// T-06 Slice 7B-1: `CompileControls` is now pure presentation, reading the
// ONE shared compile session from Context. In the real app,
// `DocumentWorkspace` provides a single `CompileSessionProvider` above the
// Editor/Papers/References tree, so this component finds an ambient
// session (`useCompileSession()` returns non-`undefined` — either "ready"
// or, briefly during a document/revision handoff, "unavailable") and
// renders straight from it — no session of its own, and never a second
// one, even transiently: a mismatched-key handoff reads as "unavailable",
// not "no provider", so this fallback branch is never taken while an
// ambient provider exists.
//
// For standalone/test usage (this component rendered directly with no
// ambient provider — exactly how compile-controls.test.tsx's 13 tests
// render it), `useCompileSession()` returns `undefined` (no provider
// ancestor at all). The fallback below creates a local
// `CompileSessionProvider` scoped to just this subtree, using this
// component's own props — same `key={documentId:revision}` boundary and
// same default client/sleep/openDownload as before Slice 7B-1, just
// expressed via the shared provider machinery instead of a bespoke local
// one. This keeps the public component contract, and every existing test,
// unchanged.
//
// T-06 Slice 7B-2: this presentation is deliberately absent (`return
// null`) whenever the dedicated PDF Output view is the active surface —
// PdfOutputView renders the one actionable compile control surface then,
// reading the exact same shared session. This is a real conditional
// unmount, not a CSS hide, so there is never more than one accessible
// "PDF template"/"Compile"/"Download PDF" set of controls in the DOM at
// once. The shared session itself is unaffected either way — it lives in
// DocumentWorkspace's CompileSessionProvider, not in this component.
// `useActiveView()` outside any `ActiveViewProvider` (every existing test)
// defaults to `activeView: "editor"`, so this never changes existing test
// behavior.
export function CompileControls({
  activeDocumentId,
  activeRevision,
  saveState,
  client,
  sleep,
  openDownload,
}: CompileControlsProps) {
  const { activeView } = useActiveView();
  const ambient = useCompileSession();
  if (activeView === "pdf") return null;
  if (ambient !== undefined) return <CompileControlsPresentation />;

  return (
    <CompileSessionProvider
      saveState={saveState}
      {...(activeDocumentId === undefined ? {} : { documentId: activeDocumentId })}
      {...(activeRevision === undefined ? {} : { revision: activeRevision })}
      {...(client === undefined ? {} : { client })}
      {...(sleep === undefined ? {} : { sleep })}
      {...(openDownload === undefined ? {} : { openDownload })}
    >
      <CompileControlsPresentation />
    </CompileSessionProvider>
  );
}

// Pure presentation: identical DOM/JSX to the pre-7B-1 component, reading
// every value from the shared session instead of local state/refs. Renders
// nothing during the brief "unavailable" window between a document/
// revision change and the new key's session reporting in — never shows
// stale controls bound to the previous document/revision.
function CompileControlsPresentation() {
  const state = useCompileSession();
  if (!state || state.status === "unavailable") return null;
  const {
    selectedTemplateId,
    setSelectedTemplateId,
    activeCompileJobId,
    compileStatus,
    compileError,
    submitting,
    polling,
    canCompile,
    needsSave,
    submit,
    download,
  } = state;

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-col gap-[6px]">
        <label
          className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase"
          htmlFor="compile-template"
        >
          PDF template
        </label>
        <select
          id="compile-template"
          aria-label="PDF template"
          value={selectedTemplateId}
          onChange={(event) => {
            const parsed = CompileTemplateIdSchema.safeParse(
              event.currentTarget.value,
            );
            if (parsed.success) setSelectedTemplateId(parsed.data);
          }}
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-neutral-300)] bg-[var(--color-bg)] px-[11px] py-[9px] text-[13.5px] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
        >
          {COMPILE_TEMPLATE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <Button
        variant="primary"
        disabled={!canCompile}
        onClick={() => void submit()}
        className="w-full"
      >
        {submitting ? "Submitting…" : polling ? "Compiling…" : "Compile"}
      </Button>
      {needsSave && (
        <p role="status" className="text-[12.5px] text-[var(--color-accent-2-700)]">
          Save the document before compiling
        </p>
      )}
      {compileStatus && (
        <p role="status" className="text-[12.5px] text-[var(--color-neutral-600)]">
          Compile status: {compileStatus}
        </p>
      )}
      {compileStatus === "succeeded" && activeCompileJobId && (
        <Button variant="secondary" onClick={() => void download()} className="w-full">
          Download PDF
        </Button>
      )}
      {compileError && (
        <p role="alert" className="text-[12.5px] text-[var(--color-accent-2-700)]">
          {compileError}
        </p>
      )}
    </div>
  );
}
