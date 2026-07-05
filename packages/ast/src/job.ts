import { z } from "zod";

// Compile-job contract (Invariant #3: single source of truth for
// cross-boundary types — API responses and worker outcomes both derive from
// these schemas; consumers must never redeclare them locally).

export const JobStatusSchema = z.enum([
  "queued",
  "processing",
  "succeeded",
  "failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

// Safe, enum-like failure codes only — never raw compiler/S3/Zod output.
export const JobFailureCodeSchema = z.enum([
  "INVALID_AST",
  "COMPILE_FAILED",
  "UPLOAD_FAILED",
  "QUEUE_UNAVAILABLE",
]);
export type JobFailureCode = z.infer<typeof JobFailureCodeSchema>;

// Discriminated on status: downloadUrl legally exists ONLY on succeeded
// jobs; error ONLY on failed jobs. Variants are .strict() so a stray
// downloadUrl on a queued job is a contract violation, not silently stripped.
export const JobResponseSchema = z.discriminatedUnion("status", [
  z.object({ jobId: z.string().uuid(), status: z.literal("queued") }).strict(),
  z
    .object({ jobId: z.string().uuid(), status: z.literal("processing") })
    .strict(),
  z
    .object({
      jobId: z.string().uuid(),
      status: z.literal("succeeded"),
      // Signed URLs are generated on read and expire; they are never stored.
      downloadUrl: z.string().url(),
    })
    .strict(),
  z
    .object({
      jobId: z.string().uuid(),
      status: z.literal("failed"),
      error: JobFailureCodeSchema,
    })
    .strict(),
]);
export type JobResponse = z.infer<typeof JobResponseSchema>;
