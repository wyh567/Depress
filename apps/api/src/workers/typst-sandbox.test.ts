import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  chmod,
  chown,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderGbt7714TypstProject, renderIeeeTypstProject } from "@depress/transformers";
import {
  DEFAULT_TYPST_IMAGE,
  SANDBOX_BIBLIOGRAPHY_FILE,
  SANDBOX_CID_FILE,
  SANDBOX_INPUT_FILE,
  SANDBOX_LABELS,
  SANDBOX_LIMITS,
  SANDBOX_OUTPUT_FILE,
  TYPST_FONT_DIRECTORY,
  SandboxCompileError,
  buildTypstDockerArgs,
  createTypstSandboxRunner as createProductionTypstSandboxRunner,
  isDockerContainerId,
  type ManagedChildProcess,
  type SpawnProcess,
} from "./typst-sandbox";

const CID = "a".repeat(64);
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const TEST_RUNTIME_IDENTITY = { uid: 124, gid: 125 } as const;
const TEST_BUNDLED_FONT_GID = 126;

type SandboxRunnerOptions = NonNullable<Parameters<typeof createProductionTypstSandboxRunner>[0]>;

function createTypstSandboxRunner(options: SandboxRunnerOptions = {}) {
  return createProductionTypstSandboxRunner({
    resolveRuntimeIdentity: () => TEST_RUNTIME_IDENTITY,
    resolveFontMountGroupIds: async () => [TEST_BUNDLED_FONT_GID],
    ...options,
  });
}

function argValue(args: readonly string[], name: string): string {
  return args[args.indexOf(name) + 1] ?? "";
}

function argValues(args: readonly string[], name: string): string[] {
  return args.filter((_value, index) => args[index - 1] === name);
}

function workDirFromArgs(args: readonly string[]): string {
  const mount = argValue(args, "-v");
  return mount.slice(0, mount.lastIndexOf(":/work"));
}

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

async function writeDockerOutputs(
  args: readonly string[],
  options: { cid?: string; pdf?: string } = {}
): Promise<void> {
  await writeFile(argValue(args, "--cidfile"), options.cid ?? CID, "utf8");
  await writeFile(join(workDirFromArgs(args), SANDBOX_OUTPUT_FILE), options.pdf ?? "%PDF-fake");
}

function fastTimings() {
  return {
    executionTimeoutMs: 10,
    termGraceMs: 10,
    killGraceMs: 10,
    cleanupTimeoutMs: 10,
    cleanupTermGraceMs: 10,
    cleanupKillGraceMs: 10,
    cidReadAttempts: 3,
    cidReadDelayMs: 5,
  };
}

describe("buildTypstDockerArgs", () => {
  const args = buildTypstDockerArgs({
    workDir: "/tmp/job-1",
    runId: RUN_ID,
    cidFile: "/tmp/job-1/container.cid",
    runtimeIdentity: TEST_RUNTIME_IDENTITY,
    supplementaryGroupIds: [TEST_BUNDLED_FONT_GID],
  });

  it("preserves all sandbox hardening and resource limits", () => {
    expect(argValue(args, "--network")).toBe("none");
    expect(args).toContain("--read-only");
    expect(args).toContain("--rm");
    expect(argValue(args, "--cap-drop")).toBe("ALL");
    expect(argValue(args, "--security-opt")).toBe("no-new-privileges");
    expect(argValue(args, "--memory")).toBe("512m");
    expect(argValue(args, "--cpus")).toBe("1");
    expect(argValue(args, "--pids-limit")).toBe("64");
  });

  it("uses fixed labels, the code-owned CID path, and the immutable image", () => {
    const labels = args
      .map((value, index) => (args[index - 1] === "--label" ? value : null))
      .filter((value): value is string => value !== null);
    expect(labels).toEqual([
      SANDBOX_LABELS.managed,
      SANDBOX_LABELS.component,
      `${SANDBOX_LABELS.runId}=${RUN_ID}`,
    ]);
    expect(argValue(args, "--cidfile")).toBe("/tmp/job-1/container.cid");
    expect(args).toContain(DEFAULT_TYPST_IMAGE);
  });

  it("always mounts the bundled font and ignores system fonts", () => {
    expect(argValue(args, "-v")).toBe("/tmp/job-1:/work");
    expect(args[args.lastIndexOf("-v") + 1]).toBe(`${TYPST_FONT_DIRECTORY}:/fonts/bundled:ro`);
    expect(argValue(args, "--entrypoint")).toBe("typst");
    expect(args.slice(-6)).toEqual([
      "compile",
      "--ignore-system-fonts",
      "--font-path",
      "/fonts/bundled",
      SANDBOX_INPUT_FILE,
      SANDBOX_OUTPUT_FILE,
    ]);
  });

  it("adds an operator font directory without replacing the bundled fallback", () => {
    const configuredArgs = buildTypstDockerArgs({
      workDir: "/tmp/job-1",
      runId: RUN_ID,
      cidFile: "/tmp/job-1/container.cid",
      runtimeIdentity: TEST_RUNTIME_IDENTITY,
      fontDirectory: "/srv/depress-fonts",
    });
    const mounts = configuredArgs
      .map((value, index) => (configuredArgs[index - 1] === "-v" ? value : null))
      .filter((value): value is string => value !== null);
    expect(mounts).toEqual([
      "/tmp/job-1:/work",
      `${TYPST_FONT_DIRECTORY}:/fonts/bundled:ro`,
      "/srv/depress-fonts:/fonts/configured:ro",
    ]);
    expect(configuredArgs.slice(-8)).toEqual([
      "compile",
      "--ignore-system-fonts",
      "--font-path",
      "/fonts/bundled",
      "--font-path",
      "/fonts/configured",
      SANDBOX_INPUT_FILE,
      SANDBOX_OUTPUT_FILE,
    ]);
  });

  it("maps the Worker identity before mounts and the immutable image", () => {
    expect(argValue(args, "--user")).toBe("124:125");
    expect(argValues(args, "--group-add")).toEqual(["126"]);
    expect(args.indexOf("--user")).toBeLessThan(args.indexOf("-v"));
    expect(args.indexOf("--group-add")).toBeLessThan(args.indexOf("-v"));
    expect(args.indexOf("--user")).toBeLessThan(args.indexOf(DEFAULT_TYPST_IMAGE));
  });

  it("deduplicates explicit font mount groups and retains a primary-GID match", () => {
    const groupedArgs = buildTypstDockerArgs({
      workDir: "/tmp/job-1",
      runId: RUN_ID,
      cidFile: "/tmp/job-1/container.cid",
      runtimeIdentity: TEST_RUNTIME_IDENTITY,
      supplementaryGroupIds: [125, 994, 125, 994],
    });
    expect(argValues(groupedArgs, "--group-add")).toEqual(["125", "994"]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid supplementary font group: %s",
    (groupId) => {
      expect(() =>
        buildTypstDockerArgs({
          workDir: "/tmp/job-1",
          runId: RUN_ID,
          cidFile: "/tmp/job-1/container.cid",
          runtimeIdentity: TEST_RUNTIME_IDENTITY,
          supplementaryGroupIds: [groupId],
        })
      ).toThrow("Sandbox font group resolution failed");
    }
  );

  it("omits the user mapping for Windows-compatible no-identity behavior", () => {
    const windowsArgs = buildTypstDockerArgs({
      workDir: "/tmp/job-1",
      runId: RUN_ID,
      cidFile: "/tmp/job-1/container.cid",
    });
    expect(windowsArgs).not.toContain("--user");
  });
});

describe("Docker container identity", () => {
  it.each([
    ["UID 0", { uid: 0, gid: 125 }],
    ["GID 0", { uid: 124, gid: 0 }],
    ["negative UID", { uid: -1, gid: 125 }],
    ["negative GID", { uid: 124, gid: -1 }],
    ["fractional UID", { uid: 124.5, gid: 125 }],
    ["NaN GID", { uid: 124, gid: Number.NaN }],
    ["unsafe UID", { uid: Number.MAX_SAFE_INTEGER + 1, gid: 125 }],
    ["non-numeric GID", { uid: 124, gid: "125" as unknown as number }],
  ])("rejects an invalid runtime identity before run setup: %s", async (_name, identity) => {
    let runIdCalls = 0;
    let runDirectoryCalls = 0;
    const { spawnProcess, calls } = spawnHarness(() => undefined);
    await expect(
      createTypstSandboxRunner({
        spawnProcess,
        resolveRuntimeIdentity: () => identity,
        createRunId: () => {
          runIdCalls += 1;
          return RUN_ID;
        },
        createRunDirectory: async () => {
          runDirectoryCalls += 1;
          return join(tmpdir(), "must-not-be-created");
        },
      }).compile({ main: "identity must not affect this content" })
    ).rejects.toThrow("Sandbox runtime identity resolution failed");
    expect(runIdCalls).toBe(0);
    expect(runDirectoryCalls).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("accepts only a full lowercase 64-hex Docker container ID", () => {
    expect(isDockerContainerId(CID)).toBe(true);
    expect(isDockerContainerId("A".repeat(64))).toBe(false);
    expect(isDockerContainerId("a".repeat(63))).toBe(false);
    expect(isDockerContainerId("")).toBe(false);
    expect(isDockerContainerId("../container")).toBe(false);
  });

  it("creates a unique internal run ID for every invocation", async () => {
    const runLabels: string[] = [];
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      runLabels.push(args.find((arg) => arg.startsWith(`${SANDBOX_LABELS.runId}=`)) ?? "");
      await writeDockerOutputs(args);
      child.close(0);
    });
    const sandbox = createTypstSandboxRunner({ spawnProcess });
    await sandbox.compile({ main: "one" });
    await sandbox.compile({ main: "two" });
    expect(runLabels).toHaveLength(2);
    expect(runLabels[0]).not.toBe(runLabels[1]);
  });

  it("does not copy document content into labels", async () => {
    const secretText = "document-secret-never-a-label";
    let labels: string[] = [];
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      labels = args.filter((_arg, index) => args[index - 1] === "--label");
      await writeDockerOutputs(args);
      child.close(0);
    });
    await createTypstSandboxRunner({ spawnProcess }).compile({
      main: secretText,
    });
    expect(labels.join(" ")).not.toContain(secretText);
  });

  it("does not let document content influence the Docker user mapping", async () => {
    const documentIdentity = "999:999";
    let dockerIdentity = "";
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      dockerIdentity = argValue(args, "--user");
      await writeDockerOutputs(args);
      child.close(0);
    });
    await createTypstSandboxRunner({ spawnProcess }).compile({
      main: documentIdentity,
    });
    expect(dockerIdentity).toBe("124:125");
    expect(dockerIdentity).not.toBe(documentIdentity);
  });

  it("derives only bundled and configured mount groups and deduplicates them", async () => {
    const configuredFontDirectory = "/srv/operator-approved-fonts";
    const resolveFontMountGroupIds = vi.fn(async () => [994, 995, 994]);
    let argsSeen: readonly string[] = [];
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      argsSeen = args;
      await writeDockerOutputs(args);
      child.close(0);
    });
    await createTypstSandboxRunner({
      spawnProcess,
      fontDirectory: configuredFontDirectory,
      resolveFontMountGroupIds,
    }).compile({ main: "--group-add 777 /untrusted/host/fonts" });

    expect(resolveFontMountGroupIds).toHaveBeenCalledWith([
      TYPST_FONT_DIRECTORY,
      configuredFontDirectory,
    ]);
    expect(argValues(argsSeen, "--group-add")).toEqual(["994", "995"]);
    expect(argsSeen).not.toContain("777");
    expect(argsSeen.join(" ")).not.toContain("/untrusted/host/fonts");
  });

  it("does not propagate unrelated host supplementary groups", async () => {
    const dockerGroupGid = 999;
    const getgroups = vi.fn(() => [125, 994, dockerGroupGid]);
    const originalGetgroups = process.getgroups;
    Object.defineProperty(process, "getgroups", { configurable: true, value: getgroups });
    try {
      let argsSeen: readonly string[] = [];
      const { spawnProcess } = spawnHarness(async ({ args, child }) => {
        argsSeen = args;
        await writeDockerOutputs(args);
        child.close(0);
      });
      await createTypstSandboxRunner({
        spawnProcess,
        resolveFontMountGroupIds: async () => [994],
      }).compile({ main: "x" });
      expect(getgroups).not.toHaveBeenCalled();
      expect(argValues(argsSeen, "--group-add")).toEqual(["994"]);
      expect(argsSeen).not.toContain(String(dockerGroupGid));
    } finally {
      Object.defineProperty(process, "getgroups", {
        configurable: true,
        value: originalGetgroups,
      });
    }
  });

  it("fails closed before run setup when font mount metadata cannot be resolved", async () => {
    let runIdCalls = 0;
    let runDirectoryCalls = 0;
    const { spawnProcess, calls } = spawnHarness(() => undefined);
    await expect(
      createTypstSandboxRunner({
        spawnProcess,
        resolveFontMountGroupIds: async () => {
          throw new Error("sensitive filesystem detail");
        },
        createRunId: () => {
          runIdCalls += 1;
          return RUN_ID;
        },
        createRunDirectory: async () => {
          runDirectoryCalls += 1;
          return join(tmpdir(), "must-not-be-created");
        },
      }).compile({ main: "x" })
    ).rejects.toThrow("Sandbox font group resolution failed");
    expect(runIdCalls).toBe(0);
    expect(runDirectoryCalls).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("omits --user when the internal resolver reports Windows-compatible no identity", async () => {
    let argsSeen: readonly string[] = [];
    const resolveFontMountGroupIds = vi.fn(async () => [994]);
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      argsSeen = args;
      await writeDockerOutputs(args);
      child.close(0);
    });
    await createTypstSandboxRunner({
      spawnProcess,
      resolveRuntimeIdentity: () => undefined,
      resolveFontMountGroupIds,
    }).compile({ main: "x" });
    expect(argsSeen).not.toContain("--user");
    expect(argsSeen).not.toContain("--group-add");
    expect(resolveFontMountGroupIds).not.toHaveBeenCalled();
  });

  it("keeps the host CID file inside the unique run directory but outside the writable mount", async () => {
    let workDir = "";
    let cidFile = "";
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      workDir = workDirFromArgs(args);
      cidFile = argValue(args, "--cidfile");
      expect(dirname(cidFile)).toBe(dirname(workDir));
      expect(dirname(cidFile)).not.toBe(workDir);
      expect(cidFile).toBe(join(dirname(workDir), SANDBOX_CID_FILE));
      await writeDockerOutputs(args);
      child.close(0);
    });
    await createTypstSandboxRunner({ spawnProcess }).compile({ main: "x" });
    expect(existsSync(workDir)).toBe(false);
  });

  it("does not create a temp directory when internal run-ID generation fails", async () => {
    const before = new Set(
      (await readdir(tmpdir())).filter((name) => name.startsWith("depress-typst-"))
    );
    await expect(
      createTypstSandboxRunner({
        createRunId: () => {
          throw new Error("entropy unavailable");
        },
      }).compile({ main: "x" })
    ).rejects.toThrow("entropy unavailable");
    const after = new Set(
      (await readdir(tmpdir())).filter((name) => name.startsWith("depress-typst-"))
    );
    expect(after).toEqual(before);
  });

  it.each(["", "not-a-container-id", "A".repeat(64)])(
    "rejects an empty or malformed CID safely: %j",
    async (cid) => {
      let workDir = "";
      const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
        workDir = workDirFromArgs(args);
        await writeDockerOutputs(args, { cid });
        child.close(0);
      });
      const error = await createTypstSandboxRunner({ spawnProcess })
        .compile({ main: "x" })
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(SandboxCompileError);
      expect((error as SandboxCompileError).details).toMatchObject({
        reason: "container-identity",
        cleanup: "identity-unavailable",
      });
      expect(calls).toHaveLength(1);
      expect(existsSync(workDir)).toBe(false);
    }
  );

  it("never parses Docker stdout as the container identity", async () => {
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      child.stdout.write(`${CID}\n`);
      await writeFile(join(workDirFromArgs(args), SANDBOX_OUTPUT_FILE), "%PDF");
      child.close(0);
    });
    await expect(
      createTypstSandboxRunner({ spawnProcess }).compile({ main: "x" })
    ).rejects.toMatchObject({ details: { reason: "container-identity" } });
  });
});

describe("createTypstSandboxRunner lifecycle", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("returns the PDF, uses no shell, skips force cleanup, and removes temp files", async () => {
    let workDir = "";
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      workDir = workDirFromArgs(args);
      expect(existsSync(join(workDir, SANDBOX_INPUT_FILE))).toBe(true);
      expect(await readFile(join(workDir, SANDBOX_INPUT_FILE), "utf8")).toBe("#lorem(5)");
      await writeDockerOutputs(args, { pdf: "%PDF-success" });
      child.close(0);
    });
    const pdf = await createTypstSandboxRunner({ spawnProcess }).compile({
      main: "#lorem(5)",
    });
    expect(pdf.toString()).toBe("%PDF-success");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("docker");
    expect(calls[0]?.options.shell).toBe(false);
    expect(existsSync(workDir)).toBe(false);
  });

  it("writes only fixed project filenames before Docker creates the CID file", async () => {
    let files: string[] = [];
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      const workDir = workDirFromArgs(args);
      files = (await readdir(workDir)).sort();
      await writeDockerOutputs(args);
      child.close(0);
    });
    await createTypstSandboxRunner({ spawnProcess }).compile({
      main: "Body",
      bibliography: '"safe":\n  type: Misc\n  title: "Safe"\n',
      ...({ "../escape.typ": "evil" } as Record<string, string>),
    });
    expect(files).toEqual([SANDBOX_INPUT_FILE, SANDBOX_BIBLIOGRAPHY_FILE].sort());
  });

  it("uses exact CID cleanup for a normal compiler failure and preserves a safe error", async () => {
    let workDir = "";
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "run") {
        workDir = workDirFromArgs(args);
        await writeFile(argValue(args, "--cidfile"), CID);
        child.stderr.write("raw host path and document content");
        child.close(1);
      } else {
        expect(args).toEqual(["rm", "--force", CID]);
        expect(existsSync(workDir)).toBe(true);
        child.close(0);
      }
    });
    const error = await createTypstSandboxRunner({ spawnProcess })
      .compile({ main: "x" })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SandboxCompileError);
    expect((error as Error).message).not.toContain("host path");
    expect((error as SandboxCompileError).details.cleanup).toBe("succeeded");
    expect(calls).toHaveLength(2);
    expect(existsSync(workDir)).toBe(false);
  });

  it("sends SIGTERM on timeout, skips SIGKILL when the CLI exits, then cleans the exact CID", async () => {
    vi.useFakeTimers();
    let runChild: FakeChild | undefined;
    let confirmRunSpawned: () => void = () => undefined;
    const runSpawned = new Promise<void>((resolve) => {
      confirmRunSpawned = resolve;
    });
    const calls: SpawnCall[] = [];
    const spawnProcess: SpawnProcess = (command, args, options) => {
      const child = new FakeChild();
      calls.push({ command, args, options, child });
      if (args[0] === "run") {
        runChild = child;
        writeFileSync(argValue(args, "--cidfile"), CID, "utf8");
        child.onKill = (signal) => {
          if (signal === "SIGTERM") child.close(null, "SIGTERM");
        };
        confirmRunSpawned();
      } else {
        queueMicrotask(() => child.close(0));
      }
      return child;
    };
    const compile = createTypstSandboxRunner({
      spawnProcess,
      timings: fastTimings(),
    })
      .compile({ main: "slow" })
      .catch((value: unknown) => value);
    await runSpawned;
    await vi.advanceTimersByTimeAsync(fastTimings().executionTimeoutMs);
    const error = await compile;
    expect(runChild?.signals).toEqual(["SIGTERM"]);
    expect((error as SandboxCompileError).details).toMatchObject({
      reason: "docker-timeout",
      cleanup: "succeeded",
      dockerCliClosed: true,
      sigtermAttempted: true,
      sigtermAccepted: true,
      sigkillAttempted: false,
      sigkillAccepted: false,
    });
    expect(calls[1]?.args).toEqual(["rm", "--force", CID]);
  });

  it("escalates once to SIGKILL when the Docker CLI ignores SIGTERM", async () => {
    vi.useFakeTimers();
    let runChild: FakeChild | undefined;
    let confirmRunSpawned: () => void = () => undefined;
    const runSpawned = new Promise<void>((resolve) => {
      confirmRunSpawned = resolve;
    });
    const spawnProcess: SpawnProcess = (_command, args) => {
      const child = new FakeChild();
      if (args[0] === "run") {
        runChild = child;
        writeFileSync(argValue(args, "--cidfile"), CID, "utf8");
        child.onKill = (signal) => {
          if (signal === "SIGKILL") child.close(null, "SIGKILL");
        };
        confirmRunSpawned();
      } else {
        queueMicrotask(() => child.close(0));
      }
      return child;
    };
    const compile = createTypstSandboxRunner({
      spawnProcess,
      timings: fastTimings(),
    })
      .compile({ main: "slow" })
      .catch((value: unknown) => value);
    await runSpawned;
    await vi.advanceTimersByTimeAsync(fastTimings().executionTimeoutMs);
    expect(runChild?.signals).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(fastTimings().termGraceMs);
    const error = await compile;
    expect(runChild?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect((error as SandboxCompileError).details).toMatchObject({
      dockerCliClosed: true,
      sigkillAttempted: true,
      sigkillAccepted: true,
    });
  });

  it.each(["false", "throw"] as const)(
    "distinguishes a %s kill request from an accepted signal or confirmed close",
    async (behavior) => {
      const { spawnProcess } = spawnHarness(async ({ args, child }) => {
        if (args[0] === "run") {
          await writeFile(argValue(args, "--cidfile"), CID);
          child.onKill = () => {
            if (behavior === "throw") throw new Error("cannot signal child");
            return false;
          };
        } else {
          child.close(0);
        }
      });
      const error = await createTypstSandboxRunner({
        spawnProcess,
        timings: fastTimings(),
      })
        .compile({ main: "slow" })
        .catch((value: unknown) => value);
      expect((error as SandboxCompileError).details).toMatchObject({
        reason: "docker-timeout",
        dockerCliClosed: false,
        sigtermAttempted: true,
        sigtermAccepted: false,
        sigkillAttempted: true,
        sigkillAccepted: false,
      });
    }
  );

  it("retries CID capture briefly when timeout settles before the Docker CLI closes", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "run") {
        child.onKill = (signal) => {
          if (signal === "SIGKILL") {
            setTimeout(() => {
              void writeFile(argValue(args, "--cidfile"), CID);
            }, 7);
          }
        };
      } else {
        child.close(0);
      }
    });
    const error = await createTypstSandboxRunner({
      spawnProcess,
      timings: fastTimings(),
    })
      .compile({ main: "late CID" })
      .catch((value: unknown) => value);
    expect((error as SandboxCompileError).details).toMatchObject({
      reason: "docker-timeout",
      cleanup: "succeeded",
      dockerCliClosed: false,
    });
    expect(calls[1]?.args).toEqual(["rm", "--force", CID]);
  });

  it("treats an already removed exact container as idempotent cleanup success", async () => {
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "run") {
        await writeFile(argValue(args, "--cidfile"), CID);
        child.close(2);
      } else {
        child.stderr.write(`Error response from daemon: No such container: ${CID}`);
        child.close(1);
      }
    });
    await expect(
      createTypstSandboxRunner({ spawnProcess }).compile({ main: "x" })
    ).rejects.toMatchObject({ details: { cleanup: "succeeded" } });
  });

  it("preserves the primary safe error, records cleanup failure, and still removes temp files", async () => {
    let workDir = "";
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "run") {
        workDir = workDirFromArgs(args);
        await writeFile(argValue(args, "--cidfile"), CID);
        child.close(1);
      } else {
        expect(existsSync(workDir)).toBe(true);
        child.stderr.write("daemon cleanup failure with internal details");
        child.close(2);
      }
    });
    const error = await createTypstSandboxRunner({ spawnProcess })
      .compile({ main: "x" })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SandboxCompileError);
    expect((error as SandboxCompileError).details).toMatchObject({
      reason: "docker-exit",
      cleanup: "failed",
    });
    expect((error as Error).message).not.toContain("internal details");
    expect(existsSync(workDir)).toBe(false);
  });

  it("bounds the cleanup command and settles even when both CLI processes ignore signals", async () => {
    const children: FakeChild[] = [];
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      children.push(child);
      if (args[0] === "run") {
        await writeFile(argValue(args, "--cidfile"), CID);
      }
    });
    const started = Date.now();
    const error = await createTypstSandboxRunner({
      spawnProcess,
      timings: fastTimings(),
    })
      .compile({ main: "never exits" })
      .catch((value: unknown) => value);
    expect(Date.now() - started).toBeLessThan(500);
    expect(children).toHaveLength(2);
    expect(children[0]?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(children[1]?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect((error as SandboxCompileError).details.cleanup).toBe("failed");
  });

  it("bounds stdout and stderr capture while continuing to drain both streams", async () => {
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "run") {
        await writeFile(argValue(args, "--cidfile"), CID);
        child.stdout.write(Buffer.alloc(SANDBOX_LIMITS.maxOutputBytes + 10, 65));
        child.stderr.write(Buffer.alloc(SANDBOX_LIMITS.maxOutputBytes + 10, 66));
        child.close(1);
      } else {
        child.close(0);
      }
    });
    const error = await createTypstSandboxRunner({ spawnProcess })
      .compile({ main: "x" })
      .catch((value: unknown) => value);
    expect((error as SandboxCompileError).details.stdout).toEqual({
      capturedBytes: SANDBOX_LIMITS.maxOutputBytes,
      truncated: true,
      streamError: false,
    });
    expect((error as SandboxCompileError).details.stderr).toEqual({
      capturedBytes: SANDBOX_LIMITS.maxOutputBytes,
      truncated: true,
      streamError: false,
    });
  });

  it("handles stdout/stderr stream errors without leaving the command unresolved", async () => {
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "run") {
        await writeFile(argValue(args, "--cidfile"), CID);
        child.stdout.emit("error", new Error("stdout broke"));
        child.stderr.emit("error", new Error("stderr broke"));
        child.close(1);
      } else {
        child.close(0);
      }
    });
    const error = await createTypstSandboxRunner({ spawnProcess })
      .compile({ main: "x" })
      .catch((value: unknown) => value);
    expect((error as SandboxCompileError).details.stdout.streamError).toBe(true);
    expect((error as SandboxCompileError).details.stderr.streamError).toBe(true);
  });

  it("settles once when child error is followed by close and performs one exact cleanup", async () => {
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "run") {
        await writeFile(argValue(args, "--cidfile"), CID);
        child.emit("error", new Error("spawn lifecycle error"));
        child.close(1);
      } else {
        child.close(0);
      }
    });
    await expect(
      createTypstSandboxRunner({ spawnProcess }).compile({ main: "x" })
    ).rejects.toMatchObject({
      details: { reason: "docker-spawn", cleanup: "succeeded" },
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).toEqual(["rm", "--force", CID]);
  });
});

// Optional real-Docker smoke test — opt in with DEPRESS_DOCKER_SMOKE=1.
// Requires the already-approved pinned image. Default tests never run Docker.
const skipDockerSmoke =
  process.env["DEPRESS_DOCKER_SMOKE"] !== "1" ||
  process.platform !== "linux" ||
  typeof process.getuid !== "function" ||
  process.getuid() !== 0;

describe.skipIf(skipDockerSmoke)("typst sandbox (docker smoke)", () => {
  it("uses only the font mount group to read and embed a production-shaped CJK font", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "depress-font-permissions-"));
    const fontDirectory = join(fixtureRoot, "fonts");
    const workDirectory = join(fixtureRoot, "work");
    const fontFile = join(fontDirectory, "NotoSansCJKsc-Regular.otf");
    const sourceFile = join(workDirectory, SANDBOX_INPUT_FILE);
    const outputFile = join(workDirectory, SANDBOX_OUTPUT_FILE);
    const runtimeId = 65_534;
    const fontGroupId = 54_321;
    const chineseText = [
      "\u4e2d\u6587\u5b57\u4f53\u6d4b\u8bd5",
      "\u8fd9\u662f\u4e2d\u6587\u6458\u8981",
      "\u4f60\u597d\uff0c\u4e16\u754c",
    ];

    try {
      await mkdir(fontDirectory);
      await mkdir(workDirectory);
      await copyFile(join(TYPST_FONT_DIRECTORY, "NotoSansCJKsc-Regular.otf"), fontFile);
      await writeFile(
        sourceFile,
        `#set text(font: "Noto Sans CJK SC")\n${chineseText.join("\n")}`,
        "utf8"
      );
      await chown(fontDirectory, 0, fontGroupId);
      await chown(fontFile, 0, fontGroupId);
      await chmod(fontDirectory, 0o750);
      await chmod(fontFile, 0o640);
      await chown(workDirectory, runtimeId, runtimeId);
      await chown(sourceFile, runtimeId, runtimeId);

      const dockerPrefix = [
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        `${runtimeId}:${runtimeId}`,
      ];
      const mountsAndImage = [
        "-v",
        `${fontDirectory}:/fonts/bundled:ro`,
        "-v",
        `${workDirectory}:/work`,
        "-w",
        "/work",
        "--entrypoint",
        "typst",
        DEFAULT_TYPST_IMAGE,
      ];
      const fontListCommand = [
        "fonts",
        "--ignore-system-fonts",
        "--font-path",
        "/fonts/bundled",
      ];
      const withoutGroup = spawnSync(
        "docker",
        [...dockerPrefix, ...mountsAndImage, ...fontListCommand],
        { encoding: "utf8", shell: false }
      );
      expect(withoutGroup.stdout).not.toContain("Noto Sans CJK SC");

      const withGroupPrefix = [...dockerPrefix, "--group-add", String(fontGroupId)];
      const withGroup = spawnSync(
        "docker",
        [...withGroupPrefix, ...mountsAndImage, ...fontListCommand],
        { encoding: "utf8", shell: false }
      );
      expect(withGroup.status).toBe(0);
      expect(withGroup.stdout).toContain("Noto Sans CJK SC");

      const compile = spawnSync(
        "docker",
        [
          ...withGroupPrefix,
          ...mountsAndImage,
          "compile",
          "--ignore-system-fonts",
          "--font-path",
          "/fonts/bundled",
          SANDBOX_INPUT_FILE,
          SANDBOX_OUTPUT_FILE,
        ],
        { encoding: "utf8", shell: false }
      );
      expect(compile.status, compile.stderr).toBe(0);
      const pdf = await readFile(outputFile);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

      const pdfFonts = spawnSync("pdffonts", [outputFile], { encoding: "utf8", shell: false });
      if (!pdfFonts.error) {
        expect(pdfFonts.status).toBe(0);
        expect(pdfFonts.stdout).toMatch(/NotoSansCJKsc/i);
      } else {
        expect((pdfFonts.error as NodeJS.ErrnoException).code).toBe("ENOENT");
        expect(pdf.toString("latin1")).toContain("NotoSansCJKsc-Regular");
      }

      const pdfText = spawnSync("pdftotext", [outputFile, "-"], {
        encoding: "utf8",
        shell: false,
      });
      if (!pdfText.error) {
        expect(pdfText.status).toBe(0);
        for (const text of chineseText) expect(pdfText.stdout).toContain(text);
      } else {
        expect((pdfText.error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("compiles a trivial document to a real PDF", async () => {
    const sandbox = createProductionTypstSandboxRunner();
    const pdf = await sandbox.compile({ main: "Hello from DePress." });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 120_000);

  it("compiles every CSL type and canonical citeKey through references.yml", async () => {
    const keys = [
      "smith2024",
      "Smith2024",
      "zhang-2025",
      "paper_01",
      "中文文献",
      "key.with.dots",
      "key/with/slash",
      'key"quote',
    ];
    const types = [
      "article-journal",
      "book",
      "paper-conference",
      "chapter",
      "thesis",
      "webpage",
      "document",
      "document",
    ] as const;
    const project = renderIeeeTypstProject({
      ast: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: keys.map((citeKey) => ({ type: "citation", citeKey })),
          },
        ],
      },
      references: keys.map((id, index) => ({
        id,
        type: types[index],
        title: index === 4 ? "中文标题" : `Work ${index}`,
        ...(index === 4 ? { author: [{ literal: "王伟" }] } : {}),
        ...(index === 0
          ? {
              "container-title": "Journal",
              issued: { "date-parts": [[2024]] },
              volume: "1",
              issue: "2",
              page: "3-4",
              publisher: "Society",
              DOI: "10.1000/test",
              URL: "https://example.com/article",
            }
          : {}),
      })),
    });
    const pdf = await createProductionTypstSandboxRunner().compile(project);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 120_000);

  it("embeds the bundled CJK font in a GB/T Chinese PDF", async () => {
    const project = renderGbt7714TypstProject({
      ast: {
        type: "doc",
        metadata: {
          title: "中文字体测试",
          abstract: "这是中文摘要",
        },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "你好，世界" }],
          },
        ],
      },
      references: [],
    });
    const pdf = await createProductionTypstSandboxRunner().compile(project);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("NotoSansCJKsc-Regular");
  }, 120_000);
});
