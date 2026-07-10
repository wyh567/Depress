import { describe, expect, it, vi } from "vitest";
import type { CslItem } from "@depress/ast";
import { runCompileExport, type CompileExportDeps } from "./compile-export";

const JOB_ID = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

const smith: CslItem = {
  id: "smith2024",
  type: "article-journal",
  title: "A Study",
  volume: "12",
  issue: "3",
  page: "10-20",
};

const lee: CslItem = {
  id: "lee2023",
  type: "book",
  title: "Another",
  publisher: "Press",
};

const unused: CslItem = {
  id: "unused",
  type: "document",
  title: "Not cited",
};

const validEditorJson = () => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "As shown in " },
        { type: "citation", attrs: { citeKey: "smith2024" } },
      ],
    },
  ],
});

const invalidEditorJson = () => ({
  type: "doc",
  content: [{ type: "heading", attrs: { level: 4 }, content: [] }],
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// 假时钟:sleep 推进 now,轮询循环无真实等待。
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms;
    }),
  };
}

function deps(
  fetchFn: typeof fetch,
  extra: Partial<CompileExportDeps> = {}
): CompileExportDeps {
  const clock = fakeClock();
  return {
    apiUrl: "http://api.test",
    library: [smith, unused],
    fetchFn,
    now: clock.now,
    sleep: clock.sleep,
    ...extra,
  };
}

describe("runCompileExport — 预检(Guardrail #3)", () => {
  it("非法 AST(heading level 4)直接返回 validation_error,绝不发请求", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const result = await runCompileExport(invalidEditorJson(), deps(fetchFn));
    expect(result.outcome).toBe("validation_error");
    if (result.outcome === "validation_error") {
      expect(result.issues.length).toBeGreaterThan(0);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("PM 形态(attrs.citeKey、marks 对象)被清洗为 AST 形态后才发送", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/compile")) {
        return jsonResponse(202, { jobId: JOB_ID, status: "queued" });
      }
      return jsonResponse(200, {
        jobId: JOB_ID,
        status: "succeeded",
        downloadUrl: "https://s3.test/a.pdf",
      });
    }) as unknown as typeof fetch;
    await runCompileExport(
      validEditorJson(),
      deps(fetchFn, {
        metadata: { title: "From Metadata" },
      }),
    );

    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const sent = JSON.parse(String(init.body)) as {
      ast: {
        metadata?: { title?: string };
        content: { content: unknown[] }[];
      };
      references: CslItem[];
      templateId: string;
      format: string;
    };
    expect(sent.templateId).toBe("ieee");
    expect(sent.format).toBe("pdf");
    expect(sent.ast.metadata?.title).toBe("From Metadata");
    // citation 的 citeKey 已从 attrs 提升到顶层(幽灵编辑器状态被剥离)。
    expect(sent.ast.content[0]?.content[1]).toEqual({
      type: "citation",
      citeKey: "smith2024",
    });
    // 仅发送被引用子集,不含 unused。
    expect(sent.references).toEqual([smith]);
  });

  it("缺失被引文献时本地失败,绝不发请求", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const result = await runCompileExport(
      validEditorJson(),
      deps(fetchFn, { library: [unused] }),
    );
    expect(result.outcome).toBe("validation_error");
    if (result.outcome === "validation_error") {
      expect(result.issues[0]).toMatchObject({
        path: "references.0",
        message: expect.stringContaining("smith2024"),
      });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("无引用文档发送 references: []", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/compile")) {
        return jsonResponse(202, { jobId: JOB_ID, status: "queued" });
      }
      return jsonResponse(200, {
        jobId: JOB_ID,
        status: "succeeded",
        downloadUrl: "https://s3.test/a.pdf",
      });
    }) as unknown as typeof fetch;
    await runCompileExport(
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
      },
      deps(fetchFn, { library: [smith] }),
    );
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const sent = JSON.parse(String(init.body)) as { references: unknown[] };
    expect(sent.references).toEqual([]);
  });

  it("重复引用只发送一条 reference,且不突变 library", async () => {
    const library: CslItem[] = [smith, lee, unused];
    const snapshot = structuredClone(library);
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/compile")) {
        return jsonResponse(202, { jobId: JOB_ID, status: "queued" });
      }
      return jsonResponse(200, {
        jobId: JOB_ID,
        status: "succeeded",
        downloadUrl: "https://s3.test/a.pdf",
      });
    }) as unknown as typeof fetch;
    await runCompileExport(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "citation", attrs: { citeKey: "lee2023" } },
              { type: "citation", attrs: { citeKey: "smith2024" } },
              { type: "citation", attrs: { citeKey: "lee2023" } },
            ],
          },
        ],
      },
      deps(fetchFn, { library }),
    );
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const sent = JSON.parse(String(init.body)) as { references: CslItem[] };
    expect(sent.references).toEqual([lee, smith]);
    expect(library).toEqual(snapshot);
  });
});

describe("runCompileExport — 主流程", () => {
  it("202 → queued → processing → succeeded,返回 downloadUrl 并上报阶段", async () => {
    const polls = [
      jsonResponse(200, { jobId: JOB_ID, status: "queued" }),
      jsonResponse(200, { jobId: JOB_ID, status: "processing" }),
      jsonResponse(200, {
        jobId: JOB_ID,
        status: "succeeded",
        downloadUrl: "https://s3.test/artifacts/x.pdf?sig=1",
      }),
    ];
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/compile")
        ? jsonResponse(202, { jobId: JOB_ID, status: "queued" })
        : (polls.shift() as Response)
    ) as unknown as typeof fetch;
    const onPhase = vi.fn();

    const result = await runCompileExport(validEditorJson(), deps(fetchFn, { onPhase }));
    expect(result).toEqual({
      outcome: "success",
      downloadUrl: "https://s3.test/artifacts/x.pdf?sig=1",
    });
    expect(onPhase.mock.calls.map((c) => c[0])).toEqual(["compiling", "polling"]);
  });

  it("job 失败时返回安全错误码", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/compile")
        ? jsonResponse(202, { jobId: JOB_ID, status: "queued" })
        : jsonResponse(200, {
            jobId: JOB_ID,
            status: "failed",
            error: "COMPILE_FAILED",
          })
    ) as unknown as typeof fetch;
    expect(await runCompileExport(validEditorJson(), deps(fetchFn))).toEqual({
      outcome: "error",
      message: "COMPILE_FAILED",
    });
  });

  it("POST 被拒(503)时透传安全码", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(503, { error: "QUEUE_UNAVAILABLE" })
    ) as unknown as typeof fetch;
    expect(await runCompileExport(validEditorJson(), deps(fetchFn))).toEqual({
      outcome: "error",
      message: "QUEUE_UNAVAILABLE",
    });
  });

  it("网络异常归一为 NETWORK_ERROR", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await runCompileExport(validEditorJson(), deps(fetchFn))).toEqual({
      outcome: "error",
      message: "NETWORK_ERROR",
    });
  });

  it("轮询体违反契约(queued 混入 downloadUrl)时报错而非放行", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/compile")
        ? jsonResponse(202, { jobId: JOB_ID, status: "queued" })
        : jsonResponse(200, {
            jobId: JOB_ID,
            status: "queued",
            downloadUrl: "https://ghost.test/x.pdf",
          })
    ) as unknown as typeof fetch;
    expect(await runCompileExport(validEditorJson(), deps(fetchFn))).toEqual({
      outcome: "error",
      message: "NETWORK_ERROR",
    });
  });
});

describe("runCompileExport — 硬超时(Guardrail #2)", () => {
  it("持续 queued 时在 60s 截止线放弃并返回 EXPORT_TIMEOUT", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      jsonResponse(String(url).endsWith("/compile") ? 202 : 200, {
        jobId: JOB_ID,
        status: "queued",
      })
    ) as unknown as typeof fetch;
    const clock = fakeClock();

    const result = await runCompileExport(validEditorJson(), {
      apiUrl: "http://api.test",
      library: [smith],
      fetchFn,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(result).toEqual({ outcome: "error", message: "EXPORT_TIMEOUT" });
    // 2s 间隔 × 60s 窗口 → t=0..60s 共 31 次轮询(含截止线上最后一次)
    // + 1 次 POST,绝不越过 60s、不会无限循环。
    expect(fetchFn).toHaveBeenCalledTimes(32);
    expect(clock.now()).toBeLessThanOrEqual(60_000);
  });

  it("signal.aborted 置位后停止轮询", async () => {
    const signal = { aborted: false };
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (!String(url).endsWith("/compile")) signal.aborted = true;
      return jsonResponse(String(url).endsWith("/compile") ? 202 : 200, {
        jobId: JOB_ID,
        status: "queued",
      });
    }) as unknown as typeof fetch;

    const result = await runCompileExport(validEditorJson(), deps(fetchFn, { signal }));
    expect(result).toEqual({ outcome: "error", message: "ABORTED" });
    expect(fetchFn).toHaveBeenCalledTimes(2); // POST + 首次轮询
  });
});
