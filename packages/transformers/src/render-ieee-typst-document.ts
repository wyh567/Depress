import { parseDoc } from "@depress/ast";
import { IEEE_TEMPLATE, IEEE_TEMPLATE_PLACEHOLDERS } from "@depress/templates";
import { AstValidationError, docToTypst, escapeTypst } from "./ast-to-typst";
import type { Doc } from "@depress/ast";
import { TYPST_BIBLIOGRAPHY_FILE } from "./typst-compile-project";

// Fallback only for backward-compatible docs that omit metadata.title
// (Phase 1/2 fixtures). Never a caller-supplied compile parameter —
// AST remains the single content source of truth (Invariant #3).
const FALLBACK_TITLE = "DePress Draft";

// Injects the validated AST's Typst body into the built-in IEEE template
// (architecture.md §3 step 2). Takes content only — no template, style, or
// presentation parameters are accepted (Invariant #1; templates are
// immutable code-reviewed assets, §5.4).
export function renderIeeeTypstDocument(input: unknown): string {
  const parsed = parseDoc(input);
  if (!parsed.success) {
    throw new AstValidationError(parsed.error.issues);
  }

  return renderValidatedIeeeTypstDocument(parsed.data, false);
}

// Package-internal template renderer. The bibliography mount is a boolean,
// not caller-supplied Typst, and expands to one immutable directive.
export function renderValidatedIeeeTypstDocument(
  doc: Doc,
  withBibliography: boolean,
): string {
  const title = doc.metadata?.title ?? FALLBACK_TITLE;
  const body = docToTypst(doc);
  const bibliography = withBibliography
    ? `#bibliography("${TYPST_BIBLIOGRAPHY_FILE}", title: [References], style: "ieee")`
    : "";

  // Replacer functions so `$` sequences in content are never treated as
  // String.replace substitution patterns.
  return IEEE_TEMPLATE.replace(
    IEEE_TEMPLATE_PLACEHOLDERS.title,
    () => escapeTypst(title),
  )
    .replace(IEEE_TEMPLATE_PLACEHOLDERS.body, () => body)
    .replace(IEEE_TEMPLATE_PLACEHOLDERS.bibliography, () => bibliography);
}
