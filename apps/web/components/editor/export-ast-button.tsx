"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useDocumentMetadata } from "@/stores/document-metadata";
import { exportValidatedAst, type ExportResult } from "./export-ast";

export function ExportAstButton({ getEditorJson }: { getEditorJson: () => unknown }) {
  const [result, setResult] = useState<ExportResult | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "failed">("idle");

  const handleExport = () => {
    const metadata = useDocumentMetadata.getState().toMetadataCandidate();
    const exported =
      metadata === undefined
        ? exportValidatedAst(getEditorJson())
        : exportValidatedAst(getEditorJson(), metadata);
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
      <Button variant="secondary" onClick={handleExport} className="w-full">
        导出 AST
      </Button>

      {result?.success && (
        <div className="mt-[10px]">
          {copyState === "ok" && (
            <p className="text-[12px] text-[var(--color-accent-700)]">已复制 AST JSON</p>
          )}
          {copyState === "failed" && (
            <p className="text-[12px] text-[var(--color-accent-2-700)]">复制失败,请手动复制</p>
          )}
          <pre className="mt-[6px] max-h-64 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-neutral-100)] p-[8px] text-[11px]">
            {result.formatted}
          </pre>
        </div>
      )}

      {result && !result.success && (
        <div className="mt-[10px] rounded-[var(--radius-md)] border border-[var(--color-accent-2-300)] bg-[var(--color-accent-2-100)] p-[8px]">
          <p className="text-[12px] font-semibold text-[var(--color-accent-2-700)]">
            AST 校验失败
          </p>
          <ul className="mt-[4px] space-y-[2px] text-[11px] text-[var(--color-accent-2-700)]">
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
