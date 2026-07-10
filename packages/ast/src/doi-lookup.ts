import { z } from "zod";
import { CslItemSchema } from "./csl";
import { DOI_MAX_INPUT_LENGTH } from "./normalize-doi";

// Web ↔ API DOI lookup contract (Phase 3 TODO #4). Lives in @depress/ast
// (Invariant #3). Provider-specific Crossref JSON stays in apps/api.

export const DoiLookupRequestSchema = z
  .object({
    doi: z.string().min(1).max(DOI_MAX_INPUT_LENGTH),
  })
  .strict();
export type DoiLookupRequest = z.infer<typeof DoiLookupRequestSchema>;

export const DoiLookupErrorCodeSchema = z.enum([
  "INVALID_DOI",
  "DOI_NOT_FOUND",
  "CROSSREF_TIMEOUT",
  "CROSSREF_RATE_LIMITED",
  "CROSSREF_UNAVAILABLE",
  "INVALID_CROSSREF_METADATA",
]);
export type DoiLookupErrorCode = z.infer<typeof DoiLookupErrorCodeSchema>;

export const DoiLookupSuccessSchema = z
  .object({
    ok: z.literal(true),
    item: CslItemSchema,
  })
  .strict();

export const DoiLookupFailureSchema = z
  .object({
    ok: z.literal(false),
    error: DoiLookupErrorCodeSchema,
  })
  .strict();

export const DoiLookupResponseSchema = z.discriminatedUnion("ok", [
  DoiLookupSuccessSchema,
  DoiLookupFailureSchema,
]);
export type DoiLookupResponse = z.infer<typeof DoiLookupResponseSchema>;
