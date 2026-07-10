import { describe, expect, it, vi } from "vitest";
import { CrossrefWorkEnvelopeSchema } from "./provider-schema";
import {
  CROSSREF_ORIGIN,
  createCrossrefClient,
} from "./crossref-client";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const okEnvelope = {
  status: "ok",
  "message-type": "work",
  message: {
    DOI: "10.1000/xyz",
    type: "journal-article",
    title: ["Hello"],
    extraUnrelated: { nested: true },
  },
};

describe("CrossrefWorkEnvelopeSchema", () => {
  it("accepts a valid response and unrelated fields", () => {
    const parsed = CrossrefWorkEnvelopeSchema.parse(okEnvelope);
    expect(parsed.status).toBe("ok");
    expect(parsed.message.title).toEqual(["Hello"]);
  });

  it("rejects a malformed envelope", () => {
    expect(CrossrefWorkEnvelopeSchema.safeParse({ status: "ok" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed message title", () => {
    expect(
      CrossrefWorkEnvelopeSchema.safeParse({
        status: "ok",
        message: { title: "not-an-array" },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed authors", () => {
    expect(
      CrossrefWorkEnvelopeSchema.safeParse({
        status: "ok",
        message: { author: "smith" },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed date-parts", () => {
    expect(
      CrossrefWorkEnvelopeSchema.safeParse({
        status: "ok",
        message: { issued: { "date-parts": [["2020"]] } },
      }).success,
    ).toBe(false);
  });
});

describe("createCrossrefClient", () => {
  it("calls the fixed origin with a safely encoded DOI and optional mailto", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url.startsWith(`${CROSSREF_ORIGIN}/works/`)).toBe(true);
      expect(url).toContain(encodeURIComponent("10.1000/a/b"));
      expect(url).toContain("mailto=ops%40example.com");
      return jsonResponse(200, okEnvelope);
    });
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      mailto: "ops@example.com",
      sleep: async () => undefined,
    });
    const result = await client.lookupWork("10.1000/a/b");
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps 404 to DOI_NOT_FOUND without retry", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(404, { status: "error" }));
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      sleep: async () => undefined,
    });
    await expect(client.lookupWork("10.1000/missing")).resolves.toEqual({
      ok: false,
      error: "DOI_NOT_FOUND",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps 400 to INVALID_DOI without retry", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(400, { status: "error" }));
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      sleep: async () => undefined,
    });
    await expect(client.lookupWork("10.1000/bad")).resolves.toEqual({
      ok: false,
      error: "INVALID_DOI",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries once on 429 using bounded Retry-After", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(429, { status: "error" }, { "Retry-After": "1" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, okEnvelope));
    const sleep = vi.fn(async () => undefined);
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      sleep,
    });
    const result = await client.lookupWork("10.1000/xyz");
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("caps Retry-After at 2 seconds and stops after two attempts", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, { status: "error" }, { "Retry-After": "999" }));
    const sleep = vi.fn(async () => undefined);
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      sleep,
    });
    await expect(client.lookupWork("10.1000/xyz")).resolves.toEqual({
      ok: false,
      error: "CROSSREF_RATE_LIMITED",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("retries once on selected 5xx then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { status: "error" }))
      .mockResolvedValueOnce(jsonResponse(200, okEnvelope));
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      sleep: async () => undefined,
    });
    await expect(client.lookupWork("10.1000/xyz")).resolves.toMatchObject({
      ok: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("returns CROSSREF_TIMEOUT on abort", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const err = new Error("aborted");
      err.name = "AbortError";
      // Consume signal to satisfy types.
      void init?.signal;
      throw err;
    });
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      maxAttempts: 1,
      sleep: async () => undefined,
    });
    await expect(client.lookupWork("10.1000/xyz")).resolves.toEqual({
      ok: false,
      error: "CROSSREF_TIMEOUT",
    });
  });

  it("returns CROSSREF_UNAVAILABLE on fetch rejection after retries", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      sleep: async () => undefined,
    });
    await expect(client.lookupWork("10.1000/xyz")).resolves.toEqual({
      ok: false,
      error: "CROSSREF_UNAVAILABLE",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed JSON without leaking the body", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response("<html>nope</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      sleep: async () => undefined,
    });
    const result = await client.lookupWork("10.1000/xyz");
    expect(result).toEqual({ ok: false, error: "INVALID_CROSSREF_METADATA" });
    expect(JSON.stringify(result)).not.toContain("<html>");
  });

  it("rejects invalid provider payload", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { status: "ok", message: { title: 123 } }),
    );
    const client = createCrossrefClient({
      fetchFn: fetchFn as typeof fetch,
      sleep: async () => undefined,
    });
    await expect(client.lookupWork("10.1000/xyz")).resolves.toEqual({
      ok: false,
      error: "INVALID_CROSSREF_METADATA",
    });
  });
});
