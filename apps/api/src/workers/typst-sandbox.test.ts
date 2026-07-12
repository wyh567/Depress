import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { renderIeeeTypstProject } from "@depress/transformers";
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
  createTypstSandboxRunner,
  isDockerContainerId,
  type ManagedChildProcess,
  type SpawnProcess,
} from "./typst-sandbox";

const CID = "a".repeat(64);
const RUN_ID = "00000000-0000-4000-8000-000000000001";

function argValue(args: readonly string[], name: string): string {
  return args[args.indexOf(name) + 1] ?? "";
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

  it("keeps fixed mounts, entrypoint, font path, and filenames", () => {
    expect(argValue(args, "-v")).toBe("/tmp/job-1:/work");
    expect(args[args.lastIndexOf("-v") + 1]).toBe(`${TYPST_FONT_DIRECTORY}:/fonts:ro`);
    expect(argValue(args, "--entrypoint")).toBe("typst");
    expect(args.slice(-5)).toEqual([
      "compile",
      "--font-path",
      "/fonts",
      SANDBOX_INPUT_FILE,
      SANDBOX_OUTPUT_FILE,
    ]);
  });
});

describe("Docker container identity", () => {
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
    await createTypstSandboxRunner({ spawnProcess }).compile({ main: secretText });
    expect(labels.join(" ")).not.toContain(secretText);
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
    let runChild: FakeChild | undefined;
    const { spawnProcess, calls } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "run") {
        runChild = child;
        await writeFile(argValue(args, "--cidfile"), CID);
        child.onKill = (signal) => {
          if (signal === "SIGTERM") child.close(null, "SIGTERM");
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
    let runChild: FakeChild | undefined;
    const { spawnProcess } = spawnHarness(async ({ args, child }) => {
      if (args[0] === "run") {
        runChild = child;
        await writeFile(argValue(args, "--cidfile"), CID);
        child.onKill = (signal) => {
          if (signal === "SIGKILL") child.close(null, "SIGKILL");
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
    ).rejects.toMatchObject({ details: { reason: "docker-spawn", cleanup: "succeeded" } });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).toEqual(["rm", "--force", CID]);
  });
});

// Optional real-Docker smoke test — opt in with DEPRESS_DOCKER_SMOKE=1.
// Requires the already-approved pinned image. Default tests never run Docker.
describe.skipIf(process.env["DEPRESS_DOCKER_SMOKE"] !== "1")("typst sandbox (docker smoke)", () => {
  it("compiles a trivial document to a real PDF", async () => {
    const sandbox = createTypstSandboxRunner();
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
    const pdf = await createTypstSandboxRunner().compile(project);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 120_000);
});
