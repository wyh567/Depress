"use client";

import { useEditor } from "@tiptap/react";
import { depressExtensions } from "./extensions";

export function useDepressEditor() {
  return useEditor({
    extensions: depressExtensions,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "focus:outline-none min-h-full",
        lang: "zh-CN",
      },
    },
  });
}
