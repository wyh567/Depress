"use client";

import { CompileTemplateIdSchema } from "@depress/ast";
import { Button } from "@/components/ui/button";
import { useActiveView } from "@/components/shell/active-view";
import { InspectorRegion } from "@/components/shell/inspector-region";
import { SidebarRegion } from "@/components/shell/sidebar-region";
import { COMPILE_TEMPLATE_OPTIONS } from "@/components/editor/compile-controls";
import {
  useCompileSession,
  type CompileSessionState,
} from "@/components/editor/compile-session-context";

export interface PdfOutputViewProps {
  activeDocumentId: string | undefined;
  activeRevision: number | undefined;
  documentTitle: string | undefined;
}

// Broadsheet PDF Output view (T-06 Slice 7B-2). Genuinely conditionally
// rendered by DocumentWorkspace (mounted only while activeView === "pdf")
// — same pattern as PapersDashboard/ReferencesView. Owns no compile state
// of its own and never calls useCompileJobSession: everything below reads
// the ONE shared CompileSessionContext established in Slice 7B-1, which
// keeps running (owned by DocumentWorkspace's CompileSessionProvider)
// regardless of which view is active. Inline PDF rendering is out of
// scope for this slice — this is an honest output/status surface, not a
// PDF renderer: no iframe, no pdf.js, no fabricated page/size/engine data.
type OutputState =
  | "NO_DOCUMENT"
  | "SESSION_UNAVAILABLE"
  | "NEEDS_SAVE"
  | "NOT_COMPILED"
  | "SUBMITTING"
  | "ACCEPTED"
  | "QUEUED"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED";

const STATE_COPY: Record<OutputState, string> = {
  NO_DOCUMENT: "No paper selected",
  SESSION_UNAVAILABLE: "Preparing output session…",
  NEEDS_SAVE: "Save the current revision before compiling",
  NOT_COMPILED: "No PDF output for this revision yet",
  SUBMITTING: "Submitting compilation…",
  ACCEPTED: "Compilation accepted",
  QUEUED: "Queued for compilation",
  PROCESSING: "Compiling PDF…",
  SUCCEEDED: "PDF ready",
  FAILED: "Compilation failed",
};

type ReadySession = Extract<CompileSessionState, { status: "ready" }>;

// SESSION_UNAVAILABLE takes priority over everything else — the 7B-1
// stale-handoff safeguard reports "unavailable" for exactly the window
// where a session exists for a *different* document/revision than the one
// currently active; treating it as anything else here would risk
// surfacing a stale status/handler as if it belonged to the current
// revision. Real-timestamp fields (createdAt/updatedAt/page count/file
// size/engine) are intentionally never referenced — the shared session
// does not retain them, so this view does not invent them.
function deriveOutputState(
  hasDocument: boolean,
  session: CompileSessionState | undefined,
): OutputState {
  if (!hasDocument) return "NO_DOCUMENT";
  if (!session || session.status === "unavailable") return "SESSION_UNAVAILABLE";
  if (session.needsSave) return "NEEDS_SAVE";
  if (session.submitting) return "SUBMITTING";
  switch (session.compileStatus) {
    case "accepted":
      return "ACCEPTED";
    case "queued":
      return "QUEUED";
    case "processing":
      return "PROCESSING";
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    default:
      return "NOT_COMPILED";
  }
}

export function PdfOutputView({
  activeDocumentId,
  activeRevision,
  documentTitle,
}: PdfOutputViewProps) {
  const { showEditor } = useActiveView();
  const session = useCompileSession();
  const hasDocument = activeDocumentId !== undefined && activeRevision !== undefined;
  const outputState = deriveOutputState(hasDocument, session);
  const ready: ReadySession | undefined =
    session && session.status === "ready" ? session : undefined;

  return (
    <div className="grid h-full grid-cols-[232px_minmax(0,1fr)_296px]">
      <SidebarRegion>
        <PdfOutputRail documentTitle={documentTitle} />
      </SidebarRegion>
      <PdfOutputStage
        documentTitle={documentTitle}
        activeRevision={activeRevision}
        outputState={outputState}
        selectedTemplateId={ready?.selectedTemplateId}
      />
      <InspectorRegion>
        <PdfOutputInspector
          activeRevision={activeRevision}
          outputState={outputState}
          session={ready}
          onOpenEditor={showEditor}
        />
      </InspectorRegion>
    </div>
  );
}

function PdfOutputRail({ documentTitle }: { documentTitle: string | undefined }) {
  return (
    <div className="flex flex-col gap-[6px] p-[16px]">
      <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
        Output
      </h2>
      <span className="rounded-[var(--radius-md)] bg-[var(--color-accent-100)] px-[10px] py-[6px] text-[13px] font-medium text-[var(--color-accent-700)]">
        PDF Output
      </span>
      {documentTitle && (
        <div className="mt-[16px] flex flex-col gap-[2px]">
          <span className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
            Current paper
          </span>
          <span className="truncate text-[13px] text-[var(--color-neutral-700)]">
            {documentTitle}
          </span>
        </div>
      )}
    </div>
  );
}

const TEMPLATE_LABELS: Record<string, string> = Object.fromEntries(
  COMPILE_TEMPLATE_OPTIONS.map((option) => [option.id, option.label]),
);

function PdfOutputStage({
  documentTitle,
  activeRevision,
  outputState,
  selectedTemplateId,
}: {
  documentTitle: string | undefined;
  activeRevision: number | undefined;
  outputState: OutputState;
  selectedTemplateId: string | undefined;
}) {
  const statusColor =
    outputState === "FAILED"
      ? "text-[var(--color-accent-2-700)]"
      : outputState === "SUCCEEDED"
        ? "text-[var(--color-accent-700)]"
        : "text-[var(--color-neutral-600)]";

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] overflow-hidden bg-[var(--color-surface)]">
      <div className="flex items-baseline gap-[8px] border-b border-[var(--color-divider)] px-[24px] py-[14px]">
        <span className="text-[10px] tracking-[.14em] text-[var(--color-neutral-600)] uppercase">
          Output
        </span>
        {activeRevision !== undefined && (
          <span className="text-[10px] tracking-[.14em] text-[var(--color-neutral-400)] uppercase">
            · Revision {activeRevision}
          </span>
        )}
      </div>
      <div className="flex min-h-0 items-center justify-center overflow-y-auto p-[36px]">
        <div className="flex w-full max-w-[420px] flex-col items-center gap-[10px] rounded-[var(--radius-md)] border border-[var(--color-neutral-300)] bg-[var(--color-neutral-100)] px-[40px] py-[56px] text-center shadow-[var(--shadow-sm)]">
          <span className="text-[10px] tracking-[.14em] text-[var(--color-neutral-600)] uppercase">
            PDF Output
          </span>
          <p className="m-0 text-[18px] leading-[1.3] font-semibold text-[var(--color-text)]">
            {documentTitle ?? "No paper selected"}
          </p>
          {activeRevision !== undefined && (
            <p className="m-0 text-[12.5px] text-[var(--color-neutral-600)]">
              Revision {activeRevision}
              {selectedTemplateId &&
                ` · ${TEMPLATE_LABELS[selectedTemplateId] ?? selectedTemplateId}`}
            </p>
          )}
          <p role="status" className={`m-0 mt-[10px] text-[13px] ${statusColor}`}>
            {STATE_COPY[outputState]}
          </p>
        </div>
      </div>
    </div>
  );
}

function PdfOutputInspector({
  activeRevision,
  outputState,
  session,
  onOpenEditor,
}: {
  activeRevision: number | undefined;
  outputState: OutputState;
  session: ReadySession | undefined;
  onOpenEditor: () => void;
}) {
  const compileLabel = !session
    ? "Compile"
    : session.submitting
      ? "Submitting…"
      : session.polling
        ? "Compiling…"
        : session.compileStatus === "succeeded"
          ? "Recompile"
          : "Compile";

  return (
    <div className="flex h-full min-h-0 flex-col gap-[16px] overflow-y-auto p-[16px]">
      <div className="flex flex-col gap-[10px]">
        <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
          Output
        </h2>
        <dl className="m-0 flex flex-col gap-[8px]">
          <div className="flex items-baseline justify-between gap-[8px]">
            <dt className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
              Status
            </dt>
            <dd className="m-0 text-right text-[12.5px] text-[var(--color-text)]">
              {STATE_COPY[outputState]}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
              Revision
            </dt>
            <dd className="m-0 text-[12.5px] text-[var(--color-text)]">
              {activeRevision ?? "—"}
            </dd>
          </div>
        </dl>
        {session && (
          <div className="flex flex-col gap-[6px]">
            <label
              className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase"
              htmlFor="pdf-output-template"
            >
              Format
            </label>
            <select
              id="pdf-output-template"
              aria-label="PDF template"
              value={session.selectedTemplateId}
              onChange={(event) => {
                const parsed = CompileTemplateIdSchema.safeParse(event.currentTarget.value);
                if (parsed.success) session.setSelectedTemplateId(parsed.data);
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
        )}
      </div>

      <div className="h-px bg-[var(--color-divider)]" />

      <div className="flex flex-col gap-[10px]">
        <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
          Actions
        </h2>
        <Button
          variant="primary"
          disabled={!session || !session.canCompile}
          onClick={() => session && void session.submit()}
          className="w-full"
        >
          {compileLabel}
        </Button>
        {session?.compileStatus === "succeeded" && session.activeCompileJobId && (
          <Button
            variant="secondary"
            onClick={() => void session.download()}
            className="w-full"
          >
            Download PDF
          </Button>
        )}
        <Button variant="ghost" onClick={onOpenEditor} className="w-full">
          Open Editor
        </Button>
        {session?.compileError && (
          <p role="alert" className="m-0 text-[12.5px] text-[var(--color-accent-2-700)]">
            {session.compileError}
          </p>
        )}
      </div>
    </div>
  );
}
