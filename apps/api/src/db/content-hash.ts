import { createHash } from "node:crypto";
import { PersistedDocumentEnvelopeSchema, type PersistedDocumentEnvelope } from "@depress/ast";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function parseAndHashDocumentEnvelope(input: unknown): {
  envelope: PersistedDocumentEnvelope;
  contentHash: string;
} {
  const envelope = PersistedDocumentEnvelopeSchema.parse(input);
  return {
    envelope,
    contentHash: createHash("sha256").update(canonicalJson(envelope), "utf8").digest("hex"),
  };
}
