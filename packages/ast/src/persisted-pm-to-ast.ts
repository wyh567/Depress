import { DocSchema, type Doc, type Mark } from "./schema";
import {
  PersistedDocumentEnvelopeSchema,
  type PersistedPmDocument,
} from "./persisted-document";

type PersistedPmBlock = PersistedPmDocument["content"][number];
type PersistedPmInline = NonNullable<PersistedPmBlock["content"]>[number];

function projectInline(node: PersistedPmInline) {
  if (node.type === "citation") {
    return { type: "citation" as const, citeKey: node.attrs.citeKey };
  }
  const marks = node.marks?.map((mark) => mark.type as Mark);
  return {
    type: "text" as const,
    text: node.text,
    ...(marks === undefined ? {} : { marks }),
  };
}

function projectBlock(node: PersistedPmBlock) {
  const content = (node.content ?? []).map(projectInline);
  return node.type === "heading"
    ? { type: "heading" as const, level: node.attrs.level, content }
    : { type: "paragraph" as const, content };
}

export function projectPersistedDocumentToAst(input: unknown): Doc {
  const envelope = PersistedDocumentEnvelopeSchema.parse(input);
  return DocSchema.parse({
    type: "doc",
    ...(envelope.metadata === undefined
      ? {}
      : { metadata: envelope.metadata }),
    content: envelope.editor.content.map(projectBlock),
  });
}
