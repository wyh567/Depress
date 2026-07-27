import {
  CslItemSchema,
  ReferenceListResponseSchema,
  ReferenceMutationRequestSchema,
  type CslItem,
} from "@depress/ast";

export class ReferenceRequestError extends Error {
  constructor() {
    super("The reference service is unavailable. Confirmed references were not changed.");
    this.name = "ReferenceRequestError";
  }
}

export class ReferenceConflictError extends Error {
  constructor() {
    super("A reference with this citeKey already exists.");
    this.name = "ReferenceConflictError";
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body !== undefined) headers.set("Content-Type", "application/json");
  try {
    return await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ReferenceRequestError();
  }
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ReferenceRequestError();
  }
}

function parseItem(value: unknown): CslItem {
  const parsed = CslItemSchema.safeParse(value);
  if (!parsed.success) throw new ReferenceRequestError();
  return parsed.data;
}

export async function listReferences(): Promise<CslItem[]> {
  const response = await request("/api/references");
  if (!response.ok) throw new ReferenceRequestError();
  const parsed = ReferenceListResponseSchema.safeParse(await json(response));
  if (!parsed.success) throw new ReferenceRequestError();
  return parsed.data;
}

export async function createReference(candidate: unknown): Promise<CslItem> {
  const body = ReferenceMutationRequestSchema.parse({ item: candidate });
  const response = await request("/api/references", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (response.status === 409) throw new ReferenceConflictError();
  if (!response.ok) throw new ReferenceRequestError();
  return parseItem(await json(response));
}

export async function updateReference(
  referenceIdentity: string,
  candidate: unknown,
): Promise<CslItem> {
  const body = ReferenceMutationRequestSchema.parse({ item: candidate });
  const response = await request(
    `/api/references/${encodeURIComponent(referenceIdentity)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new ReferenceRequestError();
  return parseItem(await json(response));
}

export async function deleteReference(referenceIdentity: string): Promise<void> {
  const response = await request(
    `/api/references/${encodeURIComponent(referenceIdentity)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new ReferenceRequestError();
}

export interface ReferenceApiClient {
  listReferences: typeof listReferences;
  createReference: typeof createReference;
  updateReference: typeof updateReference;
  deleteReference: typeof deleteReference;
}

export const referenceClient: ReferenceApiClient = {
  listReferences,
  createReference,
  updateReference,
  deleteReference,
};
