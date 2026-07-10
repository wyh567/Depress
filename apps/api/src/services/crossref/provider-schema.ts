import { z } from "zod";

// Untrusted Crossref works-by-DOI envelope. Only fields consumed by the
// mapper are validated; unrelated keys are allowed (API evolution).

const CrossrefDatePartsSchema = z
  .object({
    "date-parts": z.array(z.array(z.number().int())).optional(),
  })
  .passthrough();

const CrossrefAuthorSchema = z
  .object({
    family: z.string().optional(),
    given: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

export const CrossrefWorkMessageSchema = z
  .object({
    DOI: z.string().optional(),
    type: z.string().optional(),
    title: z.array(z.string()).optional(),
    author: z.array(CrossrefAuthorSchema).optional(),
    "container-title": z.array(z.string()).optional(),
    volume: z.union([z.string(), z.number()]).optional(),
    issue: z.union([z.string(), z.number()]).optional(),
    page: z.string().optional(),
    publisher: z.string().optional(),
    URL: z.string().optional(),
    issued: CrossrefDatePartsSchema.optional(),
    published: CrossrefDatePartsSchema.optional(),
    "published-print": CrossrefDatePartsSchema.optional(),
    "published-online": CrossrefDatePartsSchema.optional(),
  })
  .passthrough();
export type CrossrefWorkMessage = z.infer<typeof CrossrefWorkMessageSchema>;

export const CrossrefWorkEnvelopeSchema = z
  .object({
    status: z.string(),
    "message-type": z.string().optional(),
    message: CrossrefWorkMessageSchema,
  })
  .passthrough();
export type CrossrefWorkEnvelope = z.infer<typeof CrossrefWorkEnvelopeSchema>;
