import { MarkSchema, parseDoc, type Doc, type Mark } from "@depress/ast";

// Adapter: Tiptap getJSON() output → @depress/ast Doc.
// Known shape differences it bridges:
//   - PM marks are [{ type: "bold" }] objects; AST marks are "bold" strings
//   - PM heading level lives in attrs.level; AST hoists it to the node
//   - PM omits `content` on empty blocks; AST requires content: []
// The result is validated with parseDoc — anything the editor schema
// should have blocked fails loudly here instead of leaking downstream.

interface PmNode {
  type?: unknown;
  text?: unknown;
  attrs?: { level?: unknown; citeKey?: unknown };
  marks?: { type?: unknown }[];
  content?: PmNode[];
}

function toMarks(marks: PmNode["marks"]): Mark[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  return marks.map((m) => MarkSchema.parse(m.type));
}

function toInline(node: PmNode): unknown {
  if (node.type === "text") {
    const marks = toMarks(node.marks);
    return { type: "text", text: node.text, ...(marks ? { marks } : {}) };
  }
  if (node.type === "citation") {
    // PM 把 citeKey 放在 attrs;AST 提升到顶层
    return { type: "citation", citeKey: node.attrs?.citeKey };
  }
  // Unknown inline types pass through untouched; parseDoc rejects them.
  return node;
}

function toBlock(node: PmNode): unknown {
  const content = (node.content ?? []).map(toInline);
  switch (node.type) {
    case "heading":
      return { type: "heading", level: node.attrs?.level, content };
    case "paragraph":
      return { type: "paragraph", content };
    default:
      return node;
  }
}

export function pmDocToAst(json: unknown): Doc {
  const root = json as PmNode;
  const candidate = {
    type: root.type,
    content: (root.content ?? []).map(toBlock),
  };
  const result = parseDoc(candidate);
  if (!result.success) {
    throw new Error(`编辑器输出未通过 AST 校验: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result.data;
}
