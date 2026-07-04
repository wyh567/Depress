import { parseDoc, type Doc } from "@depress/ast";
import { pmDocToAst } from "./pm-doc-to-ast";

export interface ExportIssue {
  path: string;
  message: string;
}

export type ExportResult =
  | { success: true; ast: Doc; formatted: string }
  | { success: false; issues: ExportIssue[] };

// 导出边界:editor.getJSON() → pmDocToAst(...) → 再显式 safeParse 一次
// (Doc schema)。pmDocToAst 内部已经 parseDoc,但导出边界自己再校验一次
// 是有意为之——它不依赖被适配器的实现细节吞掉,任何未来改动只要破坏了
// AST 契约,这里都会独立发现并可见地报出 path/message。
export function exportValidatedAst(editorJson: unknown): ExportResult {
  let ast: Doc;
  try {
    ast = pmDocToAst(editorJson);
  } catch (error) {
    return { success: false, issues: extractIssues(error) };
  }

  const boundaryCheck = parseDoc(ast);
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
