"use client";

import { useState } from "react";

// 临时 UI:TODO #6 会替换为引用库搜索
export function CitationPrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: (citeKey: string) => void;
  onCancel: () => void;
}) {
  const [citeKey, setCiteKey] = useState("");
  const trimmed = citeKey.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-80 rounded-lg bg-white p-4 shadow-lg">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">插入引用</h3>
        <input
          autoFocus
          value={citeKey}
          onChange={(e) => setCiteKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed) onConfirm(trimmed);
            if (e.key === "Escape") onCancel();
          }}
          placeholder="citeKey,如 smith2024"
          className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            取消
          </button>
          <button
            onClick={() => trimmed && onConfirm(trimmed)}
            disabled={!trimmed}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
