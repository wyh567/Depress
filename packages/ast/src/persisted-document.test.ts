import { describe, expect, it } from "vitest";
import { PersistedDocumentEnvelopeSchema, PersistedPmDocumentSchema } from "./persisted-document";

const validEnvelope = {
  schemaVersion: 1,
  editor: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Introduction" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Prior work " },
          { type: "citation", attrs: { citeKey: "smith2024" } },
          { type: "text", text: " established this.", marks: [{ type: "italic" }] },
        ],
      },
    ],
  },
  metadata: {
    title: "Mentor draft",
    authors: [{ name: "Mentor" }],
    abstract: "A persisted draft.",
    keywords: ["draft", "mentor"],
  },
} as const;

describe("PersistedDocumentEnvelopeSchema", () => {
  it("accepts the editable ProseMirror subset with semantic metadata", () => {
    expect(PersistedDocumentEnvelopeSchema.parse(validEnvelope)).toEqual(validEnvelope);
  });

  it("accepts empty supported blocks without inventing compile content", () => {
    expect(
      PersistedPmDocumentSchema.parse({
        type: "doc",
        content: [{ type: "paragraph" }],
      })
    ).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it.each([
    ["future schema version", { ...validEnvelope, schemaVersion: 2 }],
    [
      "unsupported editor node",
      {
        ...validEnvelope,
        editor: { type: "doc", content: [{ type: "table" }] },
      },
    ],
    [
      "unsupported heading level",
      {
        ...validEnvelope,
        editor: {
          type: "doc",
          content: [{ type: "heading", attrs: { level: 4 } }],
        },
      },
    ],
    [
      "presentation attributes",
      {
        ...validEnvelope,
        editor: {
          type: "doc",
          content: [{ type: "paragraph", attrs: { color: "red" } }],
        },
      },
    ],
  ])("rejects %s", (_name, value) => {
    expect(PersistedDocumentEnvelopeSchema.safeParse(value).success).toBe(false);
  });
});
