"use client";

import type { CompileTemplateId } from "@depress/ast";

// T-07 (P2-04): the ONE place that persists anything about a compile session.
// It stores an *identity* plus an opaque server job id, and nothing else. The
// signed download URL is deliberately never persisted anywhere -- it stays
// request-scoped and in memory, which compile-controls.test.tsx already pins
// ("uses a signed URL immediately without storing it").
//
// A stored job id is worthless on its own: rehydration always re-reads the job
// through the owner-authorized GET /api/compile-jobs/:jobId and then re-checks
// every identity field before trusting it, so a tampered, foreign, or simply
// stale id can only ever fail closed.

export interface CompileSessionIdentity {
  documentId: string;
  revision: number;
  templateId: CompileTemplateId;
  format: "pdf";
}

const STORAGE_PREFIX = "depress:compile-session:v1";

export function compileSessionStorageKey(
  identity: CompileSessionIdentity,
): string {
  return [
    STORAGE_PREFIX,
    identity.documentId,
    String(identity.revision),
    identity.templateId,
    identity.format,
  ].join(":");
}

// Every accessor is wrapped: sessionStorage throws outright in some privacy
// modes, and compiling must never fail because persistence is unavailable.
function sessionStore(): Storage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return window.sessionStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function readCompileSessionJobId(
  identity: CompileSessionIdentity,
): string | undefined {
  const store = sessionStore();
  if (!store) return undefined;
  try {
    return store.getItem(compileSessionStorageKey(identity)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeCompileSessionJobId(
  identity: CompileSessionIdentity,
  jobId: string,
): void {
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(compileSessionStorageKey(identity), jobId);
  } catch {
    // Quota or privacy-mode failure. Rehydration is a convenience, not a
    // correctness requirement, so this stays silent.
  }
}

export function clearCompileSessionJobId(
  identity: CompileSessionIdentity,
): void {
  const store = sessionStore();
  if (!store) return;
  try {
    store.removeItem(compileSessionStorageKey(identity));
  } catch {
    // See writeCompileSessionJobId.
  }
}
