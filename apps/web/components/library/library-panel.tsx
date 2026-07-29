"use client";

import { useState } from "react";
import { useReferenceLibrary } from "@/stores/reference-library";
import { AddReferenceForm } from "./add-reference-form";
import { BibtexImport } from "./bibtex-import";
import { formatAuthors, formatYear } from "./format-reference";

export function LibraryPanel({
  confirmDelete = (message) => window.confirm(message),
}: {
  confirmDelete?: (message: string) => boolean;
}) {
  const items = useReferenceLibrary((state) => state.items);
  const loading = useReferenceLibrary((state) => state.loading);
  const mutation = useReferenceLibrary((state) => state.mutation);
  const error = useReferenceLibrary((state) => state.error);
  const update = useReferenceLibrary((state) => state.update);
  const remove = useReferenceLibrary((state) => state.remove);
  const [editingId, setEditingId] = useState<string>();
  const [editingTitle, setEditingTitle] = useState("");

  const saveEdit = async () => {
    const item = items.find((candidate) => candidate.id === editingId);
    if (!item) return;
    const saved = await update(item.id, { ...item, title: editingTitle });
    if (saved) setEditingId(undefined);
  };

  const deleteItem = async (id: string) => {
    if (!confirmDelete("Delete this reference? Existing citations will remain and may become unresolved.")) return;
    await remove(id);
  };

  return (
    <aside className="flex min-h-0 flex-col border-l border-gray-200 bg-gray-50">
      <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700">Reference library</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BibtexImport />
        <AddReferenceForm />
        {loading && <p role="status" className="px-3 py-2 text-sm">Loading references…</p>}
        {error && <p role="alert" className="px-3 py-2 text-sm text-red-700">{error}</p>}
        <ul className="p-3">
          {!loading && items.length === 0 && <li className="text-sm text-gray-400">No references yet.</li>}
          {items.map((item) => (
            <li key={item.id} className="mb-2 rounded border border-gray-200 bg-white p-2 text-sm">
              {editingId === item.id ? (
                <div className="space-y-2">
                  <input aria-label={`Edit title ${item.id}`} value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} className="w-full rounded border px-2 py-1" />
                  <button type="button" onClick={() => void saveEdit()} disabled={mutation !== "idle"}>Save reference</button>
                  <button type="button" onClick={() => setEditingId(undefined)}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-gray-800">{formatAuthors(item)} {formatYear(item)}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setEditingId(item.id); setEditingTitle(item.title); }} aria-label={`Edit ${item.id}`}>Edit</button>
                      <button type="button" onClick={() => void deleteItem(item.id)} disabled={mutation !== "idle"} aria-label={`Delete ${item.id}`}>Delete</button>
                    </div>
                  </div>
                  <p className="truncate text-gray-600">{item.title}</p>
                  <p className="text-xs text-gray-400">@{item.id}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
