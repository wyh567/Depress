// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { parseDoc } from "@depress/ast";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDepressExtensions } from "./extensions";
import { pmDocToAst } from "./pm-doc-to-ast";

let editor: Editor;

beforeEach(() => {
  editor = new Editor({
    extensions: createDepressExtensions({
      isCitationKnown: (citeKey) => citeKey === "smith2024",
    }),
  });
});

afterEach(() => {
  editor.destroy();
});

describe("citation 插入 → 序列化 → AST 校验", () => {
  it("insertCitation 后 getJSON 通过完整 Zod 校验", () => {
    editor.commands.insertCitation({ citeKey: "smith2024" });

    const json = editor.getJSON();
    const ast = pmDocToAst(json);
    expect(parseDoc(ast).success).toBe(true);

    const para = ast.content[0];
    expect(para).toBeDefined();
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    expect(para.content).toContainEqual({ type: "citation", citeKey: "smith2024" });
  });

  it("文本 + citation + 文本混排全链路通过", () => {
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "如 " },
            { type: "citation", attrs: { citeKey: "wang2023" } },
            { type: "text", text: " 所示," },
            { type: "citation", attrs: { citeKey: "smith2024" } },
            { type: "text", text: " 进一步证明。" },
          ],
        },
      ],
    });

    const ast = pmDocToAst(editor.getJSON());
    expect(parseDoc(ast).success).toBe(true);
    const para = ast.content[0];
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    expect(para.content).toHaveLength(5);
    expect(para.content[1]).toEqual({ type: "citation", citeKey: "wang2023" });
    expect(para.content[3]).toEqual({ type: "citation", citeKey: "smith2024" });
  });
});

describe("citation 非法输入被拒", () => {
  it("适配器拒绝缺 citeKey 的 citation", () => {
    expect(() =>
      pmDocToAst({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "citation", attrs: {} }] }],
      })
    ).toThrow();
  });

  it("适配器拒绝 citeKey 为纯空白的 citation", () => {
    expect(() =>
      pmDocToAst({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "citation", attrs: { citeKey: "   " } }] },
        ],
      })
    ).toThrow();
  });

  it("insertCitation 对空串/纯空白 citeKey 返回 false 且不插入节点", () => {
    expect(editor.commands.insertCitation({ citeKey: "" })).toBe(false);
    expect(editor.commands.insertCitation({ citeKey: "   " })).toBe(false);
    expect(JSON.stringify(editor.getJSON())).not.toContain("citation");
  });

  it("insertCitation 会 trim citeKey", () => {
    editor.commands.insertCitation({ citeKey: "  smith2024  " });
    expect(JSON.stringify(editor.getJSON())).toContain('"citeKey":"smith2024"');
  });

  it("适配器拒绝 citeKey 为空串的 citation", () => {
    expect(() =>
      pmDocToAst({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "citation", attrs: { citeKey: "" } }] },
        ],
      })
    ).toThrow();
  });
});

describe("citation 是无内容的 atom", () => {
  it("JSON 中 citation 节点无 content 子节点", () => {
    editor.commands.insertCitation({ citeKey: "smith2024" });
    const json = JSON.stringify(editor.getJSON());
    const citation = editor
      .getJSON()
      .content?.flatMap((b) => b.content ?? [])
      .find((n) => n.type === "citation");
    expect(citation).toBeDefined();
    expect(citation).not.toHaveProperty("content");
    expect(json).toContain('"citeKey":"smith2024"');
  });
});

describe("Mod-Shift-c 快捷键", () => {
  const pressShortcut = (target: Editor) => {
    const event = new KeyboardEvent("keydown", {
      key: "C",
      code: "KeyC",
      ctrlKey: true,
      shiftKey: true,
    });
    Object.defineProperty(event, "keyCode", { get: () => 67 });
    let handled = false;
    target.view.someProp("handleKeyDown", (handler) => {
      if (!handled) handled = handler(target.view, event) ?? false;
      return handled;
    });
    return handled;
  };

  it("无 onRequestCitation 时返回 false", () => {
    expect(pressShortcut(editor)).toBe(false);
  });

  it("有 onRequestCitation 时返回 true 并触发回调", () => {
    let called = 0;
    const withCallback = new Editor({
      extensions: createDepressExtensions({ onRequestCitation: () => called++ }),
    });
    expect(pressShortcut(withCallback)).toBe(true);
    expect(called).toBe(1);
    withCallback.destroy();
  });
});

describe("默认扩展白名单", () => {
  it("createDepressExtensions() 默认包含 citation", () => {
    const names = createDepressExtensions().map((e) => e.name);
    expect(names).toContain("citation");
  });
});

describe("invalid 视觉态仅存在于视图层", () => {
  it("未知 citeKey 的 chip 带视觉标记,但 PM JSON / AST / HTML 无痕迹", () => {
    // 挂载 NodeView 需要真实 DOM 容器
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mounted = new Editor({
      element: host,
      extensions: createDepressExtensions({
        isCitationKnown: (citeKey) => citeKey === "smith2024",
      }),
    });

    mounted.commands.insertCitation({ citeKey: "ghost9999" });

    // 视图层:有 invalid 标记
    const chip = host.querySelector('[data-cite-key="ghost9999"]');
    expect(chip).not.toBeNull();
    expect(chip?.classList.contains("citation-unknown")).toBe(true);

    // 数据层:三种序列化形态均无 invalid/unknown 痕迹
    const pmJson = JSON.stringify(mounted.getJSON());
    expect(pmJson).not.toMatch(/invalid|unknown/i);

    const ast = JSON.stringify(pmDocToAst(mounted.getJSON()));
    expect(ast).not.toMatch(/invalid|unknown/i);

    const html = mounted.getHTML();
    expect(html).not.toMatch(/invalid|unknown/i);

    mounted.destroy();
    host.remove();
  });
});
