import {
  EmptyPersistedDocumentEnvelope,
  type DocumentResource,
} from "@depress/ast";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDocument,
  DocumentConflictError,
  DocumentRequestError,
  getDocument,
  listDocuments,
  updateDocument,
} from "@/lib/document-client";

const documentResource: DocumentResource = {
  id: "39e35789-2e60-4d40-840a-ef10cf05fab7",
  envelope: EmptyPersistedDocumentEnvelope,
  revision: 1,
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("document API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses same-origin credentialed operations and validates every response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(documentResource, 201))
      .mockResolvedValueOnce(jsonResponse(documentResource))
      .mockResolvedValueOnce(
        jsonResponse({ ...documentResource, revision: 2 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listDocuments()).resolves.toEqual([]);
    await expect(createDocument()).resolves.toEqual(documentResource);
    await expect(getDocument(documentResource.id)).resolves.toEqual(documentResource);
    await expect(
      updateDocument(documentResource.id, 1, EmptyPersistedDocumentEnvelope),
    ).resolves.toMatchObject({ revision: 2 });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/documents",
      "/api/documents",
      `/api/documents/${documentResource.id}`,
      `/api/documents/${documentResource.id}`,
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ credentials: "include" });
    }
  });

  it("returns a narrow conflict and rejects unsupported persisted content", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ currentRevision: 4 }, 409))
      .mockResolvedValueOnce(
        jsonResponse({
          ...documentResource,
          envelope: {
            schemaVersion: 1,
            editor: { type: "doc", content: [{ type: "blockquote" }] },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const conflict = await updateDocument(
      documentResource.id,
      1,
      EmptyPersistedDocumentEnvelope,
    ).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(DocumentConflictError);
    expect((conflict as DocumentConflictError).currentRevision).toBe(4);
    await expect(getDocument(documentResource.id)).rejects.toBeInstanceOf(
      DocumentRequestError,
    );
  });
});
