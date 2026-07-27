"use client";

import { useRef, useState } from "react";
import { useReferenceLibrary } from "@/stores/reference-library";
import { runDoiImport, type DoiImportPhase } from "./run-doi-import";

export function DoiImport() {
  const has = useReferenceLibrary((state) => state.has);
  const hasDoi = useReferenceLibrary((state) => state.hasDoi);
  const tryAdd = useReferenceLibrary((state) => state.tryAdd);
  const [doi, setDoi] = useState("");
  const [phase, setPhase] = useState<DoiImportPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current || phase === "loading") return;
    const referenceSession = useReferenceLibrary.getState().captureSession();
    if (!referenceSession) {
      setPhase("error");
      setMessage("Reference library session is unavailable.");
      return;
    }
    inFlight.current = true;
    setPhase("loading");
    setMessage(null);
    try {
      const result = await runDoiImport(doi, {
        apiUrl: process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001",
        hasId: has,
        hasDoi,
        tryAdd: (item) => tryAdd(item, undefined, referenceSession),
      });
      setPhase(result.phase);
      if (result.phase === "success") {
        setMessage(`Imported: ${result.item.title}`);
        setDoi("");
      } else {
        setMessage(result.message);
      }
    } finally {
      inFlight.current = false;
    }
  };

  const loading = phase === "loading";
  return (
    <div className="space-y-2 border-b border-gray-200 p-3">
      <p className="text-xs font-semibold text-gray-500">Import by DOI</p>
      <input
        aria-label="DOI"
        value={doi}
        onChange={(event) => setDoi(event.target.value)}
        disabled={loading}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <button type="button" onClick={() => void submit()} disabled={loading || !doi.trim()} className="w-full rounded bg-emerald-700 py-1.5 text-sm text-white">
        {loading ? "Looking up…" : "Import from Crossref"}
      </button>
      {message && <p role={phase === "success" ? "status" : "alert"} className="text-xs">{message}</p>}
    </div>
  );
}
