import { describe, expect, it } from "vitest";
import {
  CreateDocumentRequestSchema,
  DocumentListResponseSchema,
  DocumentResourceSchema,
  EmptyPersistedDocumentEnvelope,
  RevisionConflictResponseSchema,
  SaveDocumentRequestSchema,
} from "./document-api";
import { PersistedDocumentEnvelopeSchema } from "./persisted-document";

describe("document API contracts", () => {
  it("provides a code-owned valid empty editable document", () => {
    expect(PersistedDocumentEnvelopeSchema.parse(EmptyPersistedDocumentEnvelope)).toEqual(
      EmptyPersistedDocumentEnvelope,
    );
  });

  it("rejects owner fields and malformed persisted envelopes", () => {
    expect(CreateDocumentRequestSchema.safeParse({ ownerId: "attacker" }).success).toBe(false);
    expect(
      SaveDocumentRequestSchema.safeParse({
        expectedRevision: 1,
        envelope: {
          schemaVersion: 1,
          editor: { type: "doc", content: [], extra: "not-allowed" },
        },
      }).success,
    ).toBe(false);
  });

  it("keeps list, resource, and conflict responses narrow", () => {
    const timestamp = new Date(0).toISOString();
    expect(
      DocumentListResponseSchema.safeParse([
        {
          id: "39e35789-2e60-4d40-840a-ef10cf05fab7",
          title: "Draft",
          revision: 1,
          updatedAt: timestamp,
          ownerId: "not-allowed",
        },
      ]).success,
    ).toBe(false);
    expect(
      DocumentResourceSchema.safeParse({
        id: "39e35789-2e60-4d40-840a-ef10cf05fab7",
        envelope: EmptyPersistedDocumentEnvelope,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).success,
    ).toBe(true);
    expect(RevisionConflictResponseSchema.safeParse({ currentRevision: 2 }).success).toBe(true);
  });
});
