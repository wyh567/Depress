import { z } from "zod";
import { CslItemSchema, type CslItem } from "./csl";
import { DocSchema, type Doc } from "./schema";

// Compile contracts live in @depress/ast (Invariant #3): they cross
// Web → API → Queue → Worker. Every boundary re-parses these schemas;
// upstream validation is never trusted.

// Phase 3 TODO #5: built-in immutable templates share this compile contract.
export const CompileTemplateIdSchema = z.enum(["ieee", "elsevier"]);
export type CompileTemplateId = z.infer<typeof CompileTemplateIdSchema>;

export const CompileFormatSchema = z.literal("pdf");
export type CompileFormat = z.infer<typeof CompileFormatSchema>;

// Reject duplicate CslItem.id in a single compile payload — ambiguous
// bibliography identity would break TODO #3 citation resolution.
function uniqueReferenceIds(
  references: z.infer<typeof CslItemSchema>[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, item] of references.entries()) {
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["references", index, "id"],
        message: `重复的文献 id: ${item.id}`,
      });
      continue;
    }
    seen.add(item.id);
  }
}

// Cross-field referential integrity for every compile boundary. Web-side
// filtering is only a convenience: direct API clients and corrupted queue
// payloads must also provide each cited item. Unused references are legal;
// the transformer emits only the first-occurrence cited subset.
function citationReferenceIntegrity(
  doc: Doc,
  references: readonly CslItem[],
  ctx: z.RefinementCtx,
): void {
  const referenceIds = new Set(references.map((item) => item.id));
  for (const citeKey of collectCiteKeys(doc)) {
    if (referenceIds.has(citeKey)) continue;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["references"],
      message: `Missing reference for citeKey: ${citeKey}`,
    });
  }
}

function validateCompileReferences(
  data: { ast: Doc; references: CslItem[] },
  ctx: z.RefinementCtx,
): void {
  uniqueReferenceIds(data.references, ctx);
  citationReferenceIntegrity(data.ast, data.references, ctx);
}

// HTTP POST /compile body. `references` is required (send [] when the doc
// cites nothing). Missing field → validation failure — no silent default
// that would hide a broken client. `.strict()` rejects unknown keys
// (e.g. fontSize) so presentation never sneaks into the compile contract.
export const CompileRequestSchema = z
  .object({
    ast: DocSchema,
    references: z.array(CslItemSchema),
    templateId: CompileTemplateIdSchema,
    format: CompileFormatSchema,
  })
  .strict()
  .superRefine(validateCompileReferences);
export type CompileRequest = z.infer<typeof CompileRequestSchema>;

// BullMQ job data. Same content fields as the request plus the job id
// assigned by the API. Worker re-parses this after dequeue.
export const CompileJobPayloadSchema = z
  .object({
    jobId: z.string().uuid(),
    ast: DocSchema,
    references: z.array(CslItemSchema),
    templateId: CompileTemplateIdSchema,
    format: CompileFormatSchema,
  })
  .strict()
  .superRefine(validateCompileReferences);
export type CompileJobPayload = z.infer<typeof CompileJobPayloadSchema>;

// First-occurrence order of citation citeKeys in document order.
// Duplicates are collapsed — bibliography subset builders rely on this.
export function collectCiteKeys(doc: Doc): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const block of doc.content) {
    if (block.type !== "heading" && block.type !== "paragraph") continue;
    for (const inline of block.content) {
      if (inline.type !== "citation") continue;
      if (seen.has(inline.citeKey)) continue;
      seen.add(inline.citeKey);
      keys.push(inline.citeKey);
    }
  }
  return keys;
}
