import { parseDoc, type Doc, type DocMetadata } from "@depress/ast";
import { pmDocToAst } from "./pm-doc-to-ast";

export interface ExportIssue {
  path: string;
  message: string;
}

export type ExportResult =
  | { success: true; ast: Doc; formatted: string }
  | { success: false; issues: ExportIssue[] };

// 导出边界:editor.getJSON() → pmDocToAst(...) → 合并可选 metadata →
// 再显式 safeParse 一次(Doc schema)。metadata 来自文档元数据面板/store,
// 不是 Tiptap 正文的一部分。
export function exportValidatedAst(
  editorJson: unknown,
  metadata?: DocMetadata,
): ExportResult {
  let bodyAst: Doc;
  try {
    bodyAst = pmDocToAst(editorJson);
  } catch (error) {
    return { success: false, issues: extractIssues(error) };
  }

  const candidate =
    metadata === undefined
      ? bodyAst
      : { type: "doc" as const, metadata, content: bodyAst.content };

  const boundaryCheck = parseDoc(candidate);
  if (!boundaryCheck.success) {
    return {
      success: false,
      issues: boundaryCheck.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    };
  }

  return {
    success: true,
    ast: boundaryCheck.data,
    formatted: JSON.stringify(boundaryCheck.data, null, 2),
  };
}

function extractIssues(error: unknown): ExportIssue[] {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause && typeof cause === "object" && "issues" in cause) {
    const zodIssues = (cause as { issues: { path: (string | number)[]; message: string }[] })
      .issues;
    return zodIssues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
  }
  return [{ path: "(root)", message: error instanceof Error ? error.message : String(error) }];
}
