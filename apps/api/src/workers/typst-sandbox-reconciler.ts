import { spawn, type ChildProcess } from "node:child_process";
import {
  isDockerContainerAlreadyRemoved,
  isDockerContainerId,
  runBoundedCommand,
  SANDBOX_LABELS,
  SANDBOX_LIMITS,
  type BoundedCommandTimings,
  type ManagedChildProcess,
  type SpawnProcess,
} from "./typst-sandbox";

// Fixed label keys inspected on Docker-owned metadata. Cleanup authorization
// requires both values exactly; filter matches alone never authorize removal.
export const SANDBOX_LABEL_KEYS = {
  managed: "com.depress.managed",
  component: "com.depress.component",
} as const;

export const SANDBOX_LABEL_VALUES = {
  managed: "true",
  component: "typst-sandbox",
} as const;

// Maximum application-owned lifecycle window from B1 limits.
export const SANDBOX_LIFECYCLE_WINDOW_MS =
  SANDBOX_LIMITS.timeoutMs +
  SANDBOX_LIMITS.termGraceMs +
  SANDBOX_LIMITS.killGraceMs +
  SANDBOX_LIMITS.cleanupTimeoutMs +
  SANDBOX_LIMITS.cleanupTermGraceMs +
  SANDBOX_LIMITS.cleanupKillGraceMs;

// Conservative daemon/scheduling margin beyond the application-owned window.
export const SANDBOX_STALE_SAFETY_MARGIN_MS = 60_000;

// Code-owned stale threshold. Not configurable via HTTP, queue, or documents.
export const SANDBOX_STALE_THRESHOLD_MS =
  SANDBOX_LIFECYCLE_WINDOW_MS + SANDBOX_STALE_SAFETY_MARGIN_MS;

const ACTIVE_STATES = new Set(["created", "running", "restarting", "paused"]);
const TERMINAL_STATES = new Set(["exited", "dead"]);

const RECONCILER_COMMAND_LIMITS = {
  timeoutMs: 10_000,
  termGraceMs: SANDBOX_LIMITS.cleanupTermGraceMs,
  killGraceMs: SANDBOX_LIMITS.cleanupKillGraceMs,
  maxOutputBytes: 256 * 1024,
} as const;

const CLEANUP_COMMAND_LIMITS = {
  timeoutMs: SANDBOX_LIMITS.cleanupTimeoutMs,
  termGraceMs: SANDBOX_LIMITS.cleanupTermGraceMs,
  killGraceMs: SANDBOX_LIMITS.cleanupKillGraceMs,
  maxOutputBytes: SANDBOX_LIMITS.maxOutputBytes,
} as const;

export type ReconciliationFailureReason =
  | "DISCOVERY_FAILED"
  | "INVALID_CONTAINER_ID"
  | "INSPECT_FAILED"
  | "IDENTITY_MISMATCH"
  | "LABEL_MISMATCH"
  | "INVALID_CREATED_AT"
  | "UNKNOWN_CONTAINER_STATE"
  | "CLEANUP_FAILED";

export class TypstSandboxReconciliationError extends Error {
  constructor(readonly reason: ReconciliationFailureReason) {
    super("Typst sandbox reconciliation failed");
    this.name = "TypstSandboxReconciliationError";
  }
}

export interface TypstSandboxReconciliationResult {
  scannedCount: number;
  keptCount: number;
  removedCount: number;
  terminalRemovedCount: number;
  staleRemovedCount: number;
}

type RemovalClass = "stale" | "terminal";

type PolicyDecision = { action: "keep" } | { action: "remove"; removalClass: RemovalClass };

const defaultSpawnProcess: SpawnProcess = (command, args, options) =>
  spawn(command, args, options) as ChildProcess as ManagedChildProcess;

export function buildSandboxDiscoveryArgs(): string[] {
  return [
    "ps",
    "-a",
    "--no-trunc",
    "--quiet",
    "--filter",
    `label=${SANDBOX_LABELS.managed}`,
    "--filter",
    `label=${SANDBOX_LABELS.component}`,
  ];
}

export function buildSandboxInspectArgs(containerId: string): string[] {
  return ["inspect", containerId];
}

export function buildSandboxCleanupArgs(containerId: string): string[] {
  return ["rm", "--force", containerId];
}

export function parseDockerCreatedAtMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // Docker may emit nanosecond fractions; Date only resolves milliseconds.
  const normalized = value.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

export function classifySandboxContainer(options: {
  status: string;
  createdAtMs: number;
  nowMs: number;
  staleThresholdMs: number;
}): PolicyDecision | ReconciliationFailureReason {
  if (options.createdAtMs > options.nowMs) return "INVALID_CREATED_AT";

  if (TERMINAL_STATES.has(options.status)) {
    return { action: "remove", removalClass: "terminal" };
  }

  if (!ACTIVE_STATES.has(options.status)) {
    return "UNKNOWN_CONTAINER_STATE";
  }

  const ageMs = options.nowMs - options.createdAtMs;
  // Equal to the threshold remains KEEP: only strictly older containers are stale.
  if (ageMs > options.staleThresholdMs) {
    return { action: "remove", removalClass: "stale" };
  }
  return { action: "keep" };
}

function fail(reason: ReconciliationFailureReason): never {
  throw new TypstSandboxReconciliationError(reason);
}

function parseDiscoveryIds(stdout: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (rawLine.length === 0) continue;
    const id = rawLine.trim();
    if (id.length === 0) continue;
    if (!isDockerContainerId(id)) fail("INVALID_CONTAINER_ID");
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function readLabel(labels: Record<string, unknown>, key: string): string | undefined {
  const value = labels[key];
  return typeof value === "string" ? value : undefined;
}

function parseInspectPayload(
  stdoutText: string,
  requestedId: string
): {
  status: string;
  createdAtMs: number;
  hasRunIdLabel: boolean;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdoutText);
  } catch {
    fail("INSPECT_FAILED");
  }

  if (!Array.isArray(parsed) || parsed.length !== 1) fail("INSPECT_FAILED");
  const object = parsed[0];
  if (object === null || typeof object !== "object" || Array.isArray(object)) {
    fail("INSPECT_FAILED");
  }
  const record = object as Record<string, unknown>;
  if (record["Id"] !== requestedId) fail("IDENTITY_MISMATCH");

  const createdAtMs = parseDockerCreatedAtMs(record["Created"]);
  if (createdAtMs === null) fail("INVALID_CREATED_AT");

  const state = record["State"];
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    fail("UNKNOWN_CONTAINER_STATE");
  }
  const status = (state as Record<string, unknown>)["Status"];
  if (typeof status !== "string" || status.length === 0) {
    fail("UNKNOWN_CONTAINER_STATE");
  }

  const config = record["Config"];
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    fail("LABEL_MISMATCH");
  }
  const labelsRaw = (config as Record<string, unknown>)["Labels"];
  if (labelsRaw === null || typeof labelsRaw !== "object" || Array.isArray(labelsRaw)) {
    fail("LABEL_MISMATCH");
  }
  const labels = labelsRaw as Record<string, unknown>;
  if (readLabel(labels, SANDBOX_LABEL_KEYS.managed) !== SANDBOX_LABEL_VALUES.managed) {
    fail("LABEL_MISMATCH");
  }
  if (readLabel(labels, SANDBOX_LABEL_KEYS.component) !== SANDBOX_LABEL_VALUES.component) {
    fail("LABEL_MISMATCH");
  }

  return {
    status,
    createdAtMs,
    hasRunIdLabel: typeof labels[SANDBOX_LABELS.runId] === "string",
  };
}

async function removeExactContainer(
  spawnProcess: SpawnProcess,
  containerId: string,
  cleanupLimits: BoundedCommandTimings
): Promise<void> {
  if (!isDockerContainerId(containerId)) fail("INVALID_CONTAINER_ID");

  const result = await runBoundedCommand(
    spawnProcess,
    "docker",
    buildSandboxCleanupArgs(containerId),
    cleanupLimits
  );
  if (result.status === "exited" && result.code === 0) return;
  if (result.status === "exited" && isDockerContainerAlreadyRemoved(result.stderrText)) {
    return;
  }
  fail("CLEANUP_FAILED");
}

export async function reconcileStaleTypstSandboxContainers(
  options: {
    spawnProcess?: SpawnProcess;
    nowMs?: () => number;
    staleThresholdMs?: number;
    // Test-only timing overrides. Production callers omit these and keep
    // the code-owned RECONCILER_COMMAND_LIMITS / CLEANUP_COMMAND_LIMITS.
    commandLimits?: Partial<BoundedCommandTimings>;
    cleanupLimits?: Partial<BoundedCommandTimings>;
  } = {}
): Promise<TypstSandboxReconciliationResult> {
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  const nowMs = options.nowMs ?? (() => Date.now());
  const staleThresholdMs = options.staleThresholdMs ?? SANDBOX_STALE_THRESHOLD_MS;
  const commandLimits: BoundedCommandTimings = {
    ...RECONCILER_COMMAND_LIMITS,
    ...options.commandLimits,
  };
  const cleanupLimits: BoundedCommandTimings = {
    ...CLEANUP_COMMAND_LIMITS,
    ...options.cleanupLimits,
  };

  const discovery = await runBoundedCommand(
    spawnProcess,
    "docker",
    buildSandboxDiscoveryArgs(),
    commandLimits
  );
  if (discovery.status !== "exited" || discovery.code !== 0 || discovery.stdout.truncated) {
    fail("DISCOVERY_FAILED");
  }

  const candidateIds = parseDiscoveryIds(discovery.stdoutText);
  let keptCount = 0;
  let terminalRemovedCount = 0;
  let staleRemovedCount = 0;

  for (const containerId of candidateIds) {
    const inspect = await runBoundedCommand(
      spawnProcess,
      "docker",
      buildSandboxInspectArgs(containerId),
      commandLimits
    );
    // Discovery-to-inspect race: original --rm may remove the container before
    // inspect. Treat Docker not-found as idempotent disappearance — never as a
    // generic inspect success, and never as authorization to clean anything.
    if (
      inspect.status === "exited" &&
      inspect.code !== 0 &&
      isDockerContainerAlreadyRemoved(inspect.stderrText)
    ) {
      continue;
    }
    if (inspect.status !== "exited" || inspect.code !== 0 || inspect.stdout.truncated) {
      fail("INSPECT_FAILED");
    }

    const metadata = parseInspectPayload(inspect.stdoutText, containerId);
    void metadata.hasRunIdLabel;

    const decision = classifySandboxContainer({
      status: metadata.status,
      createdAtMs: metadata.createdAtMs,
      nowMs: nowMs(),
      staleThresholdMs,
    });
    if (typeof decision === "string") fail(decision);
    if (decision.action === "keep") {
      keptCount += 1;
      continue;
    }

    await removeExactContainer(spawnProcess, containerId, cleanupLimits);
    if (decision.removalClass === "terminal") terminalRemovedCount += 1;
    else staleRemovedCount += 1;
  }

  return {
    scannedCount: candidateIds.length,
    keptCount,
    removedCount: terminalRemovedCount + staleRemovedCount,
    terminalRemovedCount,
    staleRemovedCount,
  };
}
