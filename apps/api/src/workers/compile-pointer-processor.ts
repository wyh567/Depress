import { randomUUID } from "node:crypto";
import {
  CompileQueuePointerSchema,
  type CompileSnapshot,
  type CompileQueuePointer,
  type PersistedCompileJobErrorCode,
} from "@depress/ast";
import {
  createCompileExecutionRepository,
  type CompileExecutionRepository,
} from "../db/compile-execution-repository";
import { hashCompileSnapshot } from "../db/compile-job-repository";
import {
  executeCompileRequest,
  type CompileProcessorDeps,
} from "./compile-processor";
import type { Pool } from "pg";

export const PROCESSING_STALE_AFTER_MS = 30_000;
const MIN_STALE_AFTER_MS = 5_000;
const MAX_STALE_AFTER_MS = 5 * 60_000;

export type CompilePointerOutcome =
  | { status: "succeeded"; artifactKey: string; pdfByteLength: number }
  | { status: "noop"; reason: "active" | "terminal" | "lost-ownership" }
  | { status: "failed"; error: PersistedCompileJobErrorCode };

export interface CompilePointerProcessorDeps extends CompileProcessorDeps {
  repository: CompileExecutionRepository;
  createToken?: () => string;
  now?: () => Date;
  staleAfterMs?: number;
}

function safeStaleAfter(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_STALE_AFTER_MS ||
    value > MAX_STALE_AFTER_MS
  ) {
    throw new Error("Pointer worker stale-processing window is invalid");
  }
  return value;
}

async function failQueued(
  repository: CompileExecutionRepository,
  jobId: string,
  error: PersistedCompileJobErrorCode,
): Promise<CompilePointerOutcome> {
  await repository.failQueued(jobId, error);
  return { status: "failed", error };
}

export async function processCompilePointer(
  payload: unknown,
  deps: CompilePointerProcessorDeps,
): Promise<CompilePointerOutcome> {
  const parsed = CompileQueuePointerSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: "failed", error: "JOB_STATE_INVALID" };
  }
  const pointer: CompileQueuePointer = parsed.data;
  const row = await deps.repository.load(pointer.jobId);
  if (!row) {
    return { status: "failed", error: "JOB_STATE_INVALID" };
  }
  if (row.status === "succeeded" || row.status === "failed") {
    return { status: "noop", reason: "terminal" };
  }
  if (row.snapshotHash !== pointer.snapshotHash) {
    return failQueued(
      deps.repository,
      pointer.jobId,
      "SNAPSHOT_HASH_MISMATCH",
    );
  }

  let trustedSnapshot: CompileSnapshot;
  try {
    const hashed = hashCompileSnapshot(row.inputSnapshot);
    if (hashed.hash !== row.snapshotHash) {
      return failQueued(
        deps.repository,
        pointer.jobId,
        "SNAPSHOT_HASH_MISMATCH",
      );
    }
    trustedSnapshot = hashed.snapshot;
  } catch {
    return failQueued(deps.repository, pointer.jobId, "SNAPSHOT_INVALID");
  }

  // The publisher may enqueue before its transaction changes accepted to
  // queued. A bounded BullMQ retry observes queued later; accepted work is
  // never compiled directly.
  if (row.status === "accepted") {
    return { status: "failed", error: "JOB_STATE_INVALID" };
  }

  const staleAfterMs = safeStaleAfter(
    deps.staleAfterMs ?? PROCESSING_STALE_AFTER_MS,
  );
  const now = (deps.now ?? (() => new Date()))();
  const token = (deps.createToken ?? randomUUID)();
  const claimed = await deps.repository.claim(
    pointer.jobId,
    token,
    new Date(now.getTime() - staleAfterMs),
  );
  if (!claimed) {
    const current = await deps.repository.load(pointer.jobId);
    if (current?.status === "processing") {
      return { status: "noop", reason: "active" };
    }
    if (current?.status === "succeeded" || current?.status === "failed") {
      return { status: "noop", reason: "terminal" };
    }
    return { status: "failed", error: "JOB_STATE_INVALID" };
  }

  const execution = await executeCompileRequest(
    pointer.jobId,
    trustedSnapshot.compileRequest,
    deps,
  );
  if (execution.status === "failed") {
    const error: PersistedCompileJobErrorCode =
      execution.error === "UPLOAD_FAILED" ? "UPLOAD_FAILED" : "COMPILE_FAILED";
    const owned = await deps.repository.failOwned(pointer.jobId, token, error);
    return owned
      ? { status: "failed", error }
      : { status: "noop", reason: "lost-ownership" };
  }

  const owned = await deps.repository.succeed(
    pointer.jobId,
    token,
    execution.artifactKey,
    execution.pdfByteLength,
  );
  return owned
    ? execution
    : { status: "noop", reason: "lost-ownership" };
}

export function createDatabaseCompilePointerProcessor(
  pool: Pool,
  deps: Omit<CompilePointerProcessorDeps, "repository">,
) {
  const repository = createCompileExecutionRepository(pool);
  return (payload: unknown) =>
    processCompilePointer(payload, { ...deps, repository });
}
