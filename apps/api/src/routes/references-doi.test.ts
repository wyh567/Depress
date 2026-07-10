import { describe, expect, it, vi } from "vitest";
import { DoiLookupResponseSchema } from "@depress/ast";
import { buildApp } from "../app";
import type { CrossrefClient } from "../services/crossref/crossref-client";

function fakeCrossref(
  impl: CrossrefClient["lookupWork"],
): CrossrefClient {
  return { lookupWork: impl };
}

describe("POST /references/doi/lookup", () => {
  it("returns a trusted CslItem for a valid lookup", async () => {
    const app = buildApp({
      crossref: fakeCrossref(async (doi) => ({
        ok: true,
        work: {
          type: "journal-article",
          title: ["Trusted Title"],
          DOI: doi,
          author: [{ family: "Ada", given: "Lovelace" }],
        },
      })),
    });
    const res = await app.inject({
      method: "POST",
      url: "/references/doi/lookup",
      payload: { doi: "https://doi.org/10.1000/XYZ" },
    });
    expect(res.statusCode).toBe(200);
    const body = DoiLookupResponseSchema.parse(res.json());
    expect(body).toEqual({
      ok: true,
      item: {
        id: "10.1000/xyz",
        DOI: "10.1000/xyz",
        type: "article-journal",
        title: "Trusted Title",
        author: [{ family: "Ada", given: "Lovelace" }],
      },
    });
    expect(JSON.stringify(body)).not.toContain("message-type");
  });

  it("rejects invalid DOI without calling Crossref", async () => {
    const lookupWork = vi.fn();
    const app = buildApp({ crossref: fakeCrossref(lookupWork) });
    const res = await app.inject({
      method: "POST",
      url: "/references/doi/lookup",
      payload: { doi: "https://evil.example/x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: "INVALID_DOI" });
    expect(lookupWork).not.toHaveBeenCalled();
  });

  it("maps not found / timeout / rate limit / unavailable / invalid metadata", async () => {
    const cases = [
      ["DOI_NOT_FOUND", 404],
      ["CROSSREF_TIMEOUT", 504],
      ["CROSSREF_RATE_LIMITED", 429],
      ["CROSSREF_UNAVAILABLE", 502],
      ["INVALID_CROSSREF_METADATA", 422],
    ] as const;

    for (const [error, status] of cases) {
      const app = buildApp({
        crossref: fakeCrossref(async () => ({ ok: false, error })),
      });
      const res = await app.inject({
        method: "POST",
        url: "/references/doi/lookup",
        payload: { doi: "10.1000/xyz" },
      });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ ok: false, error });
    }
  });

  it("fails when Crossref metadata cannot map to CslItem", async () => {
    const app = buildApp({
      crossref: fakeCrossref(async () => ({
        ok: true,
        work: { type: "journal-article", title: ["  "] },
      })),
    });
    const res = await app.inject({
      method: "POST",
      url: "/references/doi/lookup",
      payload: { doi: "10.1000/xyz" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      ok: false,
      error: "INVALID_CROSSREF_METADATA",
    });
  });

  it("does not accept an arbitrary upstream URL from the client", async () => {
    const app = buildApp({
      crossref: fakeCrossref(async () => ({
        ok: true,
        work: { title: ["X"], type: "journal-article" },
      })),
    });
    const res = await app.inject({
      method: "POST",
      url: "/references/doi/lookup",
      payload: {
        doi: "10.1000/xyz",
        url: "https://evil.example/works/10.1000/xyz",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: "INVALID_DOI" });
  });
});
