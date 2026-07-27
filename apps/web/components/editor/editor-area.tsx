"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { useCallback } from "react";
import { CitationPrompt } from "./citation-prompt";
import { CompileControls } from "./compile-controls";
import { DocumentMetadataPanel } from "./document-metadata-panel";
import { ExportAstButton } from "./export-ast-button";

export type DocumentSaveState =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "failed"
  | "conflict";

interface EditorAreaProps {
  editor: Editor | null;
  activeDocumentId?: string;
  activeRevision?: number;
  saveState: DocumentSaveState;
  promptOpen: boolean;
  onPromptOpenChange: (open: boolean) => void;
  onSave: () => void;
  onReloadServer: () => void;
  onKeepEditing: () => void;
}

export function EditorArea({
  editor,
  activeDocumentId,
  activeRevision,
  saveState,
  promptOpen,
  onPromptOpenChange,
  onSave,
  onReloadServer,
  onKeepEditing,
}: EditorAreaProps) {
  const insertCitation = useCallback(
    (citeKey: string) => {
      onPromptOpenChange(false);
      editor?.chain().focus().insertCitation({ citeKey }).run();
    },
    [editor, onPromptOpenChange],
  );

  return (
    <main className="flex min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Editor</h2>
          {activeRevision !== undefined && (
            <p className="text-xs text-gray-500">Revision {activeRevision}</p>
          )}
        </div>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={!activeDocumentId || saveState === "saving"}
          >
            {saveState === "saving" ? "Saving…" : "Save"}
          </button>
          <ExportAstButton getEditorJson={() => editor?.getJSON()} />
          <CompileControls
            {...(activeDocumentId === undefined ? {} : { activeDocumentId })}
            {...(activeRevision === undefined ? {} : { activeRevision })}
            saveState={saveState}
          />
        </div>
      </div>
      {!activeDocumentId ? (
        <p className="p-6 text-sm text-gray-500">Create or open a document to begin.</p>
      ) : (
        <>
          <DocumentMetadataPanel />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EditorContent
              editor={editor}
              className="prose-depress mx-auto h-full max-w-2xl px-8 py-6"
            />
          </div>
        </>
      )}
      {saveState === "dirty" && (
        <p role="status" className="border-t px-4 py-2 text-sm text-amber-700">
          Unsaved changes
        </p>
      )}
      {saveState === "saved" && (
        <p role="status" className="border-t px-4 py-2 text-sm text-green-700">
          Saved
        </p>
      )}
      {saveState === "failed" && (
        <p role="alert" className="border-t px-4 py-2 text-sm text-red-700">
          Save failed. Your local changes are still here. Try Save again.
        </p>
      )}
      {saveState === "conflict" && (
        <div role="alert" className="flex items-center gap-3 border-t px-4 py-2 text-sm">
          <span>The server has a newer revision. Your local changes are still here.</span>
          <button type="button" onClick={onReloadServer}>
            Reload Server Version
          </button>
          <button type="button" onClick={onKeepEditing}>
            Keep Editing
          </button>
        </div>
      )}
      {promptOpen && (
        <CitationPrompt
          onConfirm={insertCitation}
          onCancel={() => onPromptOpenChange(false)}
        />
      )}
    </main>
  );
}
