import {
  CreateDocumentRequestSchema,
  DocumentIdSchema,
  DocumentListResponseSchema,
  DocumentResourceSchema,
  EmptyPersistedDocumentEnvelope,
  RevisionConflictResponseSchema,
  SaveDocumentRequestSchema,
  type DocumentResource,
} from "@depress/ast";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { MentorAuth } from "../auth/auth";
import { requireAuthenticatedUser } from "../auth/fastify-auth";
import {
  createDocumentRepository,
  type DocumentRecord,
} from "../db/document-repository";
import { createProjectRepository } from "../db/project-repository";

function toResource(document: DocumentRecord): DocumentResource {
  return DocumentResourceSchema.parse({
    id: document.id,
    envelope: document.envelope,
    revision: document.revision,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  });
}

function titleOf(document: DocumentRecord): string {
  return document.envelope.metadata?.title ?? "Untitled";
}

async function defaultProjectId(
  auth: MentorAuth,
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | undefined> {
  const user = await requireAuthenticatedUser(auth, request, reply);
  if (!user) return undefined;
  const project = await createProjectRepository(pool).getOrCreateDefaultProject(user.id);
  return project.id;
}

function invalidRequest(reply: FastifyReply) {
  return reply.code(400).send({ error: "INVALID_REQUEST" });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "DOCUMENT_NOT_FOUND" });
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  auth: MentorAuth,
  pool: Pool,
): void {
  const documents = createDocumentRepository(pool);

  app.get("/api/documents", async (request, reply) => {
    const projectId = await defaultProjectId(auth, pool, request, reply);
    if (!projectId) return;

    const response = (await documents.list(projectId)).map((document) => ({
      id: document.id,
      title: titleOf(document),
      revision: document.revision,
      updatedAt: document.updatedAt.toISOString(),
    }));
    return reply.send(DocumentListResponseSchema.parse(response));
  });

  app.post("/api/documents", async (request, reply) => {
    const projectId = await defaultProjectId(auth, pool, request, reply);
    if (!projectId) return;
    const body = CreateDocumentRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return invalidRequest(reply);

    const document = await documents.create({
      projectId,
      envelope: EmptyPersistedDocumentEnvelope,
    });
    return reply.code(201).send(toResource(document));
  });

  app.get("/api/documents/:documentId", async (request, reply) => {
    const projectId = await defaultProjectId(auth, pool, request, reply);
    if (!projectId) return;
    const documentId = DocumentIdSchema.safeParse(
      (request.params as { documentId?: unknown }).documentId,
    );
    if (!documentId.success) return invalidRequest(reply);

    const document = await documents.get({
      projectId,
      documentId: documentId.data,
    });
    return document ? reply.send(toResource(document)) : notFound(reply);
  });

  app.put("/api/documents/:documentId", async (request, reply) => {
    const projectId = await defaultProjectId(auth, pool, request, reply);
    if (!projectId) return;
    const documentId = DocumentIdSchema.safeParse(
      (request.params as { documentId?: unknown }).documentId,
    );
    const body = SaveDocumentRequestSchema.safeParse(request.body);
    if (!documentId.success || !body.success) return invalidRequest(reply);

    const result = await documents.save({
      projectId,
      documentId: documentId.data,
      expectedRevision: body.data.expectedRevision,
      envelope: body.data.envelope,
    });
    if (result.status === "not_found") return notFound(reply);
    if (result.status === "conflict") {
      return reply
        .code(409)
        .send(
          RevisionConflictResponseSchema.parse({ currentRevision: result.currentRevision }),
        );
    }
    return reply.send(toResource(result.document));
  });
}
