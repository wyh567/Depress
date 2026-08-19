"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { CitationPrompt } from "./citation-prompt";
import { ManuscriptHeader } from "./manuscript-header";

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

// Broadsheet manuscript canvas (T-06 Slice 4). Compile controls, the AST
// export button, and metadata authoring have moved out of this component's
// header into EditorInspector's tabs (rendered by document-workspace.tsx,
// which now owns their mount points) — but this file keeps its own props
// contract unchanged (editor/activeDocumentId/activeRevision/saveState/
// promptOpen/onSave/onReloadServer/onKeepEditing all identical), so
// document-workspace.tsx's wiring to it is otherwise untouched. Save
// remains here, deliberately: it's the one action that must always be
// visible and unambiguous, since this application has no autosave.
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
    <main className="flex h-full min-h-0 flex-col bg-[var(--color-surface)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-divider)] bg-[var(--color-bg)] px-[20px] py-[10px]">
        <div>
          <span className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
            {activeRevision !== undefined ? `Manuscript · Revision ${activeRevision}` : "Manuscript"}
          </span>
        </div>
        <Button
          variant="primary"
          onClick={onSave}
          disabled={!activeDocumentId || saveState === "saving"}
        >
          {saveState === "saving" ? "Saving…" : "Save"}
        </Button>
      </div>

      {!activeDocumentId ? (
        <p className="p-[30px] text-[13.5px] text-[var(--color-neutral-600)]">
          Create or open a document to begin.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Source Serif 4 scoped to just the manuscript canvas (per this
              slice's explicit instruction) — the surrounding shell/chrome
              keeps its existing font, unaffected, same "scoped, not
              global" pattern as Login (Slice 2). `--font-source-serif-4`
              itself is already exposed on <html> from Slice 3. */}
          <div
            className="mx-auto w-full max-w-[820px] px-[60px] py-[40px]"
            style={{ fontFamily: "var(--font-source-serif-4), var(--font-body)" }}
          >
            <div className="max-w-[700px]">
              <ManuscriptHeader />
              <EditorContent
                editor={editor}
                className="prose-depress"
              />
            </div>
          </div>
        </div>
      )}

      {saveState === "dirty" && (
        <p
          role="status"
          className="shrink-0 border-t border-[var(--color-divider)] bg-[var(--color-bg)] px-[20px] py-[8px] text-[12.5px] text-[var(--color-accent-2-700)]"
        >
          Unsaved changes
        </p>
      )}
      {saveState === "saved" && (
        <p
          role="status"
          className="shrink-0 border-t border-[var(--color-divider)] bg-[var(--color-bg)] px-[20px] py-[8px] text-[12.5px] text-[var(--color-accent-700)]"
        >
          Saved
        </p>
      )}
      {saveState === "failed" && (
        <p
          role="alert"
          className="shrink-0 border-t border-[var(--color-divider)] bg-[var(--color-bg)] px-[20px] py-[8px] text-[12.5px] text-[var(--color-accent-2-700)]"
        >
          Save failed. Your local changes are still here. Try Save again.
        </p>
      )}
      {saveState === "conflict" && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-[12px] border-t border-[var(--color-divider)] bg-[var(--color-bg)] px-[20px] py-[8px] text-[12.5px]"
        >
          <span className="text-[var(--color-accent-2-700)]">
            The server has a newer revision. Your local changes are still here.
          </span>
          <Button variant="secondary" onClick={onReloadServer}>
            Reload Server Version
          </Button>
          <Button variant="ghost" onClick={onKeepEditing}>
            Keep Editing
          </Button>
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
