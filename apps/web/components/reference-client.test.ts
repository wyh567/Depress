import type { CslItem } from "@depress/ast";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReference,
  deleteReference,
  listReferences,
  ReferenceConflictError,
  ReferenceRequestError,
  updateReference,
} from "@/lib/reference-client";

const item: CslItem = {
  id: "smith2024",
  type: "article-journal",
  title: "Reference",
};

function response(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("reference API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses credentialed same-origin list/create/update/delete operations", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([item]))
      .mockResolvedValueOnce(response(item, 201))
      .mockResolvedValueOnce(response({ ...item, title: "Updated" }))
      .mockResolvedValueOnce(response(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listReferences()).resolves.toEqual([item]);
    await expect(createReference(item)).resolves.toEqual(item);
    await expect(updateReference(item.id, { ...item, title: "Updated" })).resolves.toMatchObject({
      title: "Updated",
    });
    await expect(deleteReference(item.id)).resolves.toBeUndefined();
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ credentials: "include" });
    }
  });

  it("reports duplicate citeKeys safely and rejects invalid server CSL", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ error: "REFERENCE_CONFLICT" }, 409))
      .mockResolvedValueOnce(response([{ ...item, ownerId: "leak" }]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createReference(item)).rejects.toBeInstanceOf(ReferenceConflictError);
    await expect(listReferences()).rejects.toBeInstanceOf(ReferenceRequestError);
  });

  it("encodes every path identity segment before update and delete", async () => {
    const identities = [
      "space key",
      "引用2026",
      "slash/key",
      "question?key",
      "hash#key",
    ];
    const fetchMock = vi.fn<typeof fetch>();
    for (const identity of identities) {
      fetchMock
        .mockResolvedValueOnce(response({ ...item, id: identity }))
        .mockResolvedValueOnce(response(null, 204));
    }
    vi.stubGlobal("fetch", fetchMock);

    for (const identity of identities) {
      await updateReference(identity, { ...item, id: identity });
      await deleteReference(identity);
    }

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(
      identities.flatMap((identity) => {
        const path = `/api/references/${encodeURIComponent(identity)}`;
        return [path, path];
      }),
    );
  });
});
