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

export const JobStatusSchema = z.enum([
  "queued",
  "processing",
  "succeeded",
  "failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const CompileResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.literal("queued"),
});
export type CompileResponse = z.infer<typeof CompileResponseSchema>;

export const JobResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: JobStatusSchema,
});
export type JobResponse = z.infer<typeof JobResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
