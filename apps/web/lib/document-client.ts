import {
  CreateDocumentRequestSchema,
  DocumentListResponseSchema,
  DocumentResourceSchema,
  RevisionConflictResponseSchema,
  SaveDocumentRequestSchema,
  type DocumentResource,
  type DocumentSummary,
  type PersistedDocumentEnvelope,
} from "@depress/ast";

export class DocumentRequestError extends Error {
  constructor() {
    super("The document service is unavailable. Your local edits are still here.");
    this.name = "DocumentRequestError";
  }
}

export class DocumentConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("The server has a newer revision.");
    this.name = "DocumentConflictError";
    this.currentRevision = currentRevision;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DocumentRequestError();
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw new DocumentRequestError();
  }
}

function parseResource(value: unknown): DocumentResource {
  const parsed = DocumentResourceSchema.safeParse(value);
  if (!parsed.success) throw new DocumentRequestError();
  return parsed.data;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const response = await request("/api/documents");
  if (!response.ok) throw new DocumentRequestError();
  const parsed = DocumentListResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new DocumentRequestError();
  return parsed.data;
}

export async function createDocument(): Promise<DocumentResource> {
  const body = CreateDocumentRequestSchema.parse({});
  const response = await request("/api/documents", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new DocumentRequestError();
  return parseResource(await readJson(response));
}

export async function getDocument(documentId: string): Promise<DocumentResource> {
  const response = await request(`/api/documents/${encodeURIComponent(documentId)}`);
  if (!response.ok) throw new DocumentRequestError();
  return parseResource(await readJson(response));
}

export async function updateDocument(
  documentId: string,
  expectedRevision: number,
  envelope: PersistedDocumentEnvelope,
): Promise<DocumentResource> {
  const body = SaveDocumentRequestSchema.parse({ expectedRevision, envelope });
  const response = await request(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const json = await readJson(response);
  if (response.status === 409) {
    const conflict = RevisionConflictResponseSchema.safeParse(json);
    if (!conflict.success) throw new DocumentRequestError();
    throw new DocumentConflictError(conflict.data.currentRevision);
  }
  if (!response.ok) throw new DocumentRequestError();
  return parseResource(json);
}

export interface DocumentApiClient {
  listDocuments: typeof listDocuments;
  createDocument: typeof createDocument;
  getDocument: typeof getDocument;
  updateDocument: typeof updateDocument;
}

export const documentClient: DocumentApiClient = {
  listDocuments,
  createDocument,
  getDocument,
  updateDocument,
};
