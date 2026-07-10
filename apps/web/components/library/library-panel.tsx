"use client";

import { useReferenceLibrary } from "@/stores/reference-library";
import { AddReferenceForm } from "./add-reference-form";
import { BibtexImport } from "./bibtex-import";
import { DoiImport } from "./doi-import";
import { formatAuthors, formatYear } from "./format-reference";

export function LibraryPanel() {
  const items = useReferenceLibrary((state) => state.items);
  const remove = useReferenceLibrary((state) => state.remove);

  return (
    <aside className="flex min-h-0 flex-col border-l border-gray-200 bg-gray-50">
      <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700">
        引用库
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DoiImport />
        <BibtexImport />
        <AddReferenceForm />
        <ul className="p-3">
          {items.length === 0 && <li className="text-sm text-gray-400">暂无参考文献</li>}
          {items.map((item) => (
            <li
              key={item.id}
              className="group mb-2 rounded border border-gray-200 bg-white p-2 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-gray-800">
                  {formatAuthors(item)} {formatYear(item)}
                </span>
                <button
                  onClick={() => remove(item.id)}
                  className="shrink-0 text-xs text-gray-400 hover:text-red-600"
                  aria-label={`删除 ${item.id}`}
                >
                  删除
                </button>
              </div>
              <p className="truncate text-gray-600">{item.title}</p>
              <p className="text-xs text-gray-400">@{item.id}</p>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
