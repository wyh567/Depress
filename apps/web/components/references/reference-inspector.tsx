"use client";

import type { CslItem } from "@depress/ast";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatAuthors, formatYear } from "@/components/library/format-reference";
import { useReferenceLibrary } from "@/stores/reference-library";

const TYPE_LABELS: Record<string, string> = {
  "article-journal": "Journal article",
  book: "Book",
  "paper-conference": "Conference paper",
  chapter: "Chapter",
  thesis: "Thesis",
  webpage: "Web page",
  document: "Other document",
};

// Broadsheet References inspector (T-06 Slice 6). Real fields only:
// citeKey, author, title, year, type. Edit/Delete call the exact same
// store actions LibraryPanel already uses (`update`, `remove`) — same
// title-only edit affordance, same optimistic/rollback semantics, no new
// store, no rewritten identity handling. This is a *separate* local
// editing-state instance from LibraryPanel's own (own useState, own
// mount/unmount lifecycle) — intentional, see references-view.tsx's file
// header for why that's an accepted trade-off.
export function ReferenceInspector({
  selected,
  confirmDelete = (message) => window.confirm(message),
}: {
  selected: CslItem | undefined;
  confirmDelete?: (message: string) => boolean;
}) {
  const mutation = useReferenceLibrary((state) => state.mutation);
  const update = useReferenceLibrary((state) => state.update);
  const remove = useReferenceLibrary((state) => state.remove);
  const [editing, setEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");

  if (!selected) {
    return (
      <div className="flex h-full min-h-0 flex-col items-start gap-[6px] p-[16px]">
        <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
          Selected reference
        </h2>
        <p className="m-0 text-[13px] text-[var(--color-neutral-500)]">
          Select a reference to view it here.
        </p>
      </div>
    );
  }

  const missingYear = selected.issued?.["date-parts"]?.[0]?.[0] === undefined;

  const startEdit = () => {
    setEditingTitle(selected.title);
    setEditing(true);
  };

  const saveEdit = async () => {
    const saved = await update(selected.id, { ...selected, title: editingTitle });
    if (saved) setEditing(false);
  };

  const deleteItem = async () => {
    if (
      !confirmDelete(
        "Delete this reference? Existing citations will remain and may become unresolved.",
      )
    ) {
      return;
    }
    await remove(selected.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-[16px] p-[16px]">
      <div>
        <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
          Reference @{selected.id}
        </h2>
        {editing ? (
          <input
            aria-label={`Edit title ${selected.id}`}
            value={editingTitle}
            onChange={(event) => setEditingTitle(event.target.value)}
            className="mt-[6px] w-full rounded-[var(--radius-md)] border border-[var(--color-neutral-300)] bg-[var(--color-bg)] px-[10px] py-[8px] text-[14px] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
          />
        ) : (
          <p className="m-0 mt-[6px] text-[16px] leading-[1.3] font-semibold text-[var(--color-text)]">
            {selected.title}
          </p>
        )}
      </div>

      <dl className="m-0 flex flex-col gap-[10px]">
        <div>
          <dt className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
            Author
          </dt>
          <dd className="m-0 text-[13.5px] text-[var(--color-text)]">{formatAuthors(selected)}</dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
            Year
          </dt>
          <dd className="m-0 text-[13.5px] text-[var(--color-text)]">
            {missingYear ? (
              <span className="text-[var(--color-accent-2-700)]">Missing</span>
            ) : (
              formatYear(selected)
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
            Type
          </dt>
          <dd className="m-0 text-[13.5px] text-[var(--color-text)]">
            {TYPE_LABELS[selected.type] ?? selected.type}
          </dd>
        </div>
      </dl>

      {editing ? (
        <div className="flex gap-[8px]">
          <Button variant="primary" onClick={() => void saveEdit()} disabled={mutation !== "idle"}>
            Save reference
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex gap-[8px]">
          <Button
            variant="secondary"
            onClick={startEdit}
            aria-label={`Edit ${selected.id}`}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            onClick={() => void deleteItem()}
            disabled={mutation !== "idle"}
            aria-label={`Delete ${selected.id}`}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}
