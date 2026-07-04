"use client";

import { EditorContent } from "@tiptap/react";
import { useCallback, useState } from "react";
import { useReferenceLibrary } from "@/stores/reference-library";
import { CitationPrompt } from "./citation-prompt";
import { useDepressEditor } from "./use-depress-editor";

export function EditorArea() {
  const [promptOpen, setPromptOpen] = useState(false);
  const editor = useDepressEditor({
    onRequestCitation: useCallback(() => setPromptOpen(true), []),
    isCitationKnown: useCallback(
      (citeKey: string) => useReferenceLibrary.getState().has(citeKey),
      []
    ),
    subscribeCitationValidity: useCallback(
      (onChange: () => void) => useReferenceLibrary.subscribe(onChange),
      []
    ),
  });

  const insertCitation = useCallback(
    (citeKey: string) => {
      setPromptOpen(false);
      editor?.chain().focus().insertCitation({ citeKey }).run();
    },
    [editor]
  );

  return (
    <main className="flex min-h-0 flex-col bg-white">
      <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700">
        编辑区
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent
          editor={editor}
          className="prose-depress mx-auto h-full max-w-2xl px-8 py-6"
        />
      </div>
      {promptOpen && (
        <CitationPrompt onConfirm={insertCitation} onCancel={() => setPromptOpen(false)} />
      )}
    </main>
  );
}
