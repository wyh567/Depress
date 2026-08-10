import type Redis from "ioredis";

export const DEFAULT_API_BODY_LIMIT_BYTES = 1_048_576;
export const DEFAULT_API_RATE_LIMIT_MAX = 120;
export const DEFAULT_API_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_DOI_RATE_LIMIT_MAX = 10;
export const DEFAULT_COMPILE_RATE_LIMIT_MAX = 5;
export const LOOPBACK_TRUST_PROXY = "127.0.0.1";

export type ApiSafetyOptions = {
  bodyLimitBytes?: number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  doiRateLimitMax?: number;
  compileRateLimitMax?: number;
  rateLimitRedis?: Redis;
  rateLimitNameSpace?: string;
  trustProxy?: string | string[];
};

export function rateLimitError(code: "RATE_LIMITED" | "CROSSREF_RATE_LIMITED") {
  return Object.assign(new Error(code), { code, statusCode: 429 });
}
