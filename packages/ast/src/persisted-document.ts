import { z } from "zod";
import { DocMetadataSchema } from "./schema";

const PersistedPmMarkSchema = z
  .object({
    type: z.enum(["bold", "italic"]),
  })
  .strict();

const PersistedPmTextNodeSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1),
    marks: z.array(PersistedPmMarkSchema).min(1).optional(),
  })
  .strict();

const PersistedPmCitationNodeSchema = z
  .object({
    type: z.literal("citation"),
    attrs: z
      .object({
        citeKey: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

const PersistedPmInlineNodeSchema = z.union([
  PersistedPmTextNodeSchema,
  PersistedPmCitationNodeSchema,
]);

const PersistedPmParagraphNodeSchema = z
  .object({
    type: z.literal("paragraph"),
    content: z.array(PersistedPmInlineNodeSchema).optional(),
  })
  .strict();

const PersistedPmHeadingNodeSchema = z
  .object({
    type: z.literal("heading"),
    attrs: z
      .object({
        level: z.number().int().min(1).max(3),
      })
      .strict(),
    content: z.array(PersistedPmInlineNodeSchema).optional(),
  })
  .strict();

export const PersistedPmDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.union([PersistedPmParagraphNodeSchema, PersistedPmHeadingNodeSchema])),
  })
  .strict();
export type PersistedPmDocument = z.infer<typeof PersistedPmDocumentSchema>;

export const PersistedDocumentEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    editor: PersistedPmDocumentSchema,
    metadata: DocMetadataSchema.optional(),
  })
  .strict();
export type PersistedDocumentEnvelope = z.infer<typeof PersistedDocumentEnvelopeSchema>;
