// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportPdfButton } from "./export-pdf-button";
import type { CompileExportDeps } from "./compile-export";

const JOB_ID = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

const validJson = () => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
});

const invalidJson = () => ({
  type: "doc",
  content: [{ type: "heading", attrs: { level: 4 }, content: [] }],
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function instantDeps(fetchFn: typeof fetch): Partial<CompileExportDeps> {
  let t = 0;
  return {
    apiUrl: "http://api.test",
    library: [],
    fetchFn,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

describe("ExportPdfButton", () => {
  it("defaults to IEEE and presents the three shared template options", () => {
    render(<ExportPdfButton getEditorJson={validJson} />);
    const select = screen.getByRole("combobox", { name: "PDF template" });
    expect(select).toHaveValue("ieee");
    expect(screen.getByRole("option", { name: "IEEE" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Elsevier" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "GB/T 7714" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export PDF (IEEE)" })).toBeInTheDocument();
  });

  it("sends ieee through the default UI export path", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/compile")
        ? jsonResponse(202, { jobId: JOB_ID, status: "queued" })
        : jsonResponse(200, {
            jobId: JOB_ID,
            status: "succeeded",
            downloadUrl: "https://s3.test/a.pdf",
          })
    ) as unknown as typeof fetch;
    render(<ExportPdfButton getEditorJson={validJson} deps={instantDeps(fetchFn)} />);

    fireEvent.click(screen.getByRole("button", { name: "Export PDF (IEEE)" }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({
      templateId: "ieee",
      format: "pdf",
    });
  });

  it("uses the selected template in the actual POST payload", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/compile")
        ? jsonResponse(202, { jobId: JOB_ID, status: "queued" })
        : jsonResponse(200, {
            jobId: JOB_ID,
            status: "succeeded",
            downloadUrl: "https://s3.test/a.pdf",
          })
    ) as unknown as typeof fetch;
    render(<ExportPdfButton getEditorJson={validJson} deps={instantDeps(fetchFn)} />);

    const select = screen.getByRole("combobox", { name: "PDF template" });
    fireEvent.change(select, { target: { value: "elsevier" } });
    expect(screen.getByRole("button", { name: "Export PDF (Elsevier)" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "gbt7714" } });
    expect(screen.getByRole("button", { name: "Export PDF (GB/T 7714)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export PDF (GB/T 7714)" }));

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({
      templateId: "gbt7714",
      format: "pdf",
    });
  });

  it("ignores an unknown select value so it cannot produce an invalid request", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    render(<ExportPdfButton getEditorJson={validJson} deps={instantDeps(fetchFn)} />);
    const select = screen.getByRole("combobox", { name: "PDF template" });

    fireEvent.change(select, { target: { value: "unknown" } });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(select).toHaveValue("ieee");
    expect(screen.getByRole("button", { name: "Export PDF (IEEE)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export PDF (IEEE)" }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({ templateId: "ieee" });
  });

  it("成功链路:点击 → 忙态禁用 → 成功提示并触发下载", async () => {
    let releasePost: (() => void) | undefined;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    let releasePoll: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/compile")) {
        await postGate;
        return jsonResponse(202, { jobId: JOB_ID, status: "queued" });
      }
      await gate;
      return jsonResponse(200, {
        jobId: JOB_ID,
        status: "succeeded",
        downloadUrl: "https://s3.test/a.pdf?sig=1",
      });
    }) as unknown as typeof fetch;
    const download = vi.fn();

    render(
      <ExportPdfButton getEditorJson={validJson} deps={instantDeps(fetchFn)} download={download} />
    );
    const button = screen.getByRole("button", { name: "Export PDF (IEEE)" });
    const select = screen.getByRole("combobox", { name: "PDF template" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(select).toBeDisabled();
    expect(button).toHaveTextContent("提交中…");

    releasePost?.();
    // 轮询挂起期间:两个控件均禁用且显示忙态文案。
    await waitFor(() => expect(button).toHaveTextContent("编译中…"));
    await waitFor(() => expect(button).toBeDisabled());
    expect(select).toBeDisabled();
    expect(button).toHaveTextContent("编译中…");

    releasePoll?.();
    await waitFor(() => expect(screen.getByText("PDF 已生成,下载已开始")).toBeInTheDocument());
    expect(download).toHaveBeenCalledWith("https://s3.test/a.pdf?sig=1");
    expect(button).toBeEnabled();
  });

  it("非法 AST:显示校验错误与 Zod issues,不触发下载", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const download = vi.fn();
    render(
      <ExportPdfButton
        getEditorJson={invalidJson}
        deps={instantDeps(fetchFn)}
        download={download}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Export PDF (IEEE)" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("文档未通过校验,已中止导出")).toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("job 失败:展示安全码文案", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/compile")
        ? jsonResponse(202, { jobId: JOB_ID, status: "queued" })
        : jsonResponse(200, {
            jobId: JOB_ID,
            status: "failed",
            error: "COMPILE_FAILED",
          })
    ) as unknown as typeof fetch;
    render(<ExportPdfButton getEditorJson={validJson} deps={instantDeps(fetchFn)} />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF (IEEE)" }));
    await waitFor(() => expect(screen.getByText("PDF 编译失败")).toBeInTheDocument());
  });

  it("超时:60s 后显示超时文案", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      jsonResponse(String(url).endsWith("/compile") ? 202 : 200, {
        jobId: JOB_ID,
        status: "queued",
      })
    ) as unknown as typeof fetch;
    render(<ExportPdfButton getEditorJson={validJson} deps={instantDeps(fetchFn)} />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF (IEEE)" }));
    await waitFor(() => expect(screen.getByText("编译超时(60 秒),请稍后重试")).toBeInTheDocument());
  });
});
