import {
  collectCiteKeys,
  type CslItem,
  type Doc,
} from "@depress/ast";
import type { ExportIssue } from "./export-ast";

// Builds the compile-bound bibliography subset from a validated Doc and a
// snapshot of the local reference library. Pure: never mutates `library`.
//
// Behavior (Phase 3 TODO #2):
// A. citeKey in AST + library → include that CslItem
// B. repeated citeKey → one entry (first-occurrence order via collectCiteKeys)
// C. citeKey missing from library → validation failure (no silent omit)
// D. no citations → references: []

export type CitedReferencesResult =
  | { success: true; references: CslItem[] }
  | { success: false; issues: ExportIssue[] };

export function selectCitedReferences(
  doc: Doc,
  library: readonly CslItem[],
): CitedReferencesResult {
  const keys = collectCiteKeys(doc);
  if (keys.length === 0) {
    return { success: true, references: [] };
  }

  const byId = new Map(library.map((item) => [item.id, item]));
  const references: CslItem[] = [];
  const issues: ExportIssue[] = [];

  for (const [index, key] of keys.entries()) {
    const item = byId.get(key);
    if (!item) {
      issues.push({
        path: `references.${index}`,
        message: `缺少被引用文献: ${key}`,
      });
      continue;
    }
    references.push(item);
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }
  return { success: true, references };
}
