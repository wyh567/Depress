import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { JobResponseSchema, type ErrorResponse } from "../contracts";
import type { JobReader } from "../services/job-reader";

const JobParamsSchema = z.object({ id: z.string().min(1) });

// Signs an S3 object key into a time-limited download URL. Production wires
// createS3ArtifactService().getSignedDownloadUrl; tests inject a fake.
export type ArtifactUrlSigner = (key: string) => Promise<string>;

export function registerJobsRoute(
  app: FastifyInstance,
  jobs: JobReader,
  signArtifactUrl?: ArtifactUrlSigner,
): void {
  app.get("/jobs/:id", async (request, reply) => {
    const params = JobParamsSchema.safeParse(request.params as unknown);
    const job = params.success ? await jobs.get(params.data.id) : undefined;
    if (!job) {
      const body: ErrorResponse = { error: "JOB_NOT_FOUND" };
      return reply.status(404).send(body);
    }

    if (job.status === "succeeded") {
      // Signed URL is generated per read (fresh 15-min TTL), never persisted.
      if (!job.artifactKey || !signArtifactUrl) {
        const body: ErrorResponse = { error: "ARTIFACT_UNAVAILABLE" };
        return reply.status(500).send(body);
      }
      let downloadUrl: string;
      try {
        downloadUrl = await signArtifactUrl(job.artifactKey);
      } catch {
        const body: ErrorResponse = { error: "ARTIFACT_UNAVAILABLE" };
        return reply.status(500).send(body);
      }
      return reply
        .status(200)
        .send(
          JobResponseSchema.parse({
            jobId: job.id,
            status: "succeeded",
            downloadUrl,
          }),
        );
    }

    if (job.status === "failed") {
      return reply.status(200).send(
        JobResponseSchema.parse({
          jobId: job.id,
          status: "failed",
          error: job.error ?? "COMPILE_FAILED",
        }),
      );
    }

    // queued / processing — the strict schema guarantees no downloadUrl leaks.
    return reply
      .status(200)
      .send(JobResponseSchema.parse({ jobId: job.id, status: job.status }));
  });
}
