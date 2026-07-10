import type { DoiLookupErrorCode } from "@depress/ast";
import {
  CrossrefWorkEnvelopeSchema,
  type CrossrefWorkMessage,
} from "./provider-schema";

// Fixed-origin Crossref client. User input may only affect the encoded DOI
// path segment — never host, scheme, or proxy target.

export const CROSSREF_ORIGIN = "https://api.crossref.org";
export const CROSSREF_TIMEOUT_MS = 8_000;
export const CROSSREF_MAX_ATTEMPTS = 2;
export const CROSSREF_RETRY_DELAY_MS = 250;
export const CROSSREF_RETRY_AFTER_CAP_MS = 2_000;

export type CrossrefClientResult =
  | { ok: true; work: CrossrefWorkMessage }
  | { ok: false; error: DoiLookupErrorCode };

export interface CrossrefClientOptions {
  fetchFn?: typeof fetch;
  mailto?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

function buildWorksUrl(normalizedDoi: string, mailto: string | undefined): string {
  const url = new URL(
    `${CROSSREF_ORIGIN}/works/${encodeURIComponent(normalizedDoi)}`,
  );
  if (mailto && mailto.trim().length > 0) {
    url.searchParams.set("mailto", mailto.trim());
  }
  return url.toString();
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "AbortError"
  );
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return Math.min(asInt * 1000, CROSSREF_RETRY_AFTER_CAP_MS);
  }
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    if (delta > 0) return Math.min(delta, CROSSREF_RETRY_AFTER_CAP_MS);
  }
  return undefined;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCrossrefClient(options: CrossrefClientOptions = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? CROSSREF_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? CROSSREF_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  const mailto = options.mailto;

  return {
    async lookupWork(normalizedDoi: string): Promise<CrossrefClientResult> {
      const url = buildWorksUrl(normalizedDoi, mailto);
      // SSRF guard: origin is code-owned; only path DOI is encoded.
      if (!url.startsWith(`${CROSSREF_ORIGIN}/works/`)) {
        return { ok: false, error: "CROSSREF_UNAVAILABLE" };
      }

      let lastError: DoiLookupErrorCode = "CROSSREF_UNAVAILABLE";

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchFn(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "User-Agent": "DePress/0.0 (Crossref DOI lookup; polite pool via mailto)",
            },
            signal: controller.signal,
          });

          if (response.status === 404) {
            return { ok: false, error: "DOI_NOT_FOUND" };
          }
          if (response.status === 400) {
            return { ok: false, error: "INVALID_DOI" };
          }
          if (response.status === 429) {
            lastError = "CROSSREF_RATE_LIMITED";
            if (attempt < maxAttempts) {
              const retryAfter = parseRetryAfterMs(
                response.headers.get("Retry-After"),
              );
              await sleep(retryAfter ?? CROSSREF_RETRY_DELAY_MS);
              continue;
            }
            return { ok: false, error: "CROSSREF_RATE_LIMITED" };
          }
          if (response.status >= 500) {
            lastError = "CROSSREF_UNAVAILABLE";
            if (attempt < maxAttempts) {
              await sleep(CROSSREF_RETRY_DELAY_MS);
              continue;
            }
            return { ok: false, error: "CROSSREF_UNAVAILABLE" };
          }
          if (!response.ok) {
            return { ok: false, error: "CROSSREF_UNAVAILABLE" };
          }

          let json: unknown;
          try {
            json = await response.json();
          } catch {
            return { ok: false, error: "INVALID_CROSSREF_METADATA" };
          }

          const envelope = CrossrefWorkEnvelopeSchema.safeParse(json);
          if (!envelope.success || envelope.data.status !== "ok") {
            return { ok: false, error: "INVALID_CROSSREF_METADATA" };
          }
          return { ok: true, work: envelope.data.message };
        } catch (error) {
          if (isAbortError(error)) {
            lastError = "CROSSREF_TIMEOUT";
            if (attempt < maxAttempts) {
              await sleep(CROSSREF_RETRY_DELAY_MS);
              continue;
            }
            return { ok: false, error: "CROSSREF_TIMEOUT" };
          }
          lastError = "CROSSREF_UNAVAILABLE";
          if (attempt < maxAttempts) {
            await sleep(CROSSREF_RETRY_DELAY_MS);
            continue;
          }
          return { ok: false, error: lastError };
        } finally {
          clearTimeout(timer);
        }
      }

      return { ok: false, error: lastError };
    },
  };
}

export type CrossrefClient = ReturnType<typeof createCrossrefClient>;
