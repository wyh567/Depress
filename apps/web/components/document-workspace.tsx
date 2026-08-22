"use client";

import {
  PersistedDocumentEnvelopeSchema,
  type DocumentResource,
  type DocumentSummary,
  type PersistedDocumentEnvelope,
} from "@depress/ast";
import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveDocumentTitle } from "@/components/shell/active-document-context";
import { useActiveView } from "@/components/shell/active-view";
import { InspectorRegion } from "@/components/shell/inspector-region";
import { SidebarRegion } from "@/components/shell/sidebar-region";
import {
  DocumentConflictError,
  documentClient,
  type DocumentApiClient,
} from "@/lib/document-client";
import { useDocumentMetadata } from "@/stores/document-metadata";
import { useReferenceLibrary } from "@/stores/reference-library";
import { DocumentListPanel } from "./document-list-panel";
import { CompileControls } from "./editor/compile-controls";
import { CompileSessionProvider } from "./editor/compile-session-context";
import { DocumentMetadataPanel } from "./editor/document-metadata-panel";
import { EditorArea, type DocumentSaveState } from "./editor/editor-area";
import { EditorInspector } from "./editor/editor-inspector";
import { ExportAstButton } from "./editor/export-ast-button";
import { useDepressEditor } from "./editor/use-depress-editor";
import { LibraryPanel } from "./library/library-panel";
import { PapersDashboard } from "./papers/papers-dashboard";
import { PdfOutputView } from "./pdf/pdf-output-view";
import { ReferencesView } from "./references/references-view";

interface DocumentWorkspaceProps {
  client?: DocumentApiClient;
  confirmDiscard?: (message: string) => boolean;
}

function toSummary(document: DocumentResource): DocumentSummary {
  return {
    id: document.id,
    title: document.envelope.metadata?.title ?? "Untitled",
    revision: document.revision,
    updatedAt: document.updatedAt,
  };
}

function upsertSummary(
  summaries: DocumentSummary[],
  document: DocumentResource,
): DocumentSummary[] {
  const summary = toSummary(document);
  const next = summaries.filter((candidate) => candidate.id !== summary.id);
  return [summary, ...next];
}

function hasUnsavedChanges(saveState: DocumentSaveState): boolean {
  return saveState === "dirty" || saveState === "failed" || saveState === "conflict";
}

export function DocumentWorkspace({
  client = documentClient,
  confirmDiscard = (message) => window.confirm(message),
}: DocumentWorkspaceProps) {
  const { activeView, showEditor } = useActiveView();
  const { setActiveDocumentTitle } = useActiveDocumentTitle();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string>();
  const [activeRevision, setActiveRevision] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<DocumentSaveState>("idle");
  const [lastSafeServerEnvelope, setLastSafeServerEnvelope] =
    useState<PersistedDocumentEnvelope>();
  const [promptOpen, setPromptOpen] = useState(false);
  const hydrating = useRef(false);
  const editVersion = useRef(0);
  const activeDocumentIdRef = useRef<string | undefined>(undefined);
  const documentRequestGeneration = useRef(0);

  // T-06 Slice 8: publish the active document's real title for TopBar's
  // breadcrumb (a sibling component outside this subtree) — display-only
  // mirroring, not a second source of document data. Cleared on unmount
  // so a stale title never lingers into a different authenticated session.
  useEffect(() => {
    const title = documents.find((document) => document.id === activeDocumentId)?.title;
    setActiveDocumentTitle(title);
  }, [documents, activeDocumentId, setActiveDocumentTitle]);
  useEffect(() => () => setActiveDocumentTitle(undefined), [setActiveDocumentTitle]);

  const editor = useDepressEditor({
    onRequestCitation: useCallback(() => setPromptOpen(true), []),
    isCitationKnown: useCallback(
      (citeKey: string) => useReferenceLibrary.getState().has(citeKey),
      [],
    ),
    subscribeCitationValidity: useCallback(
      (onChange: () => void) => useReferenceLibrary.subscribe(onChange),
      [],
    ),
  });

  const markDirty = useCallback(() => {
    if (hydrating.current || !activeDocumentIdRef.current) return;
    editVersion.current += 1;
    setSaveState("dirty");
  }, []);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", markDirty);
    return () => {
      editor.off("update", markDirty);
    };
  }, [editor, markDirty]);

  useEffect(
    () =>
      useDocumentMetadata.subscribe(() => {
        markDirty();
      }),
    [markDirty],
  );

  useEffect(() => {
    let cancelled = false;
    void client
      .listDocuments()
      .then((listed) => {
        if (!cancelled) setDocuments(listed);
      })
      .catch(() => {
        if (!cancelled) setSaveState("failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const hydrate = useCallback(
    (document: DocumentResource): boolean => {
      if (!editor) return false;
      hydrating.current = true;
      try {
        editor.commands.setContent(document.envelope.editor as JSONContent, {
          emitUpdate: false,
          errorOnInvalidContent: true,
        });
        useDocumentMetadata.getState().hydrate(document.envelope.metadata);
        editVersion.current = 0;
        activeDocumentIdRef.current = document.id;
        setActiveDocumentId(document.id);
        setActiveRevision(document.revision);
        setLastSafeServerEnvelope(document.envelope);
        setSaveState("saved");
        setDocuments((current) => upsertSummary(current, document));
        // T-06 Slice 5: switch the UI view to Editor only after a
        // document has actually, successfully loaded — this is the one
        // hook point shared by New Paper, Open Editor (different
        // document, already past mayReplaceLocalState), and the ordinary
        // in-editor document-switch/conflict-reload paths. It is a no-op
        // when already on the Editor view.
        showEditor();
        return true;
      } catch {
        setSaveState("failed");
        return false;
      } finally {
        hydrating.current = false;
      }
    },
    [editor, showEditor],
  );

  const runDocumentRequest = useCallback(
    async (request: () => Promise<DocumentResource>) => {
      const generation = ++documentRequestGeneration.current;
      setLoading(true);
      try {
        const document = await request();
        if (generation === documentRequestGeneration.current) {
          hydrate(document);
        }
      } catch {
        if (generation === documentRequestGeneration.current) {
          setSaveState("failed");
        }
      } finally {
        if (generation === documentRequestGeneration.current) {
          setLoading(false);
        }
      }
    },
    [hydrate],
  );

  useEffect(
    () => () => {
      documentRequestGeneration.current += 1;
    },
    [],
  );

  const mayReplaceLocalState = useCallback(() => {
    if (saveState === "saving") return false;
    if (!hasUnsavedChanges(saveState)) return true;
    return confirmDiscard("Discard unsaved changes and open another document?");
  }, [confirmDiscard, saveState]);

  const createNew = useCallback(async () => {
    if (!mayReplaceLocalState()) return;
    await runDocumentRequest(() => client.createDocument());
  }, [client, mayReplaceLocalState, runDocumentRequest]);

  const openDocument = useCallback(
    async (documentId: string) => {
      if (documentId === activeDocumentId || !mayReplaceLocalState()) return;
      await runDocumentRequest(() => client.getDocument(documentId));
    },
    [activeDocumentId, client, mayReplaceLocalState, runDocumentRequest],
  );

  // T-06 Slice 5: Papers Dashboard's "Open Editor" action. Same document
  // already active → just switch views, no API call, no guard needed
  // (nothing about the document is changing). Different document → defer
  // entirely to the existing `openDocument`, which already runs
  // `mayReplaceLocalState()` (the SAME unsaved-change confirm used
  // everywhere else — not a second mechanism) and only switches the view
  // (via `hydrate`'s `showEditor()`) once that guard has passed and the
  // real document load has actually succeeded.
  const openEditorFor = useCallback(
    (documentId: string) => {
      if (documentId === activeDocumentId) {
        showEditor();
        return;
      }
      void openDocument(documentId);
    },
    [activeDocumentId, openDocument, showEditor],
  );

  const save = useCallback(async () => {
    if (
      !editor ||
      !activeDocumentId ||
      activeRevision === undefined ||
      saveState === "saving"
    ) {
      return;
    }
    const metadata = useDocumentMetadata.getState().toMetadataCandidate();
    const parsed = PersistedDocumentEnvelopeSchema.safeParse({
      schemaVersion: 1,
      editor: editor.getJSON(),
      ...(metadata === undefined ? {} : { metadata }),
    });
    if (!parsed.success) {
      setSaveState("failed");
      return;
    }

    const saveVersion = editVersion.current;
    setSaveState("saving");
    try {
      const saved = await client.updateDocument(
        activeDocumentId,
        activeRevision,
        parsed.data,
      );
      setActiveRevision(saved.revision);
      setLastSafeServerEnvelope(saved.envelope);
      setDocuments((current) => upsertSummary(current, saved));
      setSaveState(editVersion.current === saveVersion ? "saved" : "dirty");
    } catch (error) {
      setSaveState(error instanceof DocumentConflictError ? "conflict" : "failed");
    }
  }, [activeDocumentId, activeRevision, client, editor, saveState]);

  const reloadServer = useCallback(async () => {
    if (!activeDocumentId) return;
    await runDocumentRequest(() => client.getDocument(activeDocumentId));
  }, [activeDocumentId, client, runDocumentRequest]);

  const keepEditing = useCallback(() => {
    setSaveState(lastSafeServerEnvelope ? "dirty" : "failed");
  }, [lastSafeServerEnvelope]);

  // T-07 (P1-02): `mayReplaceLocalState` already guards every in-app document
  // switch, but nothing guarded the browser's own exits. A reload, a tab close,
  // or a back navigation discarded an unsaved manuscript or metadata draft
  // silently -- and this application has no autosave by design, so "silently"
  // means "permanently". The handler is attached only while there is something
  // to lose, which is what makes the guard self-clearing: a successful save
  // flips `saveState` to "saved" and this effect tears it down, while a failed
  // or conflicting save leaves the draft dirty and the guard in place.
  useEffect(() => {
    // T-07 (P1-02 follow-up): a save in flight is not a completed failure,
    // but leaving mid-save loses exactly the draft a "dirty" exit would --
    // there is no autosave to fall back on. This is checked here rather
    // than folded into `hasUnsavedChanges` itself, so `mayReplaceLocalState`'s
    // stronger in-app behavior during a save (silently refuse, no confirm
    // dialog) stays exactly as it was.
    if (!hasUnsavedChanges(saveState) && saveState !== "saving") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [saveState]);

  // T-06 Slice 5: the Editor grid below is ALWAYS rendered — `hidden`
  // (display:none) toggles its visibility only. This keeps the TipTap
  // editor instance, CompileControls' polling state/AbortControllers,
  // LibraryPanel's draft form state, and the metadata store subscription
  // fully mounted and untouched while the Papers Dashboard is showing;
  // conditional rendering (`{activeView === "editor" && <.../>}`) would
  // unmount all of that instead, which is exactly what must not happen.
  return (
    // T-06 Slice 7B-1: the ONE shared compile session for the active
    // document/revision, provided once here — above the Editor grid,
    // Papers, and References — so CompileControls (inside the Editor's
    // Export tab today; a future PDF Output surface later) always finds
    // and consumes this same session instead of creating its own.
    // CompileSessionProvider's own keyed remount boundary renders no DOM
    // and wraps none of this tree (see compile-session-context.tsx for
    // why) — this fragment below is exactly what rendered here before
    // Slice 7B-1, unmodified, still fully stable across document/revision
    // changes. DocumentWorkspace only composes the provider here; the
    // compile state machine itself still lives entirely inside
    // CompileSessionProvider's own keyed boundary, not in DocumentWorkspace.
    <CompileSessionProvider
      saveState={saveState}
      {...(activeDocumentId === undefined ? {} : { documentId: activeDocumentId })}
      {...(activeRevision === undefined ? {} : { revision: activeRevision })}
    >
      <div
        className={
          activeView === "editor"
            ? "grid h-full grid-cols-[232px_minmax(0,1fr)_296px]"
            : "hidden"
        }
      >
        <SidebarRegion>
          <DocumentListPanel
            documents={documents}
            {...(activeDocumentId === undefined ? {} : { activeDocumentId })}
            loading={loading}
            onCreate={() => void createNew()}
            onOpen={(documentId) => void openDocument(documentId)}
          />
        </SidebarRegion>
        {/* Slice 3A: `grid` (not a plain block div) so EditorArea's <main>
            stretches to this cell's already-bounded height via CSS Grid's
            default align-items:stretch — see shell/sidebar-region.tsx for
            the full root-cause note; same fix, same reasoning, applied here
            since this center wrapper isn't its own named component. */}
        <div className="grid h-full min-h-0 min-w-0 overflow-hidden">
          <EditorArea
            editor={editor}
            {...(activeDocumentId === undefined ? {} : { activeDocumentId })}
            {...(activeRevision === undefined ? {} : { activeRevision })}
            saveState={saveState}
            promptOpen={promptOpen}
            onPromptOpenChange={setPromptOpen}
            onSave={() => void save()}
            onReloadServer={() => void reloadServer()}
            onKeepEditing={keepEditing}
          />
        </div>
        <InspectorRegion>
          <EditorInspector
            documentPanel={<DocumentMetadataPanel />}
            referencesPanel={<LibraryPanel />}
            exportPanel={
              <div className="flex flex-col gap-[16px]">
                <ExportAstButton getEditorJson={() => editor?.getJSON()} />
                <CompileControls
                  {...(activeDocumentId === undefined ? {} : { activeDocumentId })}
                  {...(activeRevision === undefined ? {} : { activeRevision })}
                  saveState={saveState}
                />
              </div>
            }
          />
        </InspectorRegion>
      </div>
      {/* The Dashboard, unlike the Editor grid above, is genuinely
          conditionally rendered (unmounted when not the active view) —
          it owns no state worth preserving across a view switch, and
          mounting it alongside the Editor at all times would duplicate
          every document row's accessible name (Dashboard's table and the
          sidebar's DocumentListPanel both render one button per document
          from the same `documents` array), breaking exact-name queries
          like getByRole("button", { name: /^First/ }) even while hidden
          via CSS. Only the Editor side has an explicit "must stay
          mounted" requirement — the Dashboard does not. */}
      {activeView === "papers" && (
        <div className="h-full min-h-0">
          <PapersDashboard
            documents={documents}
            activeDocumentId={activeDocumentId}
            loading={loading}
            onCreateNew={() => void createNew()}
            onOpenDocument={openEditorFor}
          />
        </div>
      )}
      {/* Same rationale as the Dashboard above: the dedicated References
          view is genuinely conditionally rendered (unmounted when not
          active). Reusing AddReferenceForm/BibtexImport/Edit-Delete
          aria-labels as a second *simultaneous* instance alongside the
          Editor's own always-mounted copies (inside EditorInspector's
          References tab) would duplicate those exact accessible names —
          the same collision class the Dashboard hit in Slice 5. The
          dedicated view owns no state that this slice requires to survive
          a view switch (only the Editor's own copies must). */}
      {activeView === "references" && (
        <div className="h-full min-h-0">
          <ReferencesView
            activePaperTitle={documents.find((document) => document.id === activeDocumentId)?.title}
          />
        </div>
      )}
      {/* T-06 Slice 7B-2: genuinely conditionally rendered, same rationale
          as Papers/References above — PdfOutputView owns no state worth
          preserving across a view switch (all real state it reads lives
          in the shared CompileSessionProvider above, which is unaffected
          by this view mounting/unmounting). */}
      {activeView === "pdf" && (
        <div className="h-full min-h-0">
          <PdfOutputView
            activeDocumentId={activeDocumentId}
            activeRevision={activeRevision}
            documentTitle={documents.find((document) => document.id === activeDocumentId)?.title}
          />
        </div>
      )}
    </CompileSessionProvider>
  );
}
