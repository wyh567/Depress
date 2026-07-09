"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportIssue } from "./export-ast";
import { runCompileExport, type CompileExportDeps } from "./compile-export";

// 状态机:idle → compiling → polling → success | error(校验失败归入
// error,附 issues)。逻辑全在 runCompileExport(纯函数,已单测);这里
// 只做 React 状态与下载副作用。
export type CompileExportUiState =
  | { phase: "idle" }
  | { phase: "compiling" }
  | { phase: "polling" }
  | { phase: "success" }
  | { phase: "error"; message: string; issues?: ExportIssue[] };

// 成功后自动触发下载:临时 <a> 点击,浏览器跟随 S3 签名 URL。
function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function useCompileExport(options: {
  getEditorJson: () => unknown;
  // 测试注入口;生产用默认值。
  deps?: Partial<CompileExportDeps>;
  download?: (url: string) => void;
}): { state: CompileExportUiState; exportPdf: () => Promise<void> } {
  const [state, setState] = useState<CompileExportUiState>({ phase: "idle" });
  // 卸载后停止轮询、不再 setState。
  const abortRef = useRef({ aborted: false });
  useEffect(() => {
    const signal = abortRef.current;
    signal.aborted = false;
    return () => {
      signal.aborted = true;
    };
  }, []);

  const { getEditorJson, deps, download } = options;
  const busyRef = useRef(false);
  const exportPdf = useCallback(async () => {
    // 重入保护:按钮禁用之外的第二道闸(如快速双击)。
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await doExport();
    } finally {
      busyRef.current = false;
    }

    async function doExport() {
      const signal = abortRef.current;
      const result = await runCompileExport(getEditorJson(), {
        apiUrl: process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001",
        signal,
        ...deps,
        onPhase: (phase) => {
          if (!signal.aborted) setState({ phase });
        },
      });
      if (signal.aborted) return;

      if (result.outcome === "success") {
        setState({ phase: "success" });
        (download ?? triggerDownload)(result.downloadUrl);
        return;
      }
      if (result.outcome === "validation_error") {
        setState({
          phase: "error",
          message: "AST_VALIDATION_FAILED",
          issues: result.issues,
        });
        return;
      }
      setState({ phase: "error", message: result.message });
    }
  }, [getEditorJson, deps, download]);

  return { state, exportPdf };
}
