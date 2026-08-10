import {
  CompileJobCreateRequestSchema,
  CompileJobDownloadResponseSchema,
  CompileJobNotReadyResponseSchema,
  PersistedCompileJobResourceSchema,
} from "@depress/ast";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { MentorAuth } from "../auth/auth";
import { requireAuthenticatedUser } from "../auth/fastify-auth";
import type { ArtifactUrlSigner } from "../services/artifact-contracts";
import {
  DEFAULT_API_RATE_LIMIT_WINDOW_MS,
  DEFAULT_COMPILE_RATE_LIMIT_MAX,
} from "../http-safety";
import {
  CompileDocumentNotFoundError,
  CompileProjectionError,
  CompileRevisionConflictError,
  createCompileJobRepository,
} from "../db/compile-job-repository";

const CompileJobIdSchema = z.string().uuid();

export function registerCompileJobRoutes(
  app: FastifyInstance,
  auth: MentorAuth,
  pool: Pool,
  signArtifactUrl?: ArtifactUrlSigner,
  rateLimit: { max: number; timeWindowMs: number } = {
    max: DEFAULT_COMPILE_RATE_LIMIT_MAX,
    timeWindowMs: DEFAULT_API_RATE_LIMIT_WINDOW_MS,
  },
): void {
  const jobs = createCompileJobRepository(pool);

  app.post("/api/compile-jobs", {
    config: {
      rateLimit: { max: rateLimit.max, timeWindow: rateLimit.timeWindowMs },
    },
  }, async (request, reply) => {
    const user = await requireAuthenticatedUser(auth, request, reply);
    if (!user) return;
    const body = CompileJobCreateRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const created = await jobs.createForOwner({
        ownerUserId: user.id,
        request: body.data,
      });
      return reply
        .code(202)
        .send(PersistedCompileJobResourceSchema.parse(created.resource));
    } catch (error) {
      if (error instanceof CompileDocumentNotFoundError) {
        return reply.code(404).send({ error: "COMPILE_DOCUMENT_NOT_FOUND" });
      }
      if (error instanceof CompileRevisionConflictError) {
        return reply
          .code(409)
          .send({ currentRevision: error.currentRevision });
      }
      if (error instanceof CompileProjectionError) {
        return reply.code(422).send({ error: "COMPILE_PROJECTION_INVALID" });
      }
      request.log.error({ err: error }, "Compile job creation failed");
      return reply.code(500).send({ error: "COMPILE_JOB_SERVICE_ERROR" });
    }
  });

  app.get("/api/compile-jobs/:jobId", async (request, reply) => {
    const user = await requireAuthenticatedUser(auth, request, reply);
    if (!user) return;
    const jobId = CompileJobIdSchema.safeParse(
      (request.params as { jobId?: unknown }).jobId,
    );
    if (!jobId.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const job = await jobs.getForOwner(user.id, jobId.data);
      return job
        ? reply.send(PersistedCompileJobResourceSchema.parse(job))
        : reply.code(404).send({ error: "COMPILE_JOB_NOT_FOUND" });
    } catch (error) {
      request.log.error({ err: error }, "Compile job read failed");
      return reply.code(500).send({ error: "COMPILE_JOB_SERVICE_ERROR" });
    }
  });

  app.get("/api/compile-jobs/:jobId/download", async (request, reply) => {
    const user = await requireAuthenticatedUser(auth, request, reply);
    if (!user) return;
    const jobId = CompileJobIdSchema.safeParse(
      (request.params as { jobId?: unknown }).jobId,
    );
    if (!jobId.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const job = await jobs.getArtifactForOwner(user.id, jobId.data);
      if (!job) {
        return reply.code(404).send({ error: "COMPILE_JOB_NOT_FOUND" });
      }
      if (job.status !== "succeeded") {
        return reply
          .code(409)
          .send(
            CompileJobNotReadyResponseSchema.parse({
              error: "COMPILE_JOB_NOT_READY",
              status: job.status,
            }),
          );
      }
      if (!job.artifactKey || !signArtifactUrl) {
        return reply.code(500).send({ error: "ARTIFACT_UNAVAILABLE" });
      }
      const downloadUrl = await signArtifactUrl(job.artifactKey);
      return reply.send(
        CompileJobDownloadResponseSchema.parse({ downloadUrl }),
      );
    } catch (error) {
      request.log.error({ err: error }, "Compile artifact signing failed");
      return reply.code(500).send({ error: "ARTIFACT_UNAVAILABLE" });
    }
  });
}
