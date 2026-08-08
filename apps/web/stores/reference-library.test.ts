import type { CslItem } from "@depress/ast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDoiImport } from "../components/library/run-doi-import";
import {
  ReferenceConflictError,
  ReferenceRequestError,
  type ReferenceApiClient,
} from "../lib/reference-client";
import { useReferenceLibrary } from "./reference-library";

const smith: CslItem = {
  id: "smith2024",
  type: "article-journal",
  title: "A Study",
  DOI: "10.1000/smith",
};

function memoryClient(initial: CslItem[] = []) {
  let server = [...initial];
  const client: ReferenceApiClient = {
    listReferences: vi.fn(async () => structuredClone(server)),
    createReference: vi.fn(async (item) => {
      const parsed = item as CslItem;
      if (server.some((existing) => existing.id === parsed.id)) {
        throw new ReferenceConflictError();
      }
      server = [...server, structuredClone(parsed)];
      return structuredClone(parsed);
    }),
    updateReference: vi.fn(async (identity, item) => {
      const parsed = item as CslItem;
      if (!server.some((existing) => existing.id === identity)) {
        throw new ReferenceRequestError();
      }
      server = server.map((existing) => (existing.id === identity ? parsed : existing));
      return structuredClone(parsed);
    }),
    deleteReference: vi.fn(async (identity) => {
      if (!server.some((existing) => existing.id === identity)) {
        throw new ReferenceRequestError();
      }
      server = server.filter((existing) => existing.id !== identity);
    }),
  };
  return { client, server: () => structuredClone(server) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("persisted reference library", () => {
  beforeEach(() => {
    useReferenceLibrary.getState().clear();
  });

  it("loads, manually adds, clears, and reloads confirmed references", async () => {
    const { client } = memoryClient();
    expect(await useReferenceLibrary.getState().load("user-a", client)).toBe(true);
    expect(useReferenceLibrary.getState().items).toEqual([]);

    expect(await useReferenceLibrary.getState().create(smith, client)).toEqual({
      outcome: "added",
      item: smith,
    });
    expect(useReferenceLibrary.getState().lastConfirmedItems).toEqual([smith]);

    useReferenceLibrary.getState().clear();
    await useReferenceLibrary.getState().load("user-a", client);
    expect(useReferenceLibrary.getState().items).toEqual([smith]);
  });

  it("updates and deletes only after server confirmation", async () => {
    const { client } = memoryClient([smith]);
    await useReferenceLibrary.getState().load("user-a", client);
    const updated = { ...smith, title: "Revised Study" };
    expect(await useReferenceLibrary.getState().update(smith.id, updated, client)).toBe(true);
    expect(useReferenceLibrary.getState().items).toEqual([updated]);
    expect(await useReferenceLibrary.getState().remove(smith.id, client)).toBe(true);
    expect(useReferenceLibrary.getState().items).toEqual([]);
    await useReferenceLibrary.getState().load("user-a", client);
    expect(useReferenceLibrary.getState().items).toEqual([]);
  });

  it("shows duplicate conflicts and preserves confirmed state on failure", async () => {
    const { client } = memoryClient([smith]);
    await useReferenceLibrary.getState().load("user-a", client);
    expect(await useReferenceLibrary.getState().create(smith, client)).toEqual({
      outcome: "duplicate_id",
    });
    expect(useReferenceLibrary.getState().error).toContain("citeKey");

    const failing = {
      ...client,
      updateReference: vi.fn(async () => {
        throw new ReferenceRequestError();
      }),
    };
    expect(
      await useReferenceLibrary
        .getState()
        .update(smith.id, { ...smith, title: "Not confirmed" }, failing),
    ).toBe(false);
    expect(useReferenceLibrary.getState().items).toEqual([smith]);
    expect(useReferenceLibrary.getState().lastConfirmedItems).toEqual([smith]);
  });

  it("persists a mocked DOI lookup result and restores it after reload", async () => {
    const { client } = memoryClient();
    await useReferenceLibrary.getState().load("user-a", client);
    const item = { ...smith, id: "10.1000/smith" };
    const result = await runDoiImport("10.1000/smith", {
      apiUrl: "http://api.test",
      hasId: useReferenceLibrary.getState().has,
      hasDoi: useReferenceLibrary.getState().hasDoi,
      tryAdd: (candidate) =>
        useReferenceLibrary.getState().tryAdd(candidate, client),
      fetchFn: vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, item }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });
    expect(result).toEqual({ phase: "success", item });
    useReferenceLibrary.getState().clear();
    await useReferenceLibrary.getState().load("user-a", client);
    expect(useReferenceLibrary.getState().items).toEqual([item]);
  });

  it("persists valid BibTeX entries and restores them after reload", async () => {
    const { client } = memoryClient();
    await useReferenceLibrary.getState().load("user-a", client);
    const result = await useReferenceLibrary.getState().importBibtex(
      "@article{ada2026, title={Persistent BibTeX}, year={2026}}",
      client,
    );
    expect(result).toEqual({ imported: 1, errors: [] });
    useReferenceLibrary.getState().clear();
    await useReferenceLibrary.getState().load("user-a", client);
    expect(useReferenceLibrary.getState().items[0]).toMatchObject({
      id: "ada2026",
      title: "Persistent BibTeX",
    });
  });

  it("ignores a user A load that resolves after logout and user B login", async () => {
    const delayedA = deferred<CslItem[]>();
    const { client: baseA } = memoryClient();
    const clientA = {
      ...baseA,
      listReferences: vi.fn(() => delayedA.promise),
    };
    const userBItem = { ...smith, id: "user-b-reference", title: "User B" };
    const { client: clientB } = memoryClient([userBItem]);

    const loadA = useReferenceLibrary.getState().load("user-a", clientA);
    useReferenceLibrary.getState().clear();
    expect(await useReferenceLibrary.getState().load("user-b", clientB)).toBe(true);
    delayedA.resolve([smith]);

    expect(await loadA).toBe(false);
    expect(useReferenceLibrary.getState().activeUserId).toBe("user-b");
    expect(useReferenceLibrary.getState().items).toEqual([userBItem]);
    expect(useReferenceLibrary.getState().error).toBeNull();
  });

  it("rejects delayed import persistence when its captured session is stale", async () => {
    const { client: clientA } = memoryClient();
    const { client: clientB } = memoryClient();
    await useReferenceLibrary.getState().load("user-a", clientA);
    const userAContext = useReferenceLibrary.getState().captureSession();
    expect(userAContext).toBeDefined();
    if (!userAContext) throw new Error("Expected a captured user A reference session");

    useReferenceLibrary.getState().clear();
    await useReferenceLibrary.getState().load("user-b", clientB);
    expect(
      await useReferenceLibrary
        .getState()
        .tryAdd(smith, clientB, userAContext),
    ).toEqual({ outcome: "failed" });
    expect(clientB.createReference).not.toHaveBeenCalled();
    expect(useReferenceLibrary.getState().items).toEqual([]);
  });

  it("reports each BibTeX row in a partial import without hiding successes", async () => {
    const { client } = memoryClient([smith]);
    await useReferenceLibrary.getState().load("user-a", client);
    const result = await useReferenceLibrary.getState().importBibtex(
      [
        "@article{smith2024, title={Duplicate}}",
        "@book{ada2026, title={Successful row}}",
      ].join("\n"),
      client,
    );

    expect(result).toEqual({
      imported: 1,
      errors: ["Reference smith2024: duplicate citeKey."],
    });
    expect(useReferenceLibrary.getState().items.map((item) => item.id)).toEqual([
      "ada2026",
      "smith2024",
    ]);
  });
});
