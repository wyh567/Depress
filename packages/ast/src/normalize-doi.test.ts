import { describe, expect, it } from "vitest";
import { DOI_MAX_INPUT_LENGTH, normalizeDoi } from "./normalize-doi";

describe("normalizeDoi", () => {
  it("accepts a bare DOI", () => {
    expect(normalizeDoi("10.1000/xyz123")).toEqual({
      ok: true,
      doi: "10.1000/xyz123",
    });
  });

  it("strips doi: prefix", () => {
    expect(normalizeDoi("doi:10.1000/xyz123")).toEqual({
      ok: true,
      doi: "10.1000/xyz123",
    });
  });

  it("strips uppercase DOI: prefix with space", () => {
    expect(normalizeDoi("DOI: 10.1000/xyz123")).toEqual({
      ok: true,
      doi: "10.1000/xyz123",
    });
  });

  it("strips https://doi.org/", () => {
    expect(normalizeDoi("https://doi.org/10.1000/xyz123")).toEqual({
      ok: true,
      doi: "10.1000/xyz123",
    });
  });

  it("strips http://doi.org/", () => {
    expect(normalizeDoi("http://doi.org/10.1000/xyz123")).toEqual({
      ok: true,
      doi: "10.1000/xyz123",
    });
  });

  it("strips https://dx.doi.org/", () => {
    expect(normalizeDoi("https://dx.doi.org/10.1000/xyz123")).toEqual({
      ok: true,
      doi: "10.1000/xyz123",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDoi("  10.1000/xyz123  ")).toEqual({
      ok: true,
      doi: "10.1000/xyz123",
    });
  });

  it("preserves valid suffix punctuation", () => {
    expect(normalizeDoi("10.1000/xyz(123)_a-b.1;2")).toEqual({
      ok: true,
      doi: "10.1000/xyz(123)_a-b.1;2",
    });
  });

  it("rejects empty input", () => {
    expect(normalizeDoi("")).toEqual({ ok: false, error: "INVALID_DOI" });
  });

  it("rejects whitespace-only input", () => {
    expect(normalizeDoi("   \t")).toEqual({ ok: false, error: "INVALID_DOI" });
  });

  it("rejects arbitrary URLs", () => {
    expect(normalizeDoi("https://evil.example/10.1000/xyz")).toEqual({
      ok: false,
      error: "INVALID_DOI",
    });
  });

  it("rejects missing slash", () => {
    expect(normalizeDoi("10.1000xyz123")).toEqual({
      ok: false,
      error: "INVALID_DOI",
    });
  });

  it("rejects missing 10. prefix", () => {
    expect(normalizeDoi("11.1000/xyz123")).toEqual({
      ok: false,
      error: "INVALID_DOI",
    });
  });

  it("rejects excessive length", () => {
    const long = `10.1000/${"a".repeat(DOI_MAX_INPUT_LENGTH)}`;
    expect(normalizeDoi(long)).toEqual({ ok: false, error: "INVALID_DOI" });
  });

  it("ASCII-lowercases for canonical form (case policy)", () => {
    expect(normalizeDoi("10.1000/AbC-XyZ")).toEqual({
      ok: true,
      doi: "10.1000/abc-xyz",
    });
    expect(normalizeDoi("HTTPS://DOI.ORG/10.1000/ABC")).toEqual({
      ok: true,
      doi: "10.1000/abc",
    });
  });

  it("is deterministic", () => {
    const a = normalizeDoi("DOI: 10.1000/XyZ");
    const b = normalizeDoi("doi:10.1000/XyZ");
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: true, doi: "10.1000/xyz" });
  });

  it("rejects non-string input", () => {
    expect(normalizeDoi(null)).toEqual({ ok: false, error: "INVALID_DOI" });
    expect(normalizeDoi(10.1)).toEqual({ ok: false, error: "INVALID_DOI" });
  });
});
