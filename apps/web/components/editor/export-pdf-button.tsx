"use client";

import { useState } from "react";
import {
  CompileTemplateIdSchema,
  type CompileTemplateId,
} from "@depress/ast";
import type { CompileExportDeps } from "./compile-export";
import { useCompileExport } from "./use-compile-export";

const TEMPLATE_OPTIONS = [
  { id: "ieee", label: "IEEE" },
  { id: "elsevier", label: "Elsevier" },
  { id: "gbt7714", label: "GB/T 7714" },
] as const satisfies readonly { id: CompileTemplateId; label: string }[];

// 失败码 → 用户可读文案;未知码兜底展示原码,绝不吞掉。
const ERROR_TEXT: Record<string, string> = {
  AST_VALIDATION_FAILED: "文档未通过校验,已中止导出",
  EXPORT_TIMEOUT: "编译超时(60 秒),请稍后重试",
  NETWORK_ERROR: "无法连接编译服务",
  QUEUE_UNAVAILABLE: "编译队列不可用,请稍后重试",
  INVALID_AST: "服务端拒绝了文档内容",
  COMPILE_FAILED: "PDF 编译失败",
  UPLOAD_FAILED: "编译产物上传失败",
};

export function ExportPdfButton({
  getEditorJson,
  deps,
  download,
}: {
  getEditorJson: () => unknown;
  // 测试注入口(mock fetch/sleep/download);生产不传。
  deps?: Omit<Partial<CompileExportDeps>, "templateId">;
  download?: (url: string) => void;
}) {
  const [templateId, setTemplateId] = useState<CompileTemplateId>("ieee");
  const { state, exportPdf } = useCompileExport({
    getEditorJson,
    templateId,
    ...(deps ? { deps } : {}),
    ...(download ? { download } : {}),
  });
  const busy = state.phase === "compiling" || state.phase === "polling";
  const templateLabel = TEMPLATE_OPTIONS.find((option) => option.id === templateId)?.label;

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="sr-only" htmlFor="export-template">
        PDF template
      </label>
      <select
        id="export-template"
        aria-label="PDF template"
        value={templateId}
        disabled={busy}
        onChange={(event) => {
          const parsed = CompileTemplateIdSchema.safeParse(event.currentTarget.value);
          if (parsed.success) setTemplateId(parsed.data);
        }}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 disabled:cursor-not-allowed disabled:bg-gray-100"
      >
        {TEMPLATE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => void exportPdf()}
        disabled={busy}
        className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"
            />
            {state.phase === "compiling" ? "提交中…" : "编译中…"}
          </span>
        ) : (
          `Export PDF (${templateLabel})`
        )}
      </button>

      {state.phase === "success" && <p className="text-xs text-green-600">PDF 已生成,下载已开始</p>}

      {state.phase === "error" && (
        <div
          role="alert"
          className="max-w-xs rounded border border-red-200 bg-red-50 p-2 text-right"
        >
          <p className="text-xs font-semibold text-red-700">
            {ERROR_TEXT[state.message] ?? `导出失败(${state.message})`}
          </p>
          {state.issues && (
            <ul className="mt-1 space-y-0.5 text-xs text-red-600">
              {state.issues.map((issue, i) => (
                <li key={i}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
