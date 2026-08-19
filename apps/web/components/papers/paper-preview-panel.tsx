"use client";

import type { DocumentSummary } from "@depress/ast";
import { Button } from "@/components/ui/button";

export interface PaperPreviewPanelProps {
  selected: DocumentSummary | undefined;
  onOpenEditor: (documentId: string) => void;
}

// Broadsheet Papers Dashboard inspector (T-06 Slice 5). Deliberately
// sparse: the design shows Format / References / PDF Ready / pages / file
// size / "Compiled N ago" — none of which this application has a data
// source for from DocumentSummary ({id, title, revision, updatedAt}
// only). Per owner instruction, a sparse real inspector beats a fabricated
// one; only title/revision/updated + a real "Open Editor" action are
// shown.
export function PaperPreviewPanel({ selected, onOpenEditor }: PaperPreviewPanelProps) {
  if (!selected) {
    return (
      <div className="flex h-full min-h-0 flex-col items-start gap-[6px] p-[16px]">
        <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
          Selected paper
        </h2>
        <p className="m-0 text-[13px] text-[var(--color-neutral-500)]">
          Select a paper to preview it here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-[16px] p-[16px]">
      <div>
        <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
          Selected paper
        </h2>
        <p className="m-0 mt-[6px] text-[16px] leading-[1.3] font-semibold text-[var(--color-text)]">
          {selected.title}
        </p>
      </div>

      <dl className="m-0 flex flex-col gap-[10px]">
        <div>
          <dt className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
            Revision
          </dt>
          <dd className="m-0 text-[13.5px] text-[var(--color-text)]">{selected.revision}</dd>
        </div>
        <div>
          <dt className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
            Updated
          </dt>
          <dd className="m-0 text-[13.5px] text-[var(--color-text)]">
            {new Date(selected.updatedAt).toLocaleString()}
          </dd>
        </div>
      </dl>

      <Button variant="primary" onClick={() => onOpenEditor(selected.id)} className="w-full">
        Open Editor
      </Button>
    </div>
  );
}
