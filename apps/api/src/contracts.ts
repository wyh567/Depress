import { z } from "zod";

// API-local contracts that do NOT cross Web↔API↔Worker (Invariant #3
// shared compile/job schemas live in @depress/ast and are re-exported).

export {
  CompileRequestSchema,
  CompileJobPayloadSchema,
  CompileTemplateIdSchema,
  CompileFormatSchema,
  collectCiteKeys,
  type CompileRequest,
  type CompileJobPayload,
  type CompileTemplateId,
  type CompileFormat,
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
