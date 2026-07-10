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
    inFlight.current = true;
    setPhase("loading");
    setMessage(null);
    try {
      const result = await runDoiImport(doi, {
        apiUrl: process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001",
        hasId: has,
        hasDoi,
        tryAdd,
      });
      if (result.phase === "success") {
        setPhase("success");
        setMessage(`已导入：${result.item.title}`);
        setDoi("");
      } else {
        setPhase(result.phase);
        setMessage(result.message);
      }
    } finally {
      inFlight.current = false;
    }
  };

  const inputCls =
    "w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none";
  const loading = phase === "loading";

  return (
    <div className="space-y-2 border-b border-gray-200 p-3">
      <p className="text-xs font-semibold text-gray-500">DOI 导入</p>
      <input
        value={doi}
        onChange={(e) => setDoi(e.target.value)}
        placeholder="10.1000/xyz 或 https://doi.org/…"
        disabled={loading}
        className={inputCls}
      />
      <button
        onClick={() => void submit()}
        disabled={loading || !doi.trim()}
        className="w-full rounded bg-emerald-700 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-40"
      >
        {loading ? "查询中…" : "从 Crossref 导入"}
      </button>
      {message && (
        <p
          className={
            phase === "success" ? "text-xs text-emerald-700" : "text-xs text-red-600"
          }
        >
          {message}
        </p>
      )}
    </div>
  );
}
