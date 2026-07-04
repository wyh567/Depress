"use client";

import { useMemo, useState } from "react";
import type { CslItem } from "@depress/ast";
import { useReferenceLibrary } from "@/stores/reference-library";
import { formatAuthors, formatYear } from "@/components/library/format-reference";

function matches(item: CslItem, query: string): boolean {
  const q = query.toLowerCase();
  return (
    item.id.toLowerCase().includes(q) ||
    item.title.toLowerCase().includes(q) ||
    formatAuthors(item).toLowerCase().includes(q)
  );
}

export function CitationPrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: (citeKey: string) => void;
  onCancel: () => void;
}) {
  const items = useReferenceLibrary((state) => state.items);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => (query.trim() ? items.filter((i) => matches(i, query.trim())) : items),
    [items, query]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-lg bg-white p-4 shadow-lg">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">插入引用</h3>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && filtered.length === 1 && filtered[0]) {
              onConfirm(filtered[0].id);
            }
          }}
          placeholder="按 citeKey / 标题 / 作者搜索"
          className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        <ul className="mb-3 max-h-60 overflow-y-auto">
          {filtered.length === 0 && (
            <li className="py-4 text-center text-sm text-gray-400">
              {items.length === 0 ? "引用库为空,请先在右侧面板添加文献" : "无匹配结果"}
            </li>
          )}
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onConfirm(item.id)}
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-blue-50"
              >
                <span className="font-medium text-gray-800">
                  {formatAuthors(item)} {formatYear(item)}
                </span>
                <span className="block truncate text-gray-500">{item.title}</span>
                <span className="text-xs text-gray-400">@{item.id}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
