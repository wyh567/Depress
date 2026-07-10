import { describe, expect, it, vi } from "vitest";
import { runDoiImport } from "./run-doi-import";
import type { CslItem } from "@depress/ast";

const item: CslItem = {
  id: "10.1000/xyz",
  DOI: "10.1000/xyz",
  type: "article-journal",
  title: "Imported Title",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("runDoiImport", () => {
  it("adds one item on successful lookup", async () => {
    const tryAdd = vi.fn(() => ({ outcome: "added" as const, item }));
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { ok: true, item }),
    );
    const result = await runDoiImport("10.1000/XYZ", {
      apiUrl: "http://api.test",
      hasId: () => false,
      hasDoi: () => false,
      tryAdd,
      fetchFn: fetchFn as typeof fetch,
    });
    expect(result).toEqual({ phase: "success", item });
    expect(tryAdd).toHaveBeenCalledWith(item);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate id before network", async () => {
    const fetchFn = vi.fn();
    const result = await runDoiImport("10.1000/xyz", {
      apiUrl: "http://api.test",
      hasId: () => true,
      hasDoi: () => false,
      tryAdd: () => ({ outcome: "added", item }),
      fetchFn: fetchFn as typeof fetch,
    });
    expect(result.phase).toBe("already_exists");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects duplicate DOI before network", async () => {
    const fetchFn = vi.fn();
    const result = await runDoiImport("10.1000/xyz", {
      apiUrl: "http://api.test",
      hasId: () => false,
      hasDoi: () => true,
      tryAdd: () => ({ outcome: "added", item }),
      fetchFn: fetchFn as typeof fetch,
    });
    expect(result.phase).toBe("already_exists");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects URL-form duplicate DOI before network", async () => {
    const fetchFn = vi.fn();
    const result = await runDoiImport("https://doi.org/10.1000/AbC", {
      apiUrl: "http://api.test",
      hasId: () => false,
      hasDoi: (doi) => doi === "10.1000/abc",
      tryAdd: () => ({ outcome: "added", item }),
      fetchFn: fetchFn as typeof fetch,
    });
    expect(result.phase).toBe("already_exists");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not mutate library on failed lookup", async () => {
    const tryAdd = vi.fn();
    const result = await runDoiImport("10.1000/missing", {
      apiUrl: "http://api.test",
      hasId: () => false,
      hasDoi: () => false,
      tryAdd,
      fetchFn: (async () =>
        jsonResponse(404, {
          ok: false,
          error: "DOI_NOT_FOUND",
        })) as typeof fetch,
    });
    expect(result).toEqual({
      phase: "not_found",
      message: "未找到该 DOI",
    });
    expect(tryAdd).not.toHaveBeenCalled();
  });

  it("revalidates response and rejects invalid payload", async () => {
    const tryAdd = vi.fn();
    const result = await runDoiImport("10.1000/xyz", {
      apiUrl: "http://api.test",
      hasId: () => false,
      hasDoi: () => false,
      tryAdd,
      fetchFn: (async () =>
        jsonResponse(200, { ok: true, item: { id: "x" } })) as typeof fetch,
    });
    expect(result.phase).toBe("error");
    expect(tryAdd).not.toHaveBeenCalled();
  });

  it("maps rate-limited and timeout errors", async () => {
    const rate = await runDoiImport("10.1000/xyz", {
      apiUrl: "http://api.test",
      hasId: () => false,
      hasDoi: () => false,
      tryAdd: () => ({ outcome: "added", item }),
      fetchFn: (async () =>
        jsonResponse(429, {
          ok: false,
          error: "CROSSREF_RATE_LIMITED",
        })) as typeof fetch,
    });
    expect(rate.phase).toBe("rate_limited");

    const timeout = await runDoiImport("10.1000/xyz", {
      apiUrl: "http://api.test",
      hasId: () => false,
      hasDoi: () => false,
      tryAdd: () => ({ outcome: "added", item }),
      fetchFn: (async () =>
        jsonResponse(504, {
          ok: false,
          error: "CROSSREF_TIMEOUT",
        })) as typeof fetch,
    });
    expect(timeout.phase).toBe("timeout");
  });

  it("checks duplicates again immediately before insert", async () => {
    let hasAfterFetch = false;
    const tryAdd = vi.fn();
    const result = await runDoiImport("10.1000/xyz", {
      apiUrl: "http://api.test",
      hasId: () => hasAfterFetch,
      hasDoi: () => false,
      tryAdd,
      fetchFn: (async () => {
        hasAfterFetch = true;
        return jsonResponse(200, { ok: true, item });
      }) as typeof fetch,
    });
    expect(result.phase).toBe("already_exists");
    expect(tryAdd).not.toHaveBeenCalled();
  });
});
