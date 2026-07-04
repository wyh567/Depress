// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportAstButton } from "./export-ast-button";

const validJson = () => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
});

const invalidJson = () => ({
  type: "doc",
  content: [{ type: "heading", attrs: { level: 4 }, content: [] }],
});

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn();
  Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExportAstButton", () => {
  it("合法文档:展示格式化 AST 并复制成功提示", async () => {
    writeText.mockResolvedValueOnce(undefined);
    render(<ExportAstButton getEditorJson={validJson} />);

    fireEvent.click(screen.getByRole("button", { name: "导出 AST" }));

    await waitFor(() => expect(screen.getByText("已复制 AST JSON")).toBeInTheDocument());
    expect(screen.getByText(/"type": "doc"/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"type": "doc"'));
  });

  it("Clipboard 写入失败:仍展示格式化 JSON,并提示手动复制", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<ExportAstButton getEditorJson={validJson} />);

    fireEvent.click(screen.getByRole("button", { name: "导出 AST" }));

    await waitFor(() => expect(screen.getByText("复制失败,请手动复制")).toBeInTheDocument());
    expect(screen.getByText(/"type": "doc"/)).toBeInTheDocument();
  });

  it("非法文档:显式展示 Zod path/message,不调用 clipboard", async () => {
    render(<ExportAstButton getEditorJson={invalidJson} />);

    fireEvent.click(screen.getByRole("button", { name: "导出 AST" }));

    await waitFor(() => expect(screen.getByText(/level/)).toBeInTheDocument());
    expect(writeText).not.toHaveBeenCalled();
  });
});
