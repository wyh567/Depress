"use client";

import { EditorContent } from "@tiptap/react";
import { useDepressEditor } from "./use-depress-editor";

export function EditorArea() {
  const editor = useDepressEditor();

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
    </main>
  );
}
