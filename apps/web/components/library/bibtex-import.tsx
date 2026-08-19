"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useReferenceLibrary } from "@/stores/reference-library";

// Broadsheet visual pass (T-06 Slice 6A). Presentation only — same
// textarea state, same `importBibtex` call, same result/error message
// text, same aria-label="BibTeX", same visible "Import BibTeX" text.
// See add-reference-form.tsx's FOCUS_RING comment: no `outline-none`
// here in any form — it permanently pins Tailwind v4's shared
// `--tw-outline-style` custom property to "none" and `outline-2` never
// resets it, so the ring never renders once `outline-none` has touched
// the element. Not needed anyway: Tailwind's own default for that
// property is already "solid".
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-[color:var(--color-accent)] focus-visible:outline-offset-2";

// T-06 Slice 9A: same `accessibleLabelPrefix` disambiguation as
// AddReferenceForm — default `undefined` leaves the Editor instance's
// aria-label="BibTeX" and visible "Import" button exactly unchanged.
export function BibtexImport({
  accessibleLabelPrefix,
}: { accessibleLabelPrefix?: string } = {}) {
  const label = (base: string) =>
    accessibleLabelPrefix ? `${accessibleLabelPrefix} ${base}` : base;
  const importBibtex = useReferenceLibrary((state) => state.importBibtex);
  const mutation = useReferenceLibrary((state) => state.mutation);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const runImport = async () => {
    const { imported, errors } = await importBibtex(text);
    setMessage(
      errors.length > 0
        ? `Imported ${imported}; ${errors.length} failed. ${errors.join(" ")}`
        : `Imported ${imported} reference(s).`,
    );
    if (imported > 0) setText("");
  };

  return (
    <div className="flex flex-col gap-[8px] border-b border-[var(--color-divider)] p-[12px]">
      <p className="m-0 text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
        Import BibTeX
      </p>
      <textarea
        aria-label={label("BibTeX")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={6}
        className={`w-full rounded-[var(--radius-md)] border border-[var(--color-neutral-300)] bg-[var(--color-bg)] px-[9px] py-[7px] font-mono text-[12px] text-[var(--color-text)] transition-colors ${FOCUS_RING}`}
      />
      <Button
        variant="secondary"
        onClick={() => void runImport()}
        disabled={!text.trim() || mutation !== "idle"}
        className="w-full"
        {...(accessibleLabelPrefix ? { "aria-label": label("Import") } : {})}
      >
        Import
      </Button>
      {message && (
        <p className="m-0 text-[12px] text-[var(--color-neutral-600)]">{message}</p>
      )}
    </div>
  );
}
