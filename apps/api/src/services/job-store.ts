import { randomUUID } from "node:crypto";
import type { CompileRequest, JobStatus } from "../contracts";

export interface Job {
  id: string;
  status: JobStatus;
  templateId: CompileRequest["templateId"];
  format: CompileRequest["format"];
  createdAt: number;
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
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
