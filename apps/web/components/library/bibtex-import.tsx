"use client";

import { useState } from "react";
import { useReferenceLibrary } from "@/stores/reference-library";

export function BibtexImport() {
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
    <div className="space-y-2 border-b border-gray-200 p-3">
      <p className="text-xs font-semibold text-gray-500">Import BibTeX</p>
      <textarea aria-label="BibTeX" value={text} onChange={(event) => setText(event.target.value)} rows={4} className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs" />
      <button type="button" onClick={() => void runImport()} disabled={!text.trim() || mutation !== "idle"} className="w-full rounded bg-gray-700 py-1.5 text-sm text-white">
        Import
      </button>
      {message && <p className="text-xs text-gray-600">{message}</p>}
    </div>
  );
}
