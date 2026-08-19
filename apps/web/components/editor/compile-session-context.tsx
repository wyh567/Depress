"use client";

import type { CompileTemplateId, PersistedCompileJobStatus } from "@depress/ast";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  compileJobClient,
  type CompileJobApiClient,
} from "@/lib/compile-job-client";
import type { DocumentSaveState } from "./editor-area";
import {
  abortableSleep,
  useCompileJobSession,
  type Sleep,
} from "./use-compile-job-session";

// T-06 Slice 7B-1: the shared compile session — the ONE logical compile
// state machine for the active document/revision, exposed via Context so a
// future Editor Export surface and PDF Output surface (Slice 7B-2+, not
// built yet) can both consume it without either one instantiating its own
// `useCompileJobSession`.
//
// ARCHITECTURE NOTE (why this isn't the originally-sketched "keyed
// component renders descendants" shape): an earlier version of this file
// had `CompileRevisionBoundary` (the `key={documentId:revision}` component)
// directly render `children`. That is wrong — React's key-remount destroys
// and recreates EVERYTHING rendered inside the keyed component, not just
// its own state. Since `children` here is the entire Editor/Papers/
// References tree (TipTap editor, EditorInspector's tab selection,
// LibraryPanel's draft form state, DocumentMetadataPanel's subscription),
// keying that whole subtree by revision remounted all of it on every Save
// (Save always advances the revision) — confirmed via real-browser
// verification: EditorInspector's active tab silently reset to "Document"
// on every Save. That is a real, user-visible regression, not a refactor.
//
// The fix: `CompileRevisionBoundary` renders NOTHING (`null`). It still
// gets destroyed/recreated by the key exactly as before — that remount is
// still 100% of what resets the compile-scoped state/refs on document or
// revision change; nothing here reimplements that reset. Its only other
// job is reporting its `useCompileJobSession()` result, TAGGED with the
// exact documentId/revision key it was computed for, up to the STABLE
// `CompileSessionProvider`, which is what actually owns the
// non-remounting `children` and the Context.
//
// STALE-HANDOFF SAFETY: when documentId/revision change, the STABLE
// provider's own props update synchronously on that same render — before
// the outgoing boundary's unmount and the incoming boundary's first effect
// have run. During that window the provider's last-reported session is
// still tagged with the OLD key. The provider derives what it actually
// exposes via Context by comparing the reported session's key against its
// OWN current documentId/revision on every render: a mismatch (or nothing
// reported yet) exposes `{ status: "unavailable" }` — never the old
// session's submit/download/status as if they belonged to the new
// document/revision. This is a synchronous per-render comparison, not a
// state reset — the reporting effect never mutates or reinitializes
// anything; it only ever reports what the current, key-owned
// `useCompileJobSession` instance already computed.
export interface CompileSessionValue {
  selectedTemplateId: CompileTemplateId;
  setSelectedTemplateId: (templateId: CompileTemplateId) => void;
  activeCompileJobId: string | undefined;
  compileStatus: PersistedCompileJobStatus | undefined;
  compileError: string | undefined;
  submitting: boolean;
  polling: boolean;
  canCompile: boolean;
  needsSave: boolean;
  submit: () => Promise<void>;
  download: () => Promise<void>;
}

// Discriminated so a key-mismatch (or "nothing reported yet") is a
// distinct, statically-narrowable state from a ready session — a consumer
// can never destructure `submit`/`download`/status fields out of an
// "unavailable" value. Distinct from the Context's own `undefined` default
// (which means "no CompileSessionProvider ancestor at all" — see
// `CompileControls`'s fallback logic): `undefined` says "go create your
// own session"; `{ status: "unavailable" }` says "a shared provider exists,
// its session just isn't ready for the current key yet — do not create a
// second one, wait."
export type CompileSessionState =
  | { status: "unavailable" }
  | ({ status: "ready" } & CompileSessionValue);

interface ReportedSession {
  key: string;
  session: CompileSessionValue;
}

const CompileSessionContext = createContext<CompileSessionState | undefined>(
  undefined,
);

// Module-level, not an inline default-parameter arrow function: a default
// parameter expression is re-evaluated on every call where the argument is
// omitted, so an inline `(url) => ...` here would hand `download`'s
// `useCallback` (which depends on `openDownload`) a NEW function identity
// on every render of `CompileRevisionBoundary` — which the reporting
// effect below depends on, turning a harmless per-render allocation into
// an effect → setState → render → effect loop. `client`/`sleep` are
// already stable module-level references for the same reason.
function defaultOpenDownload(url: string): void {
  window.location.assign(url);
}

export function useCompileSession(): CompileSessionState | undefined {
  return useContext(CompileSessionContext);
}

export interface CompileSessionProviderProps {
  documentId?: string;
  revision?: number;
  saveState: DocumentSaveState;
  client?: CompileJobApiClient;
  sleep?: Sleep;
  openDownload?: (url: string) => void;
  children: ReactNode;
}

export function CompileSessionProvider({
  documentId,
  revision,
  saveState,
  client,
  sleep,
  openDownload,
  children,
}: CompileSessionProviderProps) {
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<CompileTemplateId>("ieee");
  const [reported, setReported] = useState<ReportedSession | undefined>(
    undefined,
  );

  const currentKey = `${documentId ?? "none"}:${revision ?? "none"}`;
  const contextValue: CompileSessionState =
    reported && reported.key === currentKey
      ? { status: "ready", ...reported.session }
      : { status: "unavailable" };

  return (
    <>
      <CompileRevisionBoundary
        key={currentKey}
        sessionKey={currentKey}
        selectedTemplateId={selectedTemplateId}
        setSelectedTemplateId={setSelectedTemplateId}
        saveState={saveState}
        onSessionChange={setReported}
        {...(documentId === undefined ? {} : { documentId })}
        {...(revision === undefined ? {} : { revision })}
        {...(client === undefined ? {} : { client })}
        {...(sleep === undefined ? {} : { sleep })}
        {...(openDownload === undefined ? {} : { openDownload })}
      />
      <CompileSessionContext.Provider value={contextValue}>
        {children}
      </CompileSessionContext.Provider>
    </>
  );
}

interface CompileRevisionBoundaryProps {
  documentId?: string;
  revision?: number;
  sessionKey: string;
  saveState: DocumentSaveState;
  selectedTemplateId: CompileTemplateId;
  setSelectedTemplateId: (templateId: CompileTemplateId) => void;
  client?: CompileJobApiClient;
  sleep?: Sleep;
  openDownload?: (url: string) => void;
  onSessionChange: (reported: ReportedSession) => void;
}

// Renders nothing. Exists purely to be the `key`-remounted owner of
// `useCompileJobSession` and to report its result, tagged with the key it
// was computed for, up to the stable provider above — see the
// architecture note on `CompileSessionProvider`.
function CompileRevisionBoundary({
  documentId,
  revision,
  sessionKey,
  saveState,
  selectedTemplateId,
  setSelectedTemplateId,
  client = compileJobClient,
  sleep = abortableSleep,
  openDownload = defaultOpenDownload,
  onSessionChange,
}: CompileRevisionBoundaryProps) {
  const {
    activeCompileJobId,
    compileStatus,
    compileError,
    submitting,
    polling,
    canCompile,
    needsSave,
    submit,
    download,
  } = useCompileJobSession({
    ...(documentId === undefined ? {} : { activeDocumentId: documentId }),
    ...(revision === undefined ? {} : { activeRevision: revision }),
    saveState,
    selectedTemplateId,
    setSelectedTemplateId,
    client,
    sleep,
    openDownload,
  });

  useEffect(() => {
    onSessionChange({
      key: sessionKey,
      session: {
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
      },
    });
  }, [
    onSessionChange,
    sessionKey,
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
  ]);

  return null;
}
