import { parseDoc } from "@depress/ast";
import { IEEE_TEMPLATE, IEEE_TEMPLATE_PLACEHOLDERS } from "@depress/templates";
import { AstValidationError, docToTypst, escapeTypst } from "./ast-to-typst";

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

  const title = parsed.data.metadata?.title ?? FALLBACK_TITLE;
  const body = docToTypst(parsed.data);

  // Replacer functions so `$` sequences in content are never treated as
  // String.replace substitution patterns.
  return IEEE_TEMPLATE.replace(
    IEEE_TEMPLATE_PLACEHOLDERS.title,
    () => escapeTypst(title),
  ).replace(IEEE_TEMPLATE_PLACEHOLDERS.body, () => body);
}
