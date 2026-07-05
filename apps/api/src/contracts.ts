import { z } from "zod";
import { DocSchema } from "@depress/ast";

// API contract — Zod is the single source of truth; TS types via z.infer.

// templateId/format are deliberately literal for now: only the built-in IEEE
// template and PDF output exist in this phase.
export const CompileRequestSchema = z.object({
  ast: DocSchema,
  templateId: z.literal("ieee"),
  format: z.literal("pdf"),
});
export type CompileRequest = z.infer<typeof CompileRequestSchema>;

// Job status/response schemas moved to @depress/ast (Invariant #3): they
// cross the API↔worker↔web boundary. Re-exported here so route/store code
// keeps a single import site for API contracts.
export {
  JobStatusSchema,
  JobFailureCodeSchema,
  JobResponseSchema,
  type JobStatus,
  type JobFailureCode,
  type JobResponse,
} from "@depress/ast";

export const CompileResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.literal("queued"),
});
export type CompileResponse = z.infer<typeof CompileResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
