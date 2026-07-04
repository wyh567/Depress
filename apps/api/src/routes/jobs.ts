import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ErrorResponse, JobResponse } from "../contracts";
import type { JobStore } from "../services/job-store";

const JobParamsSchema = z.object({ id: z.string().min(1) });

export function registerJobsRoute(app: FastifyInstance, store: JobStore): void {
  app.get("/jobs/:id", async (request, reply) => {
    const params = JobParamsSchema.safeParse(request.params as unknown);
    const job = params.success ? store.get(params.data.id) : undefined;
    if (!job) {
      const body: ErrorResponse = { error: "JOB_NOT_FOUND" };
      return reply.status(404).send(body);
    }
    // No artifact URL yet — that arrives with the S3 TODO.
    const body: JobResponse = { jobId: job.id, status: job.status };
    return reply.status(200).send(body);
  });
}
