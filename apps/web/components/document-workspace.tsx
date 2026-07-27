"use client";

import {
  PersistedDocumentEnvelopeSchema,
  type DocumentResource,
  type DocumentSummary,
  type PersistedDocumentEnvelope,
} from "@depress/ast";
import type { JSONContent } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DocumentConflictError,
  documentClient,
  type DocumentApiClient,
} from "@/lib/document-client";
import { useDocumentMetadata } from "@/stores/document-metadata";
import { useReferenceLibrary } from "@/stores/reference-library";
import { DocumentListPanel } from "./document-list-panel";
import { EditorArea, type DocumentSaveState } from "./editor/editor-area";
import { useDepressEditor } from "./editor/use-depress-editor";
import { LibraryPanel } from "./library/library-panel";

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
        return true;
      } catch {
        setSaveState("failed");
        return false;
      } finally {
        hydrating.current = false;
      }
    },
    [editor],
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

  return (
    <div className="grid h-full grid-cols-[240px_1fr_320px]">
      <DocumentListPanel
        documents={documents}
        {...(activeDocumentId === undefined ? {} : { activeDocumentId })}
        loading={loading}
        onCreate={() => void createNew()}
        onOpen={(documentId) => void openDocument(documentId)}
      />
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
      <LibraryPanel />
    </div>
  );
}
