"use client";

import { EditorContent } from "@tiptap/react";
import { useCallback, useState } from "react";
import { CitationPrompt } from "./citation-prompt";
import { useDepressEditor } from "./use-depress-editor";

// 临时 mock:TODO #6 接入真实引用库后替换
const MOCK_KNOWN_CITE_KEYS = new Set(["smith2024", "wang2023"]);

export function EditorArea() {
  const [promptOpen, setPromptOpen] = useState(false);
  const editor = useDepressEditor({
    onRequestCitation: useCallback(() => setPromptOpen(true), []),
    isCitationKnown: useCallback((citeKey: string) => MOCK_KNOWN_CITE_KEYS.has(citeKey), []),
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
