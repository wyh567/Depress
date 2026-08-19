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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-neutral-900)_45%,transparent)]">
      <div className="w-96 rounded-[var(--radius-lg)] border border-[var(--color-divider)] bg-[var(--color-bg)] p-[16px] shadow-[var(--shadow-lg)]">
        <h3 className="mb-[12px] text-[13.5px] font-semibold text-[var(--color-text)]">
          插入引用
        </h3>
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
          className="mb-[12px] w-full rounded-[var(--radius-md)] border border-[var(--color-neutral-300)] bg-[var(--color-bg)] px-[11px] py-[9px] text-[13.5px] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
        />
        <ul className="mb-[12px] max-h-60 overflow-y-auto">
          {filtered.length === 0 && (
            <li className="py-[16px] text-center text-[13px] text-[var(--color-neutral-500)]">
              {items.length === 0 ? "引用库为空,请先在右侧面板添加文献" : "无匹配结果"}
            </li>
          )}
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onConfirm(item.id)}
                className="w-full rounded-[var(--radius-md)] px-[8px] py-[6px] text-left text-[13px] hover:bg-[var(--color-accent-100)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
              >
                <span className="font-medium text-[var(--color-text)]">
                  {formatAuthors(item)} {formatYear(item)}
                </span>
                <span className="block truncate text-[var(--color-neutral-600)]">
                  {item.title}
                </span>
                <span className="text-[11px] text-[var(--color-neutral-500)]">@{item.id}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-[var(--radius-md)] px-[12px] py-[6px] text-[13px] text-[var(--color-neutral-600)] hover:bg-[var(--color-neutral-100)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
