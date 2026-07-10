import {
  DoiLookupResponseSchema,
  normalizeDoi,
  type CslItem,
  type DoiLookupErrorCode,
} from "@depress/ast";

// Pure DOI import orchestration (injectable fetch). No Zustand, no UI.

export type DoiImportPhase =
  | "idle"
  | "loading"
  | "success"
  | "invalid_doi"
  | "not_found"
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "invalid_metadata"
  | "already_exists"
  | "error";

export type DoiImportResult =
  | { phase: "success"; item: CslItem }
  | { phase: Exclude<DoiImportPhase, "idle" | "loading" | "success">; message: string };

export interface DoiImportDeps {
  apiUrl: string;
  // Local duplicate checks — called before network and before insert.
  hasId: (id: string) => boolean;
  hasDoi: (doi: string) => boolean;
  tryAdd: (
    item: CslItem,
  ) => { outcome: "added"; item: CslItem } | { outcome: "duplicate_id" } | { outcome: "duplicate_doi" };
  fetchFn?: typeof fetch;
}

const ERROR_MESSAGE: Record<DoiLookupErrorCode, string> = {
  INVALID_DOI: "DOI 格式无效",
  DOI_NOT_FOUND: "未找到该 DOI",
  CROSSREF_TIMEOUT: "Crossref 请求超时",
  CROSSREF_RATE_LIMITED: "Crossref 请求过于频繁，请稍后重试",
  CROSSREF_UNAVAILABLE: "Crossref 暂时不可用",
  INVALID_CROSSREF_METADATA: "Crossref 返回的元数据无法导入",
};

function phaseForError(error: DoiLookupErrorCode): Exclude<
  DoiImportPhase,
  "idle" | "loading" | "success" | "already_exists" | "error"
> {
  switch (error) {
    case "INVALID_DOI":
      return "invalid_doi";
    case "DOI_NOT_FOUND":
      return "not_found";
    case "CROSSREF_TIMEOUT":
      return "timeout";
    case "CROSSREF_RATE_LIMITED":
      return "rate_limited";
    case "CROSSREF_UNAVAILABLE":
      return "unavailable";
    case "INVALID_CROSSREF_METADATA":
      return "invalid_metadata";
  }
}

export async function runDoiImport(
  rawDoi: string,
  deps: DoiImportDeps,
): Promise<DoiImportResult> {
  const normalized = normalizeDoi(rawDoi);
  if (!normalized.ok) {
    return { phase: "invalid_doi", message: ERROR_MESSAGE.INVALID_DOI };
  }

  if (deps.hasId(normalized.doi) || deps.hasDoi(normalized.doi)) {
    return { phase: "already_exists", message: "reference already exists" };
  }

  const fetchFn = deps.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(`${deps.apiUrl}/references/doi/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ doi: normalized.doi }),
    });
  } catch {
    return { phase: "unavailable", message: ERROR_MESSAGE.CROSSREF_UNAVAILABLE };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { phase: "unavailable", message: ERROR_MESSAGE.CROSSREF_UNAVAILABLE };
  }

  const parsed = DoiLookupResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { phase: "error", message: "服务器响应无效" };
  }

  if (!parsed.data.ok) {
    return {
      phase: phaseForError(parsed.data.error),
      message: ERROR_MESSAGE[parsed.data.error],
    };
  }

  // Re-check immediately before insert (stale-state race).
  if (deps.hasId(parsed.data.item.id) || deps.hasDoi(normalized.doi)) {
    return { phase: "already_exists", message: "reference already exists" };
  }

  const added = deps.tryAdd(parsed.data.item);
  if (added.outcome !== "added") {
    return { phase: "already_exists", message: "reference already exists" };
  }

  return { phase: "success", item: added.item };
}
