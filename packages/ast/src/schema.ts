import { z } from "zod";

// Inline nodes -----------------------------------------------------------

// Semantic marks only (italic for species names, bold for vectors, …).
// Visual marks (font-size, color, font-family) must never be added here —
// presentation is owned by templates at compile time (Invariant #1).
export const MarkSchema = z.enum(["bold", "italic"]);
export type Mark = z.infer<typeof MarkSchema>;

export const TextNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(MarkSchema).optional(),
});
export type TextNode = z.infer<typeof TextNodeSchema>;

// Citations store the citeKey only; formatted text is produced at compile
// time (Invariant #2). Trim matches CslItem.id / editor insertCitation so
// " smith2024 " cannot diverge from library id "smith2024". Case is preserved
// (matching remains case-sensitive).
const trimmedCiteKey = z.string().trim().min(1);
export const CitationNodeSchema = z.object({
  type: z.literal("citation"),
  citeKey: trimmedCiteKey,
});
export type CitationNode = z.infer<typeof CitationNodeSchema>;

export const InlineNodeSchema = z.discriminatedUnion("type", [
  TextNodeSchema,
  CitationNodeSchema,
]);
export type InlineNode = z.infer<typeof InlineNodeSchema>;

// Block nodes ------------------------------------------------------------

export const HeadingNodeSchema = z.object({
  type: z.literal("heading"),
  level: z.number().int().min(1).max(3),
  content: z.array(InlineNodeSchema),
});
export type HeadingNode = z.infer<typeof HeadingNodeSchema>;

export const ParagraphNodeSchema = z.object({
  type: z.literal("paragraph"),
  content: z.array(InlineNodeSchema),
});
export type ParagraphNode = z.infer<typeof ParagraphNodeSchema>;

// Stubs — fleshed out in a later phase.
export const FigureNodeSchema = z.object({
  type: z.literal("figure"),
});
export type FigureNode = z.infer<typeof FigureNodeSchema>;

export const TableNodeSchema = z.object({
  type: z.literal("table"),
});
export type TableNode = z.infer<typeof TableNodeSchema>;

export const BlockNodeSchema = z.discriminatedUnion("type", [
  HeadingNodeSchema,
  ParagraphNodeSchema,
  FigureNodeSchema,
  TableNodeSchema,
]);
export type BlockNode = z.infer<typeof BlockNodeSchema>;

// Document root ----------------------------------------------------------

export const DocSchema = z.object({
  type: z.literal("doc"),
  content: z.array(BlockNodeSchema),
});
export type Doc = z.infer<typeof DocSchema>;

export function parseDoc(input: unknown) {
  return DocSchema.safeParse(input);
}
