"use client";

import { useState } from "react";
import { useReferenceLibrary } from "@/stores/reference-library";

export function BibtexImport() {
  const importBibtex = useReferenceLibrary((state) => state.importBibtex);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const runImport = () => {
    const { imported, errors } = importBibtex(text);
    setMessage(
      errors.length > 0
        ? `导入 ${imported} 条,${errors.length} 条失败:${errors[0]}`
        : `成功导入 ${imported} 条`
    );
    if (imported > 0) setText("");
  };

  return (
    <div className="space-y-2 border-b border-gray-200 p-3">
      <p className="text-xs font-semibold text-gray-500">粘贴 BibTeX 导入</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="@article{key, ...}"
        rows={4}
        className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none"
      />
      <button
        onClick={runImport}
        disabled={!text.trim()}
        className="w-full rounded bg-gray-700 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-40"
      >
        导入
      </button>
      {message && <p className="text-xs text-gray-600">{message}</p>}
    </div>
  );
}
