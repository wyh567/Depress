import { describe, expect, it } from "vitest";
import {
  DoiLookupRequestSchema,
  DoiLookupResponseSchema,
} from "./doi-lookup";

describe("DoiLookup contracts", () => {
  it("accepts a minimal request", () => {
    expect(DoiLookupRequestSchema.parse({ doi: "10.1000/xyz" })).toEqual({
      doi: "10.1000/xyz",
    });
  });

  it("rejects extra request fields", () => {
    expect(
      DoiLookupRequestSchema.safeParse({
        doi: "10.1000/xyz",
        url: "https://evil.example",
      }).success,
    ).toBe(false);
  });

  it("accepts success and failure responses", () => {
    expect(
      DoiLookupResponseSchema.parse({
        ok: true,
        item: {
          id: "10.1000/xyz",
          type: "article-journal",
          title: "T",
          DOI: "10.1000/xyz",
        },
      }).ok,
    ).toBe(true);
    expect(
      DoiLookupResponseSchema.parse({
        ok: false,
        error: "DOI_NOT_FOUND",
      }),
    ).toEqual({ ok: false, error: "DOI_NOT_FOUND" });
  });
});
