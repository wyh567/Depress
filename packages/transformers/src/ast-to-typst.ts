import {
  parseDoc,
  type Doc,
  type BlockNode,
  type InlineNode,
  type TextNode,
} from "@depress/ast";

// Pure AST → Typst markup transformer (architecture.md §3 step 1).
// Emits content markup only; all presentation is owned by the journal
// template at compile time (Invariant #1). No I/O.

// Characters Typst interprets as markup/code when they appear in plain text.
const TYPST_SPECIAL = /[\\#$*_`@<>\[\]~/-]/g;

export function escapeTypst(text: string): string {
  return text.replace(TYPST_SPECIAL, (ch) => `\\${ch}`);
}

// Escapes for a Typst string literal ("..."), not markup text: only
// backslash and double quote are special there.
export function escapeTypstString(text: string): string {
  return text.replace(/[\\"]/g, (ch) => `\\${ch}`);
}

function renderText(node: TextNode): string {
  let out = escapeTypst(node.text);
  const marks = node.marks ?? [];
  // Wrap innermost-first in schema order for stable output.
  if (marks.includes("italic")) out = `_${out}_`;
  if (marks.includes("bold")) out = `*${out}*`;
  return out;
}

function renderInline(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return renderText(node);
    case "citation":
      // citeKey only — numbering/author-year formatting happens when the
      // template + bibliography are compiled (Invariant #2). label("…") is
      // used because <…> label syntax can't hold arbitrary BibTeX/CSL ids.
      return `#cite(label("${escapeTypstString(node.citeKey)}"))`;
  }
}

function renderInlines(content: InlineNode[]): string {
  return content.map(renderInline).join("");
}

function renderBlock(node: BlockNode): string {
  switch (node.type) {
    case "heading":
      return `${"=".repeat(node.level)} ${renderInlines(node.content)}`;
    case "paragraph":
      return renderInlines(node.content);
    case "figure":
      return "// TODO(figure): stub — fleshed out in a later phase";
    case "table":
      return "// TODO(table): stub — fleshed out in a later phase";
  }
}

export function docToTypst(doc: Doc): string {
  return doc.content.map(renderBlock).join("\n\n") + "\n";
}

export class AstValidationError extends Error {
  constructor(public readonly issues: unknown) {
    super("Invalid DePress AST: input rejected by @depress/ast schema");
    this.name = "AstValidationError";
  }
}

export function astToTypst(input: unknown): string {
  const result = parseDoc(input);
  if (!result.success) {
    throw new AstValidationError(result.error.issues);
  }
  return docToTypst(result.data);
}
