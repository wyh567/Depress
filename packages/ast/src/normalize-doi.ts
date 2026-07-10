// Pure DOI normalizer (Phase 3 TODO #4). No network, no store, no mutation.
//
// Case policy (explicit):
// DOI names are ASCII-case-insensitive (DOI Handbook). Crossref documents
// that lowercase is preferred for accessibility. Canonical form is therefore
// ASCII-lowercased after prefix stripping so id/DOI comparisons are stable.
// Non-ASCII code points are left as-is by String#toLowerCase locale rules;
// DOI case-insensitivity only covers Basic Latin.

export const DOI_MAX_INPUT_LENGTH = 512;

export type NormalizeDoiResult =
  | { ok: true; doi: string }
  | { ok: false; error: "INVALID_DOI" };

const KNOWN_URL_PREFIX =
  /^(?:https?:\/\/(?:dx\.)?doi\.org\/)/i;
const DOI_SCHEME_PREFIX = /^doi:\s*/i;

// Prefix must be 10.<digits>/…; suffix is non-empty and must not contain
// whitespace. Character class is intentionally permissive (Crossref allows
// punctuation in suffixes; older DOIs may include additional graphics).
const CANONICAL_DOI = /^10\.\d+\/\S+$/;

export function normalizeDoi(input: unknown): NormalizeDoiResult {
  if (typeof input !== "string") {
    return { ok: false, error: "INVALID_DOI" };
  }
  if (input.length > DOI_MAX_INPUT_LENGTH) {
    return { ok: false, error: "INVALID_DOI" };
  }

  let value = input.trim();
  if (value.length === 0) {
    return { ok: false, error: "INVALID_DOI" };
  }

  if (KNOWN_URL_PREFIX.test(value)) {
    value = value.replace(KNOWN_URL_PREFIX, "");
  } else if (DOI_SCHEME_PREFIX.test(value)) {
    value = value.replace(DOI_SCHEME_PREFIX, "");
  }

  value = value.trim();

  // Reject arbitrary URLs / hostnames — only known doi.org prefixes are stripped.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.includes("://")) {
    return { ok: false, error: "INVALID_DOI" };
  }

  if (!CANONICAL_DOI.test(value)) {
    return { ok: false, error: "INVALID_DOI" };
  }

  // ASCII case fold for the Basic Latin range (DOI Handbook equivalence).
  const doi = value.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  return { ok: true, doi };
}
