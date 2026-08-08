import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  SANDBOX_LABELS,
  isDockerContainerAlreadyRemoved,
  type ManagedChildProcess,
  type SpawnProcess,
} from "./typst-sandbox";
import {
  SANDBOX_LABEL_KEYS,
  SANDBOX_LABEL_VALUES,
  SANDBOX_LIFECYCLE_WINDOW_MS,
  SANDBOX_STALE_SAFETY_MARGIN_MS,
  SANDBOX_STALE_THRESHOLD_MS,
  TypstSandboxReconciliationError,
  buildSandboxCleanupArgs,
  buildSandboxDiscoveryArgs,
  buildSandboxInspectArgs,
  classifySandboxContainer,
  parseDockerCreatedAtMs,
  reconcileStaleTypstSandboxContainers,
} from "./typst-sandbox-reconciler";

const CID_A = "a".repeat(64);
const CID_B = "b".repeat(64);
const NOW_MS = Date.parse("2026-07-12T12:00:00.000Z");

class FakeChild extends EventEmitter implements ManagedChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly signals: NodeJS.Signals[] = [];
  onKill?: (signal: NodeJS.Signals) => boolean | void;

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return this.onKill?.(signal) ?? true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: Parameters<SpawnProcess>[2];
  child: FakeChild;
}

function spawnHarness(behavior: (call: SpawnCall) => void | Promise<void>): {
  spawnProcess: SpawnProcess;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawnProcess: SpawnProcess = (command, args, options) => {
    const child = new FakeChild();
    const call = { command, args, options, child };
    calls.push(call);
    queueMicrotask(() => {
      void Promise.resolve(behavior(call)).catch((error: unknown) => {
        child.emit("error", error instanceof Error ? error : new Error("fake failure"));
      });
    });
    return child;
  };
  return { spawnProcess, calls };
}

function createdIso(ageMs: number): string {
  return new Date(NOW_MS - ageMs).toISOString();
}

// Inspect is container-scoped, so argv is ["container", "inspect", <id>].
// Tests match on that exact shape: a harness that still keyed on args[0]
// would silently stop recognising inspect calls if the scoping regressed.
function isInspectCall(args: readonly string[]): boolean {
  return args[0] === "container" && args[1] === "inspect";
}

function inspectedId(args: readonly string[]): string {
  return args[2] ?? "";
}

// Nonzero short timings for timeout-path tests. Production defaults stay in
// RECONCILER_COMMAND_LIMITS / CLEANUP_COMMAND_LIMITS; tests must not wait them.
function fastCommandLimits() {
  return {
    timeoutMs: 40,
    termGraceMs: 20,
    killGraceMs: 20,
    maxOutputBytes: 256 * 1024,
  } as const;
}

function fastCleanupLimits() {
  return {
    timeoutMs: 40,
    termGraceMs: 20,
    killGraceMs: 20,
    maxOutputBytes: 64 * 1024,
  } as const;
}

function inspectJson(options: {
  id: string;
  status: string;
  ageMs: number;
  labels?: Record<string, string>;
  created?: string;
  omitLabels?: boolean;
  idOverride?: string;
}): string {
  const labels =
    options.labels ??
    ({
      [SANDBOX_LABEL_KEYS.managed]: SANDBOX_LABEL_VALUES.managed,
      [SANDBOX_LABEL_KEYS.component]: SANDBOX_LABEL_VALUES.component,
      [SANDBOX_LABELS.runId]: "00000000-0000-4000-8000-000000000001",
    } as Record<string, string>);
  const payload: Record<string, unknown> = {
    Id: options.idOverride ?? options.id,
    Created: options.created ?? createdIso(options.ageMs),
    State: { Status: options.status },
    Config: options.omitLabels ? {} : { Labels: labels },
  };
  return JSON.stringify([payload]);
}

function expectSafeError(error: unknown): TypstSandboxReconciliationError {
  expect(error).toBeInstanceOf(TypstSandboxReconciliationError);
  const typed = error as TypstSandboxReconciliationError;
  expect(typed.message).toBe("Typst sandbox reconciliation failed");
  expect(JSON.stringify(typed)).not.toMatch(/[0-9a-f]{64}/i);
  expect(typed.message).not.toMatch(/docker/i);
  expect(typed.message).not.toMatch(/stderr/i);
  return typed;
}

describe("sandbox reconciliation policy constants", () => {
  it("derives the stale threshold from B1 lifecycle limits plus margin", () => {
    expect(SANDBOX_LIFECYCLE_WINDOW_MS).toBe(38_000);
    expect(SANDBOX_STALE_SAFETY_MARGIN_MS).toBe(60_000);
    expect(SANDBOX_STALE_THRESHOLD_MS).toBe(98_000);
  });
});

// Shared with exact-CID cleanup in typst-sandbox.ts, but load-bearing here:
// reconciliation depends on it to tell a benign disappearance apart from a
// real inspect failure. Docker names a missing container differently depending
// on which surface answered, so both wordings must read as absence — while
// every other failure, including any non-zero exit on its own, fails closed.
describe("isDockerContainerAlreadyRemoved", () => {
  it("recognises both Docker wordings for a missing container", () => {
    expect(
      isDockerContainerAlreadyRemoved(`Error response from daemon: No such container: ${CID_A}`)
    ).toBe(true);
    expect(isDockerContainerAlreadyRemoved(`Error: No such object: ${CID_A}`)).toBe(true);
    expect(isDockerContainerAlreadyRemoved("ERROR: NO SUCH CONTAINER: x")).toBe(true);
    expect(isDockerContainerAlreadyRemoved("Error: No Such Object: x")).toBe(true);
  });

  it("does not treat any other stderr as absence", () => {
    expect(isDockerContainerAlreadyRemoved("")).toBe(false);
    expect(isDockerContainerAlreadyRemoved("Error: Cannot connect to the Docker daemon")).toBe(
      false
    );
    expect(isDockerContainerAlreadyRemoved("Got permission denied while trying to connect")).toBe(
      false
    );
    expect(isDockerContainerAlreadyRemoved("Error: container is already in use")).toBe(false);
    expect(isDockerContainerAlreadyRemoved("no such file or directory")).toBe(false);
  });
});

describe("buildSandboxDiscoveryArgs", () => {
  it("uses docker ps -a --no-trunc --quiet with both fixed label filters", () => {
    expect(buildSandboxDiscoveryArgs()).toEqual([
      "ps",
      "-a",
      "--no-trunc",
      "--quiet",
      "--filter",
      `label=${SANDBOX_LABELS.managed}`,
      "--filter",
      `label=${SANDBOX_LABELS.component}`,
    ]);
  });
});

describe("classifySandboxContainer", () => {
  it("keeps active containers at the exact threshold boundary", () => {
    expect(
      classifySandboxContainer({
        status: "running",
        createdAtMs: NOW_MS - SANDBOX_STALE_THRESHOLD_MS,
        nowMs: NOW_MS,
        staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
      })
    ).toEqual({ action: "keep" });
  });

  it("removes active containers strictly older than the threshold", () => {
    expect(
      classifySandboxContainer({
        status: "running",
        createdAtMs: NOW_MS - SANDBOX_STALE_THRESHOLD_MS - 1,
        nowMs: NOW_MS,
        staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
      })
    ).toEqual({ action: "remove", removalClass: "stale" });
  });

  it("keeps young created/restarting/paused containers", () => {
    for (const status of ["created", "restarting", "paused"] as const) {
      expect(
        classifySandboxContainer({
          status,
          createdAtMs: NOW_MS - 1_000,
          nowMs: NOW_MS,
          staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
        })
      ).toEqual({ action: "keep" });
    }
  });

  it("removes terminal exited and dead states regardless of age", () => {
    expect(
      classifySandboxContainer({
        status: "exited",
        createdAtMs: NOW_MS - 1,
        nowMs: NOW_MS,
        staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
      })
    ).toEqual({ action: "remove", removalClass: "terminal" });
    expect(
      classifySandboxContainer({
        status: "dead",
        createdAtMs: NOW_MS - 1,
        nowMs: NOW_MS,
        staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
      })
    ).toEqual({ action: "remove", removalClass: "terminal" });
  });

  // "removing" is Docker's own auto-removal transit state, not an anomaly.
  // Skipping it leaves deletion to the daemon instead of racing it, and keeps
  // a routine transient from blocking Worker startup. Age is irrelevant here:
  // a container already being deleted is never a stale-removal candidate.
  it("skips containers the daemon is already removing, at any age", () => {
    expect(
      classifySandboxContainer({
        status: "removing",
        createdAtMs: NOW_MS - 1,
        nowMs: NOW_MS,
        staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
      })
    ).toEqual({ action: "skip" });
    expect(
      classifySandboxContainer({
        status: "removing",
        createdAtMs: NOW_MS - (SANDBOX_STALE_THRESHOLD_MS + 1),
        nowMs: NOW_MS,
        staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
      })
    ).toEqual({ action: "skip" });
  });

  it("still fails closed for genuinely unknown states", () => {
    for (const status of ["mystery-state", "", "REMOVING", "removing-now"]) {
      expect(
        classifySandboxContainer({
          status,
          createdAtMs: NOW_MS - 1,
          nowMs: NOW_MS,
          staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
        })
      ).toBe("UNKNOWN_CONTAINER_STATE");
    }
  });

  it("fails closed for future Created timestamps in non-removing states", () => {
    expect(
      classifySandboxContainer({
        status: "running",
        createdAtMs: NOW_MS + 1,
        nowMs: NOW_MS,
        staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
      })
    ).toBe("INVALID_CREATED_AT");
    expect(
      classifySandboxContainer({
        status: "exited",
        createdAtMs: NOW_MS + 1,
        nowMs: NOW_MS,
        staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
      })
    ).toBe("INVALID_CREATED_AT");
  });
});

describe("parseDockerCreatedAtMs", () => {
  it("parses Docker nanosecond timestamps", () => {
    expect(parseDockerCreatedAtMs("2026-07-12T12:00:00.123456789Z")).toBe(
      Date.parse("2026-07-12T12:00:00.123Z")
    );
  });
});

describe("reconcileStaleTypstSandboxContainers", () => {
  it("succeeds with empty discovery and never cleans up", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ child }) => {
      child.stdout.write("");
      child.close(0);
    });
    await expect(
      reconcileStaleTypstSandboxContainers({
        spawnProcess,
        nowMs: () => NOW_MS,
      })
    ).resolves.toEqual({
      scannedCount: 0,
      keptCount: 0,
      removedCount: 0,
      terminalRemovedCount: 0,
      staleRemovedCount: 0,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(buildSandboxDiscoveryArgs());
    expect(calls[0]?.options.shell).toBe(false);
  });

  it("deduplicates identical full IDs and never cleans twice", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stdout.write(inspectJson({ id: CID_A, status: "exited", ageMs: 1 }));
        child.close(0);
        return;
      }
      child.close(0);
    });
    const result = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    });
    expect(result).toEqual({
      scannedCount: 1,
      keptCount: 0,
      removedCount: 1,
      terminalRemovedCount: 1,
      staleRemovedCount: 0,
    });
    expect(calls.filter((call) => isInspectCall(call.args))).toHaveLength(1);
    expect(calls.filter((call) => call.args[0] === "rm")).toHaveLength(1);
    expect(calls.find((call) => call.args[0] === "rm")?.args).toEqual(
      buildSandboxCleanupArgs(CID_A)
    );
  });

  it("rejects short IDs without inspect or cleanup", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ child }) => {
      child.stdout.write("abc123\n");
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("INVALID_CONTAINER_ID");
    expect(calls.some((call) => isInspectCall(call.args))).toBe(false);
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("rejects uppercase IDs without inspect or cleanup", async () => {
    const upper = "A".repeat(64);
    const { spawnProcess, calls } = spawnHarness(async ({ child }) => {
      child.stdout.write(`${upper}\n`);
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("INVALID_CONTAINER_ID");
    expect(calls.some((call) => isInspectCall(call.args))).toBe(false);
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("rejects malformed discovery output without cleanup", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ child }) => {
      child.stdout.write("not-a-container-id!!!\n");
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("INVALID_CONTAINER_ID");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("fails closed on inspect identity mismatch without cleanup", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      child.stdout.write(
        inspectJson({
          id: CID_A,
          status: "exited",
          ageMs: 1,
          idOverride: CID_B,
        })
      );
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("IDENTITY_MISMATCH");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("fails closed when labels are missing", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      child.stdout.write(inspectJson({ id: CID_A, status: "exited", ageMs: 1, omitLabels: true }));
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("LABEL_MISMATCH");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("fails closed on managed label mismatch", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      child.stdout.write(
        inspectJson({
          id: CID_A,
          status: "exited",
          ageMs: 1,
          labels: {
            [SANDBOX_LABEL_KEYS.managed]: "false",
            [SANDBOX_LABEL_KEYS.component]: SANDBOX_LABEL_VALUES.component,
          },
        })
      );
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("LABEL_MISMATCH");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("fails closed on component label mismatch", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      child.stdout.write(
        inspectJson({
          id: CID_A,
          status: "exited",
          ageMs: 1,
          labels: {
            [SANDBOX_LABEL_KEYS.managed]: SANDBOX_LABEL_VALUES.managed,
            [SANDBOX_LABEL_KEYS.component]: "other",
          },
        })
      );
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("LABEL_MISMATCH");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("fails closed on invalid Created timestamps", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      child.stdout.write(
        inspectJson({
          id: CID_A,
          status: "exited",
          ageMs: 1,
          created: "not-a-date",
        })
      );
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("INVALID_CREATED_AT");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("fails closed on unknown State.Status", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      // A genuinely unrecognised status. "removing" is deliberately not used
      // here: it is Docker's normal auto-removal transit state and is skipped.
      child.stdout.write(inspectJson({ id: CID_A, status: "mystery-state", ageMs: 1 }));
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("UNKNOWN_CONTAINER_STATE");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("keeps a young running container", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      child.stdout.write(inspectJson({ id: CID_A, status: "running", ageMs: 1_000 }));
      child.close(0);
    });
    await expect(
      reconcileStaleTypstSandboxContainers({
        spawnProcess,
        nowMs: () => NOW_MS,
      })
    ).resolves.toEqual({
      scannedCount: 1,
      keptCount: 1,
      removedCount: 0,
      terminalRemovedCount: 0,
      staleRemovedCount: 0,
    });
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("removes a stale running container exactly once", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stdout.write(
          inspectJson({
            id: CID_A,
            status: "running",
            ageMs: SANDBOX_STALE_THRESHOLD_MS + 1,
          })
        );
        child.close(0);
        return;
      }
      expect(args).toEqual(buildSandboxCleanupArgs(CID_A));
      child.close(0);
    });
    await expect(
      reconcileStaleTypstSandboxContainers({
        spawnProcess,
        nowMs: () => NOW_MS,
      })
    ).resolves.toEqual({
      scannedCount: 1,
      keptCount: 0,
      removedCount: 1,
      terminalRemovedCount: 0,
      staleRemovedCount: 1,
    });
    expect(calls.filter((call) => call.args[0] === "rm")).toHaveLength(1);
  });

  // Both wordings Docker can produce for a container that no longer exists.
  // "No such container" is the daemon 404 relayed by `docker container
  // inspect`; "No such object" is what the CLI's generic object lookup emits.
  // Pinning both keeps the disappearance path from silently regressing into
  // INSPECT_FAILED if a CLI or daemon release changes the noun.
  it.each([
    ["daemon container wording", `Error response from daemon: No such container: ${CID_A}`],
    ["CLI generic object wording", `Error: No such object: ${CID_A}`],
  ])("treats inspect not-found (%s) as idempotent disappearance", async (_label, stderrText) => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stderr.write(stderrText);
        child.close(1);
        return;
      }
      child.close(0);
    });
    await expect(
      reconcileStaleTypstSandboxContainers({
        spawnProcess,
        nowMs: () => NOW_MS,
      })
    ).resolves.toEqual({
      scannedCount: 1,
      keptCount: 0,
      removedCount: 0,
      terminalRemovedCount: 0,
      staleRemovedCount: 0,
    });
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("scopes inspect to the container namespace during a real reconcile pass", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stdout.write(inspectJson({ id: CID_A, status: "running", ageMs: 1 }));
        child.close(0);
        return;
      }
      child.close(0);
    });
    await reconcileStaleTypstSandboxContainers({ spawnProcess, nowMs: () => NOW_MS });
    const inspectCalls = calls.filter((call) => isInspectCall(call.args));
    expect(inspectCalls).toHaveLength(1);
    // Exact argv: a generic ["inspect", id] would also resolve image, volume,
    // and network IDs, taking cleanup decisions outside the container namespace.
    expect(inspectCalls[0]?.args).toEqual(["container", "inspect", CID_A]);
    expect(calls.every((call) => call.args[0] !== "inspect")).toBe(true);
  });

  it("skips a container the daemon reports as removing, without cleanup", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stdout.write(inspectJson({ id: CID_A, status: "removing", ageMs: 1 }));
        child.close(0);
        return;
      }
      child.close(0);
    });
    await expect(
      reconcileStaleTypstSandboxContainers({
        spawnProcess,
        nowMs: () => NOW_MS,
      })
    ).resolves.toEqual({
      scannedCount: 1,
      keptCount: 0,
      removedCount: 0,
      terminalRemovedCount: 0,
      staleRemovedCount: 0,
    });
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("skips a removing container whose valid Created timestamp is in the future", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stdout.write(inspectJson({ id: CID_A, status: "removing", ageMs: -1 }));
        child.close(0);
        return;
      }
      child.close(0);
    });
    await expect(
      reconcileStaleTypstSandboxContainers({
        spawnProcess,
        nowMs: () => NOW_MS,
      })
    ).resolves.toEqual({
      scannedCount: 1,
      keptCount: 0,
      removedCount: 0,
      terminalRemovedCount: 0,
      staleRemovedCount: 0,
    });
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  // The missing-container matcher is substring-based, so it must stay narrow
  // enough that no other inspect failure is mistaken for absence. Each of these
  // exits non-zero exactly like a real miss and must still fail closed.
  it.each([
    ["daemon unavailable", "Error: Cannot connect to the Docker daemon", "INSPECT_FAILED"],
    ["permission denied", "Got permission denied while trying to connect", "INSPECT_FAILED"],
    ["generic failure", "Error: something went wrong", "INSPECT_FAILED"],
  ])(
    "does not treat %s as disappearance",
    async (_label, stderrText, expectedReason) => {
      const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
        if (args[0] === "ps") {
          child.stdout.write(`${CID_A}\n`);
          child.close(0);
          return;
        }
        child.stderr.write(stderrText);
        child.close(1);
      });
      const error = await reconcileStaleTypstSandboxContainers({
        spawnProcess,
        nowMs: () => NOW_MS,
      }).catch((value: unknown) => value);
      expect(expectSafeError(error).reason).toBe(expectedReason);
      expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
    }
  );

  it("does not treat malformed inspect output as disappearance", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        // Exit 0 with unparseable stdout: never absence, never authorization.
        child.stdout.write("{ not json");
        child.close(0);
        return;
      }
      child.close(0);
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("INSPECT_FAILED");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("treats already-removed cleanup as idempotent success", async () => {
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stdout.write(inspectJson({ id: CID_A, status: "dead", ageMs: 1 }));
        child.close(0);
        return;
      }
      child.stderr.write("Error: No such container: abc");
      child.close(1);
    });
    await expect(
      reconcileStaleTypstSandboxContainers({
        spawnProcess,
        nowMs: () => NOW_MS,
      })
    ).resolves.toMatchObject({
      removedCount: 1,
      terminalRemovedCount: 1,
    });
  });

  it("fails safely on discovery timeout", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ child }) => {
      child.onKill = (signal) => {
        if (signal === "SIGTERM") child.close(null, "SIGTERM");
        return true;
      };
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
      commandLimits: fastCommandLimits(),
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("DISCOVERY_FAILED");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("fails safely on inspect timeout without cleanup", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      child.onKill = (signal) => {
        if (signal === "SIGTERM") child.close(null, "SIGTERM");
        return true;
      };
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
      commandLimits: fastCommandLimits(),
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("INSPECT_FAILED");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("fails safely on cleanup timeout", async () => {
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stdout.write(inspectJson({ id: CID_A, status: "exited", ageMs: 1 }));
        child.close(0);
        return;
      }
      child.onKill = (signal) => {
        if (signal === "SIGKILL") child.close(null, "SIGKILL");
        return true;
      };
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
      commandLimits: fastCommandLimits(),
      cleanupLimits: fastCleanupLimits(),
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("CLEANUP_FAILED");
  });

  it("fails safely on discovery spawn error", async () => {
    const { spawnProcess } = spawnHarness(async ({ child }) => {
      child.emit("error", new Error("spawn docker ENOENT"));
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("DISCOVERY_FAILED");
  });

  it("fails safely on inspect spawn error", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      child.emit("error", new Error("inspect failed"));
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("INSPECT_FAILED");
    expect(calls.some((call) => call.args[0] === "rm")).toBe(false);
  });

  it("fails safely on cleanup spawn error", async () => {
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stdout.write(inspectJson({ id: CID_A, status: "exited", ageMs: 1 }));
        child.close(0);
        return;
      }
      child.emit("error", new Error("rm failed"));
    });
    const error = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    }).catch((value: unknown) => value);
    expect(expectSafeError(error).reason).toBe("CLEANUP_FAILED");
  });

  it("never returns container IDs in a successful result", async () => {
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n${CID_B}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        const id = inspectedId(args);
        child.stdout.write(
          inspectJson({
            id,
            status: id === CID_A ? "running" : "exited",
            ageMs: id === CID_A ? 1_000 : 1,
          })
        );
        child.close(0);
        return;
      }
      child.close(0);
    });
    const result = await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    });
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{64}/i);
    expect(result.scannedCount).toBe(2);
    expect(result.keptCount).toBe(1);
    expect(result.removedCount).toBe(1);
  });

  it("never constructs a shell or broad cleanup command", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (isInspectCall(args)) {
        child.stdout.write(inspectJson({ id: CID_A, status: "exited", ageMs: 1 }));
        child.close(0);
        return;
      }
      child.close(0);
    });
    await reconcileStaleTypstSandboxContainers({
      spawnProcess,
      nowMs: () => NOW_MS,
    });
    for (const call of calls) {
      expect(call.options.shell).toBe(false);
      expect(call.args.join(" ")).not.toMatch(/prune|system|container ls|\*/);
      expect(call.args).not.toContain("-f");
      if (call.args[0] === "rm") {
        expect(call.args).toEqual(["rm", "--force", CID_A]);
      }
    }
  });

  it("uses inspect argument builder for validated IDs only", () => {
    expect(buildSandboxInspectArgs(CID_A)).toEqual(["container", "inspect", CID_A]);
  });
});
