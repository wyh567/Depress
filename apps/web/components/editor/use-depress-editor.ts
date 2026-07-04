"use client";

import { useEditor } from "@tiptap/react";
import type { CitationOptions } from "./citation-node";
import { createDepressExtensions } from "./extensions";

export function useDepressEditor(citationOptions: CitationOptions = {}) {
  return useEditor({
    extensions: createDepressExtensions(citationOptions),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "focus:outline-none min-h-full",
        lang: "zh-CN",
      },
    },
  });
}
