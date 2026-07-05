import { randomUUID } from "node:crypto";
import type { CompileRequest, JobFailureCode, JobStatus } from "../contracts";

export interface Job {
  id: string;
  status: JobStatus;
  templateId: CompileRequest["templateId"];
  format: CompileRequest["format"];
  createdAt: number;
  // S3 object key of the compiled PDF — set only on succeeded jobs. Signed
  // URLs are never stored (they expire); GET /jobs/:id signs on read.
  artifactKey?: string;
  // Safe failure code — set only on failed jobs.
  error?: JobFailureCode;
}

// In-memory store, one instance per app (no global singleton) so tests stay
// isolated. Replaced by BullMQ in a later TODO — keep this interface small.
export function createJobStore() {
  const jobs = new Map<string, Job>();

  return {
    create(input: Pick<Job, "templateId" | "format">): Job {
      const job: Job = {
        id: randomUUID(),
        status: "queued",
        templateId: input.templateId,
        format: input.format,
        createdAt: Date.now(),
      };
      jobs.set(job.id, job);
      return job;
    },
    get(id: string): Job | undefined {
      return jobs.get(id);
    },
    setStatus(
      id: string,
      status: JobStatus,
      extra: { artifactKey?: string; error?: JobFailureCode } = {},
    ): void {
      const job = jobs.get(id);
      if (!job) return;
      job.status = status;
      if (extra.artifactKey !== undefined) job.artifactKey = extra.artifactKey;
      if (extra.error !== undefined) job.error = extra.error;
    },
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
