"use client";

import { useState } from "react";
import { exportValidatedAst, type ExportResult } from "./export-ast";

export function ExportAstButton({ getEditorJson }: { getEditorJson: () => unknown }) {
  const [result, setResult] = useState<ExportResult | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "failed">("idle");

  const handleExport = () => {
    const exported = exportValidatedAst(getEditorJson());
    setResult(exported);
    setCopyState("idle");

    if (exported.success) {
      navigator.clipboard
        .writeText(exported.formatted)
        .then(() => setCopyState("ok"))
        .catch(() => setCopyState("failed"));
    }
  };

  return (
    <div>
      <button
        onClick={handleExport}
        className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
      >
        导出 AST
      </button>

      {result?.success && (
        <div className="mt-2">
          {copyState === "ok" && <p className="text-xs text-green-600">已复制 AST JSON</p>}
          {copyState === "failed" && (
            <p className="text-xs text-amber-600">复制失败,请手动复制</p>
          )}
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-xs">
            {result.formatted}
          </pre>
        </div>
      )}

      {result && !result.success && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 p-2">
          <p className="text-xs font-semibold text-red-700">AST 校验失败</p>
          <ul className="mt-1 space-y-0.5 text-xs text-red-600">
            {result.issues.map((issue, i) => (
              <li key={i}>
                {issue.path}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
