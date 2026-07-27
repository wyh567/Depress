import {
  ReferenceIdentitySchema,
  ReferenceListResponseSchema,
  ReferenceMutationRequestSchema,
} from "@depress/ast";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { MentorAuth } from "../auth/auth";
import { requireAuthenticatedUser } from "../auth/fastify-auth";
import { createProjectRepository } from "../db/project-repository";
import { createReferenceRepository } from "../db/reference-repository";

async function defaultProjectId(
  auth: MentorAuth,
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | undefined> {
  const user = await requireAuthenticatedUser(auth, request, reply);
  if (!user) return undefined;
  return (await createProjectRepository(pool).getOrCreateDefaultProject(user.id)).id;
}

function invalidRequest(reply: FastifyReply) {
  return reply.code(400).send({ error: "INVALID_REQUEST" });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "REFERENCE_NOT_FOUND" });
}

function pathIdentity(request: FastifyRequest) {
  return ReferenceIdentitySchema.safeParse(
    (request.params as { referenceIdentity?: unknown }).referenceIdentity,
  );
}

async function handleReferenceRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await operation();
  } catch (error) {
    request.log.error({ err: error }, "Reference operation failed");
    return reply.code(500).send({ error: "REFERENCE_SERVICE_ERROR" });
  }
}

export function registerReferenceRoutes(
  app: FastifyInstance,
  auth: MentorAuth,
  pool: Pool,
): void {
  const references = createReferenceRepository(pool);

  app.get("/api/references", (request, reply) =>
    handleReferenceRequest(request, reply, async () => {
      const projectId = await defaultProjectId(auth, pool, request, reply);
      if (!projectId) return;
      const items = (await references.list(projectId)).map((reference) => reference.item);
      return reply.send(ReferenceListResponseSchema.parse(items));
    }),
  );

  app.post("/api/references", (request, reply) =>
    handleReferenceRequest(request, reply, async () => {
      const projectId = await defaultProjectId(auth, pool, request, reply);
      if (!projectId) return;
      const body = ReferenceMutationRequestSchema.safeParse(request.body);
      if (!body.success) return invalidRequest(reply);

      const result = await references.create({ projectId, item: body.data.item });
      if (result.status === "duplicate") {
        return reply.code(409).send({ error: "REFERENCE_CONFLICT" });
      }
      return reply.code(201).send(result.reference.item);
    }),
  );

  app.put("/api/references/:referenceIdentity", (request, reply) =>
    handleReferenceRequest(request, reply, async () => {
      const projectId = await defaultProjectId(auth, pool, request, reply);
      if (!projectId) return;
      const identity = pathIdentity(request);
      const body = ReferenceMutationRequestSchema.safeParse(request.body);
      if (!identity.success || !body.success || body.data.item.id !== identity.data) {
        return invalidRequest(reply);
      }

      const updated = await references.update({
        projectId,
        citeKey: identity.data,
        item: body.data.item,
      });
      return updated ? reply.send(updated.item) : notFound(reply);
    }),
  );

  app.delete("/api/references/:referenceIdentity", (request, reply) =>
    handleReferenceRequest(request, reply, async () => {
      const projectId = await defaultProjectId(auth, pool, request, reply);
      if (!projectId) return;
      const identity = pathIdentity(request);
      if (!identity.success) return invalidRequest(reply);

      const removed = await references.remove(projectId, identity.data);
      return removed ? reply.code(204).send() : notFound(reply);
    }),
  );
}
