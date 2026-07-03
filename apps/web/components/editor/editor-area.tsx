import type { Doc } from "@depress/ast";

// TODO #4 挂载 Tiptap 编辑器;当前仅为占位。
const emptyDoc: Doc = { type: "doc", content: [] };

export function EditorArea() {
  return (
    <main className="flex flex-col bg-white">
      <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700">
        编辑区
      </h2>
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-gray-400">
          编辑器占位 — 当前文档节点数:{emptyDoc.content.length}
        </p>
      </div>
    </main>
  );
}
