import { IEEE_TEMPLATE, IEEE_TEMPLATE_PLACEHOLDERS } from "@depress/templates";
import { astToTypst, escapeTypst } from "./ast-to-typst";

// TODO(metadata): switch to Doc metadata.title once @depress/ast grows a
// document metadata block. Until then the title is a fixed internal
// placeholder — never a caller-supplied parameter (AST stays the single
// content source of truth).
const PLACEHOLDER_TITLE = "DePress Draft";

// Injects the validated AST's Typst body into the built-in IEEE template
// (architecture.md §3 step 2). Takes content only — no template, style, or
// presentation parameters are accepted (Invariant #1; templates are
// immutable code-reviewed assets, §5.4).
export function renderIeeeTypstDocument(input: unknown): string {
  const body = astToTypst(input);
  // Replacer functions so `$` sequences in content are never treated as
  // String.replace substitution patterns.
  return IEEE_TEMPLATE.replace(
    IEEE_TEMPLATE_PLACEHOLDERS.title,
    () => escapeTypst(PLACEHOLDER_TITLE),
  ).replace(IEEE_TEMPLATE_PLACEHOLDERS.body, () => body);
}
