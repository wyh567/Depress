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

// Document metadata (Phase 3 TODO #1) ------------------------------------
// Semantic publication fields only — no fonts/colors/layout (Invariant #1).
// Affiliation numbering / author superscripts are template presentation.

const trimmedNonEmpty = z.string().trim().min(1);

export const DocAffiliationSchema = z
  .object({
    id: trimmedNonEmpty,
    name: trimmedNonEmpty,
  })
  .strict();
export type DocAffiliation = z.infer<typeof DocAffiliationSchema>;

export const DocAuthorSchema = z
  .object({
    name: trimmedNonEmpty,
    // Optional refs into metadata.affiliations[].id — validated on DocMetadata.
    affiliationIds: z.array(trimmedNonEmpty).optional(),
  })
  .strict();
export type DocAuthor = z.infer<typeof DocAuthorSchema>;

// Keywords: trim; reject blank; deterministic first-occurrence de-dupe
// (case-sensitive). Duplicates after trim are collapsed, not rejected.
const DocKeywordsSchema = z
  .array(trimmedNonEmpty)
  .transform((keywords) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const keyword of keywords) {
      if (seen.has(keyword)) continue;
      seen.add(keyword);
      out.push(keyword);
    }
    return out;
  });

export const DocMetadataSchema = z
  .object({
    title: trimmedNonEmpty.optional(),
    authors: z.array(DocAuthorSchema).optional(),
    affiliations: z.array(DocAffiliationSchema).optional(),
    abstract: trimmedNonEmpty.optional(),
    keywords: DocKeywordsSchema.optional(),
  })
  .strict()
  .superRefine((meta, ctx) => {
    const affiliations = meta.affiliations ?? [];
    const seenIds = new Set<string>();
    for (const [index, affiliation] of affiliations.entries()) {
      if (seenIds.has(affiliation.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["affiliations", index, "id"],
          message: `重复的 affiliation id: ${affiliation.id}`,
        });
        continue;
      }
      seenIds.add(affiliation.id);
    }

    const authors = meta.authors ?? [];
    for (const [authorIndex, author] of authors.entries()) {
      for (const [affIndex, affId] of (author.affiliationIds ?? []).entries()) {
        if (!seenIds.has(affId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["authors", authorIndex, "affiliationIds", affIndex],
            message: `未知的 affiliation id: ${affId}`,
          });
        }
      }
    }
  });
export type DocMetadata = z.infer<typeof DocMetadataSchema>;

// Document root ----------------------------------------------------------
// `metadata` is optional for backward compatibility: Phase 1/2 fixtures
// without metadata remain valid. IEEE title falls back when title absent.

export const DocSchema = z.object({
  type: z.literal("doc"),
  metadata: DocMetadataSchema.optional(),
  content: z.array(BlockNodeSchema),
});
export type Doc = z.infer<typeof DocSchema>;

export function parseDoc(input: unknown) {
  return DocSchema.safeParse(input);
}
