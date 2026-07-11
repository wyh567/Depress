import {
  CompileRequestSchema,
  JobResponseSchema,
  type CslItem,
  type CompileTemplateId,
  type DocMetadata,
} from "@depress/ast";
import { exportValidatedAst, type ExportIssue } from "./export-ast";
import { selectCitedReferences } from "./select-cited-references";

// 编译导出的纯逻辑核心:AST 严格预检(Guardrail #3)→ 引用子集解析 →
// CompileRequestSchema 边界校验 → POST /compile → 2s 轮询 GET /jobs/:id →
// 60s 硬超时(Guardrail #2)。所有 I/O 与时间都可注入。
//
// Phase 3 TODO #2: POST body 携带 references(仅文档实际引用到的 CSL 子集)。
// 缺失被引文献在本地失败,绝不发请求。citation 节点仍只存 citeKey。

export type CompileExportPhase = "compiling" | "polling";

export type CompileExportResult =
  | { outcome: "success"; downloadUrl: string }
  | { outcome: "validation_error"; issues: ExportIssue[] }
  | { outcome: "error"; message: string };

export interface CompileExportDeps {
  apiUrl: string;
  // Template selection is an export presentation parameter, not document content.
  templateId: CompileTemplateId;
  // Snapshot of the local reference library at export time (read-only).
  // Production wires Zustand; tests inject fixtures. Never mutated here.
  library: readonly CslItem[];
  // Optional document metadata snapshot (from the metadata panel/store).
  metadata?: DocMetadata;
  fetchFn?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onPhase?: (phase: CompileExportPhase) => void;
  // 置为 true 可中止轮询(如组件卸载);中止按 error 收尾但不再触发 UI。
  signal?: { aborted: boolean };
}

export const DEFAULT_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_TIMEOUT_MS = 60_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runCompileExport(
  editorJson: unknown,
  deps: CompileExportDeps
): Promise<CompileExportResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Guardrail #3:pmDocToAst 清洗(剥离 PM attrs/marks 形态)+ DocSchema
  // 严格校验,失败绝不发请求。
  const exported = exportValidatedAst(editorJson, deps.metadata);
  if (!exported.success) {
    return { outcome: "validation_error", issues: exported.issues };
  }

  const cited = selectCitedReferences(exported.ast, deps.library);
  if (!cited.success) {
    return { outcome: "validation_error", issues: cited.issues };
  }

  const request = CompileRequestSchema.safeParse({
    ast: exported.ast,
    references: cited.references,
    templateId: deps.templateId,
    format: "pdf",
  });
  if (!request.success) {
    return {
      outcome: "validation_error",
      issues: request.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    };
  }

  deps.onPhase?.("compiling");
  let jobId: string;
  try {
    const res = await fetchFn(`${deps.apiUrl}/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.data),
    });
    if (res.status !== 202) {
      return { outcome: "error", message: await safeErrorCode(res) };
    }
    const body = JobResponseSchema.parse(await res.json());
    if (body.status !== "queued") {
      return { outcome: "error", message: "UNEXPECTED_RESPONSE" };
    }
    jobId = body.jobId;
  } catch {
    return { outcome: "error", message: "NETWORK_ERROR" };
  }

  deps.onPhase?.("polling");
  const deadline = now() + timeoutMs;
  for (;;) {
    if (deps.signal?.aborted) {
      return { outcome: "error", message: "ABORTED" };
    }
    try {
      const res = await fetchFn(`${deps.apiUrl}/jobs/${jobId}`);
      if (!res.ok) {
        return { outcome: "error", message: await safeErrorCode(res) };
      }
      const job = JobResponseSchema.parse(await res.json());
      if (job.status === "succeeded") {
        return { outcome: "success", downloadUrl: job.downloadUrl };
      }
      if (job.status === "failed") {
        return { outcome: "error", message: job.error };
      }
    } catch {
      return { outcome: "error", message: "NETWORK_ERROR" };
    }
    // Guardrail #2:硬超时——下一次轮询会越过截止线就立刻放弃。
    if (now() + pollIntervalMs > deadline) {
      return { outcome: "error", message: "EXPORT_TIMEOUT" };
    }
    await sleep(pollIntervalMs);
  }
}

async function safeErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // 响应体不是 JSON — 落到通用码。
  }
  return `HTTP_${res.status}`;
}
