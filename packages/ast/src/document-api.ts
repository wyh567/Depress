import { z } from "zod";
import {
  PersistedDocumentEnvelopeSchema,
  type PersistedDocumentEnvelope,
} from "./persisted-document";

export const EmptyPersistedDocumentEnvelope: PersistedDocumentEnvelope = {
  schemaVersion: 1,
  editor: {
    type: "doc",
    content: [{ type: "paragraph" }],
  },
  metadata: {
    title: "Untitled",
  },
};

export const DocumentIdSchema = z.string().uuid();

export const CreateDocumentRequestSchema = z.object({}).strict();

export const SaveDocumentRequestSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    envelope: PersistedDocumentEnvelopeSchema,
  })
  .strict();
export type SaveDocumentRequest = z.infer<typeof SaveDocumentRequestSchema>;

const DocumentTimestampSchema = z.string().datetime({ offset: true });

export const DocumentSummarySchema = z
  .object({
    id: DocumentIdSchema,
    title: z.string(),
    revision: z.number().int().positive(),
    updatedAt: DocumentTimestampSchema,
  })
  .strict();
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const DocumentResourceSchema = z
  .object({
    id: DocumentIdSchema,
    envelope: PersistedDocumentEnvelopeSchema,
    revision: z.number().int().positive(),
    createdAt: DocumentTimestampSchema,
    updatedAt: DocumentTimestampSchema,
  })
  .strict();
export type DocumentResource = z.infer<typeof DocumentResourceSchema>;

export const DocumentListResponseSchema = z.array(DocumentSummarySchema);

export const RevisionConflictResponseSchema = z
  .object({
    currentRevision: z.number().int().positive(),
  })
  .strict();
