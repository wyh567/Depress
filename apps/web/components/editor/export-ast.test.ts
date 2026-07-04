import { describe, expect, it } from "vitest";
import { parseDoc } from "@depress/ast";
import { exportValidatedAst } from "./export-ast";

describe("exportValidatedAst 合法文档", () => {
  it("editor.getJSON 形态的合法文档导出成功,且结果可被 parseDoc 复核", () => {
    const editorJson = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "引言" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "如 " },
            { type: "citation", attrs: { citeKey: "smith2024" } },
            { type: "text", text: " 所示。" },
          ],
        },
      ],
    };

    const result = exportValidatedAst(editorJson);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(parseDoc(result.ast).success).toBe(true);
    expect(result.formatted).toContain('"type": "doc"');
  });

  it("citation 导出为顶层 citeKey,不含 attrs / ProseMirror 形态残留", () => {
    const editorJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "citation", attrs: { citeKey: "wang2023" } }],
        },
      ],
    };

    const result = exportValidatedAst(editorJson);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");

    const para = result.ast.content[0];
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    expect(para.content[0]).toEqual({ type: "citation", citeKey: "wang2023" });
    expect(result.formatted).not.toContain("attrs");
    expect(result.formatted).toContain('"type": "citation"');
    expect(result.formatted).toContain('"citeKey": "wang2023"');
  });

  it("导出的是 DePress AST,不是 ProseMirror JSON(无 attrs/marks-as-objects)", () => {
    const editorJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "粗体", marks: [{ type: "bold" }] }],
        },
      ],
    };
    const result = exportValidatedAst(editorJson);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.ast.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "粗体", marks: ["bold"] }],
    });
  });
});

describe("exportValidatedAst 引用库状态不影响导出", () => {
  it("citeKey 是否存在于引用库不影响 AST 导出结果(invalid 只是视图态)", () => {
    const editorJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "citation", attrs: { citeKey: "ghost9999" } }],
        },
      ],
    };
    // 未知/未知都不查库——exportValidatedAst 不依赖任何库状态
    const result = exportValidatedAst(editorJson);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(JSON.stringify(result.ast)).not.toMatch(/invalid|unknown/i);
  });
});

describe("exportValidatedAst 非法输入", () => {
  it("heading level 4 导出失败,issues 含可读 path/message", () => {
    const editorJson = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 4 }, content: [] }],
    };
    const result = exportValidatedAst(editorJson);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]?.message.length).toBeGreaterThan(0);
  });

  it("citation 缺 citeKey 导出失败并报出具体路径", () => {
    const editorJson = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "citation", attrs: {} }] }],
    };
    const result = exportValidatedAst(editorJson);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.issues.some((i) => i.path.includes("citeKey"))).toBe(true);
  });
});
