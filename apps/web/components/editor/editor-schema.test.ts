// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { depressExtensions } from "./extensions";
import { pmDocToAst } from "./pm-doc-to-ast";
import { parseDoc } from "@depress/ast";

let editor: Editor;

beforeEach(() => {
  editor = new Editor({ extensions: depressExtensions });
});

afterEach(() => {
  editor.destroy();
});

const collectTypes = (node: unknown, out = new Set<string>()): Set<string> => {
  const n = node as { type?: string; marks?: { type: string }[]; content?: unknown[] };
  if (n.type) out.add(n.type);
  for (const mark of n.marks ?? []) out.add(mark.type);
  for (const child of n.content ?? []) collectTypes(child, out);
  return out;
};

const REGISTERED = new Set(["doc", "paragraph", "text", "heading", "bold", "italic"]);

describe("受限 schema:未注册项在数据层被拒绝", () => {
  it("setMark 未注册的 textStyle 无效,JSON 无痕迹", () => {
    editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "样式攻击" }] }],
    });
    editor.commands.selectAll();
    // schema 中不存在该 mark,Tiptap 直接抛错——比静默失败更严格
    expect(() =>
      editor.commands.setMark("textStyle", { fontSize: "32px", color: "red" })
    ).toThrow(/no mark type named 'textStyle'/);
    const types = collectTypes(editor.getJSON());
    expect(types.has("textStyle")).toBe(false);
    for (const t of types) expect(REGISTERED.has(t)).toBe(true);
  });

  it("insertContent 未注册节点(blockquote)不落入文档", () => {
    editor.commands.insertContent({
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "引用块" }] }],
    });
    const types = collectTypes(editor.getJSON());
    expect(types.has("blockquote")).toBe(false);
    for (const t of types) expect(REGISTERED.has(t)).toBe(true);
  });

  it("setContent 携带 fontSize/color mark 时属性被剥离", () => {
    // ProseMirror 对未知 mark 的处理是解析时丢弃,不会保留
    editor.commands.setContent(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "彩色大字",
                marks: [{ type: "textStyle", attrs: { fontSize: "48px", color: "#ff0000" } }],
              },
            ],
          },
        ],
      },
      { errorOnInvalidContent: false }
    );
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain("textStyle");
    expect(json).not.toContain("fontSize");
    expect(json).not.toContain("#ff0000");
  });

  it("heading level 4 不可设置", () => {
    editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "标题候选" }] }],
    });
    editor.commands.selectAll();
    // levels: [1,2,3] — level 4 不在白名单
    const applied = editor.commands.setHeading({ level: 4 as never });

    expect(applied).toBe(false);
    const doc = editor.getJSON();
    expect(JSON.stringify(doc)).not.toContain('"level":4');
  });
});

describe("合法内容全链路:编辑器 JSON → AST 校验", () => {
  it("heading 1-3 + bold/italic 段落通过 parseDoc", () => {
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "引言" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "物种名 " },
            { type: "text", text: "E. coli", marks: [{ type: "italic" }] },
            { type: "text", text: " 与向量 ", marks: [] },
            { type: "text", text: "v", marks: [{ type: "bold" }, { type: "italic" }] },
          ],
        },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "小节" }] },
      ],
    });

    const ast = pmDocToAst(editor.getJSON());
    expect(parseDoc(ast).success).toBe(true);
    expect(ast.content[0]).toEqual({
      type: "heading",
      level: 1,
      content: [{ type: "text", text: "引言" }],
    });
  });

  it("空文档(单个空段落)通过校验", () => {
    const ast = pmDocToAst(editor.getJSON());
    expect(ast).toEqual({ type: "doc", content: [{ type: "paragraph", content: [] }] });
  });
});

describe("pm-doc-to-ast 适配器", () => {
  it("marks 对象数组归一化为字符串数组", () => {
    const ast = pmDocToAst({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "粗体", marks: [{ type: "bold" }] }],
        },
      ],
    });
    expect(ast.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "粗体", marks: ["bold"] }],
    });
  });

  it("非法输入(未知 mark)抛错而非静默通过", () => {
    expect(() =>
      pmDocToAst({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x", marks: [{ type: "textStyle" }] }],
          },
        ],
      })
    ).toThrow();
  });
});
