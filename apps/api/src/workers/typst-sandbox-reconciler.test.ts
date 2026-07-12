import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { SANDBOX_LABELS, type ManagedChildProcess, type SpawnProcess } from "./typst-sandbox";
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

  it("fails closed for unknown or removing states", () => {
    expect(
      classifySandboxContainer({
        status: "removing",
        createdAtMs: NOW_MS - 1,
        nowMs: NOW_MS,
        staleThresholdMs: SANDBOX_STALE_THRESHOLD_MS,
      })
    ).toBe("UNKNOWN_CONTAINER_STATE");
  });

  it("fails closed for future Created timestamps", () => {
    expect(
      classifySandboxContainer({
        status: "running",
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
      if (args[0] === "inspect") {
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
    expect(calls.filter((call) => call.args[0] === "inspect")).toHaveLength(1);
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
    expect(calls.some((call) => call.args[0] === "inspect")).toBe(false);
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
    expect(calls.some((call) => call.args[0] === "inspect")).toBe(false);
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
      child.stdout.write(inspectJson({ id: CID_A, status: "removing", ageMs: 1 }));
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
      if (args[0] === "inspect") {
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

  it("treats inspect not-found as idempotent disappearance without cleanup", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      if (args[0] === "inspect") {
        child.stderr.write("Error: No such container: missing");
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

  it("does not treat non-not-found inspect failures as disappearance", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "ps") {
        child.stdout.write(`${CID_A}\n`);
        child.close(0);
        return;
      }
      child.stderr.write("Error: Cannot connect to the Docker daemon");
      child.close(1);
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
      if (args[0] === "inspect") {
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
      if (args[0] === "inspect") {
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
      if (args[0] === "inspect") {
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
      if (args[0] === "inspect") {
        const id = args[1] ?? "";
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
      if (args[0] === "inspect") {
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
    expect(buildSandboxInspectArgs(CID_A)).toEqual(["inspect", CID_A]);
  });
});
