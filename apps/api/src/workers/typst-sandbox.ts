import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  TYPST_BIBLIOGRAPHY_FILE,
  TYPST_ENTRYPOINT_FILE,
  type TypstCompileProject,
} from "@depress/transformers";

// Code-owned immutable image identity. Do not add a request or environment
// override: compile input must never select executable sandbox infrastructure.
export const DEFAULT_TYPST_IMAGE =
  "ghcr.io/typst/typst@sha256:b23ba03da5c085a2c8780bc9f2296db937abe1d0c75348cf2f8a9273199c3a14";

// Immutable bundled fallback for CJK semantic content. This code-owned asset
// is mounted read-only; compile input cannot select a host path or font.
export const TYPST_FONT_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../assets/fonts"
);

export const SANDBOX_LIMITS = {
  memory: "512m",
  cpus: "1",
  pidsLimit: "64",
  timeoutMs: 30_000,
  termGraceMs: 1_000,
  killGraceMs: 1_000,
  cleanupTimeoutMs: 5_000,
  cleanupTermGraceMs: 500,
  cleanupKillGraceMs: 500,
  cidReadAttempts: 5,
  cidReadDelayMs: 50,
  maxOutputBytes: 64 * 1024,
} as const;

export const SANDBOX_INPUT_FILE = TYPST_ENTRYPOINT_FILE;
export const SANDBOX_BIBLIOGRAPHY_FILE = TYPST_BIBLIOGRAPHY_FILE;
export const SANDBOX_OUTPUT_FILE = "out.pdf";
export const SANDBOX_CID_FILE = "container.cid";

export const SANDBOX_LABELS = {
  managed: "com.depress.managed=true",
  component: "com.depress.component=typst-sandbox",
  runId: "com.depress.run-id",
} as const;

const DOCKER_CONTAINER_ID = /^[0-9a-f]{64}$/;

export function isDockerContainerId(value: string): boolean {
  return DOCKER_CONTAINER_ID.test(value);
}

// Pure argument builder. runId and cidFile are generated inside the sandbox
// runner and are never accepted from compile/HTTP input.
export function buildTypstDockerArgs(options: {
  workDir: string;
  runId: string;
  cidFile: string;
}): string[] {
  return [
    "run",
    "--rm",
    "--cidfile",
    options.cidFile,
    "--label",
    SANDBOX_LABELS.managed,
    "--label",
    SANDBOX_LABELS.component,
    "--label",
    `${SANDBOX_LABELS.runId}=${options.runId}`,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    SANDBOX_LIMITS.memory,
    "--cpus",
    SANDBOX_LIMITS.cpus,
    "--pids-limit",
    SANDBOX_LIMITS.pidsLimit,
    "-v",
    `${options.workDir}:/work`,
    "-v",
    `${TYPST_FONT_DIRECTORY}:/fonts:ro`,
    "-w",
    "/work",
    "--entrypoint",
    "typst",
    DEFAULT_TYPST_IMAGE,
    "compile",
    "--font-path",
    "/fonts",
    SANDBOX_INPUT_FILE,
    SANDBOX_OUTPUT_FILE,
  ];
}

export interface ManagedChildProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this;
  kill(signal: NodeJS.Signals): boolean;
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: {
    shell: false;
    windowsHide: true;
    stdio: ["ignore", "pipe", "pipe"];
  }
) => ManagedChildProcess;

const defaultSpawnProcess: SpawnProcess = (command, args, options) =>
  spawn(command, args, options) as ChildProcess as ManagedChildProcess;

interface OutputCapture {
  capturedBytes: number;
  truncated: boolean;
  streamError: boolean;
}

interface CommandResult {
  status: "exited" | "timed-out" | "spawn-error";
  code: number | null;
  signal: NodeJS.Signals | null;
  closeConfirmed: boolean;
  sigtermAttempted: boolean;
  sigtermAccepted: boolean;
  sigkillAttempted: boolean;
  sigkillAccepted: boolean;
  stdout: OutputCapture;
  stderr: OutputCapture;
  stderrText: string;
}

interface CommandTimings {
  timeoutMs: number;
  termGraceMs: number;
  killGraceMs: number;
  maxOutputBytes: number;
}

function captureBounded(
  stream: NodeJS.ReadableStream | null,
  maxBytes: number
): { result(): OutputCapture; text(): string } {
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  let truncated = false;
  let streamError = false;

  stream?.on("data", (chunk: unknown) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const remaining = maxBytes - capturedBytes;
    if (remaining > 0) {
      const kept = bytes.subarray(0, remaining);
      chunks.push(kept);
      capturedBytes += kept.byteLength;
    }
    if (bytes.byteLength > remaining) truncated = true;
  });
  stream?.on("error", () => {
    streamError = true;
  });

  return {
    result: () => ({ capturedBytes, truncated, streamError }),
    text: () => Buffer.concat(chunks).toString("utf8"),
  };
}

function runBoundedCommand(
  spawnProcess: SpawnProcess,
  command: string,
  args: readonly string[],
  timings: CommandTimings
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let child: ManagedChildProcess;
    try {
      child = spawnProcess(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({
        status: "spawn-error",
        code: null,
        signal: null,
        closeConfirmed: false,
        sigtermAttempted: false,
        sigtermAccepted: false,
        sigkillAttempted: false,
        sigkillAccepted: false,
        stdout: { capturedBytes: 0, truncated: false, streamError: false },
        stderr: { capturedBytes: 0, truncated: false, streamError: false },
        stderrText: "",
      });
      return;
    }

    const stdout = captureBounded(child.stdout, timings.maxOutputBytes);
    const stderr = captureBounded(child.stderr, timings.maxOutputBytes);
    let settled = false;
    let timedOut = false;
    let sigtermAttempted = false;
    let sigtermAccepted = false;
    let sigkillAttempted = false;
    let sigkillAccepted = false;
    let termTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let signalling = false;
    let pendingError = false;
    let pendingClose: { code: number | null; signal: NodeJS.Signals | null } | undefined;

    const finish = (
      status: CommandResult["status"],
      code: number | null,
      signal: NodeJS.Signals | null,
      closeConfirmed: boolean
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (termTimer) clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        status,
        code,
        signal,
        closeConfirmed,
        sigtermAttempted,
        sigtermAccepted,
        sigkillAttempted,
        sigkillAccepted,
        stdout: stdout.result(),
        stderr: stderr.result(),
        stderrText: stderr.text(),
      });
    };

    const flushPendingEvents = () => {
      if (pendingClose) {
        const { code, signal } = pendingClose;
        pendingClose = undefined;
        finish(timedOut ? "timed-out" : "exited", code, signal, true);
      } else if (pendingError) {
        pendingError = false;
        finish("spawn-error", null, null, false);
      }
    };

    const requestSignal = (signal: "SIGTERM" | "SIGKILL") => {
      signalling = true;
      let accepted = false;
      try {
        accepted = child.kill(signal);
      } catch {
        accepted = false;
      }
      if (signal === "SIGTERM") sigtermAccepted = accepted;
      else sigkillAccepted = accepted;
      signalling = false;
      flushPendingEvents();
    };

    child.once("error", () => {
      if (signalling) pendingError = true;
      else finish("spawn-error", null, null, false);
    });
    child.once("close", (code, signal) => {
      if (signalling) pendingClose = { code, signal };
      else finish(timedOut ? "timed-out" : "exited", code, signal, true);
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      sigtermAttempted = true;
      requestSignal("SIGTERM");
      if (settled) return;
      termTimer = setTimeout(() => {
        if (settled) return;
        sigkillAttempted = true;
        requestSignal("SIGKILL");
        if (settled) return;
        killTimer = setTimeout(() => finish("timed-out", null, null, false), timings.killGraceMs);
      }, timings.termGraceMs);
    }, timings.timeoutMs);
  });
}

type CleanupStatus = "not-needed" | "succeeded" | "failed" | "identity-unavailable";

export interface SandboxFailureDetails {
  reason: "docker-exit" | "docker-timeout" | "docker-spawn" | "container-identity" | "output-read";
  cleanup: CleanupStatus;
  dockerCliClosed: boolean;
  cleanupCliClosed: boolean | null;
  sigtermAttempted: boolean;
  sigtermAccepted: boolean;
  sigkillAttempted: boolean;
  sigkillAccepted: boolean;
  stdout: OutputCapture;
  stderr: OutputCapture;
}

export class SandboxCompileError extends Error {
  // Raw Docker output, paths, commands, and container IDs are intentionally
  // absent. The bounded details are safe for tests and future diagnostics.
  constructor(readonly details: SandboxFailureDetails) {
    super("Typst compilation failed in sandbox");
    this.name = "SandboxCompileError";
  }
}

async function readValidatedContainerId(
  cidFile: string,
  attempts: number,
  delayMs: number
): Promise<string | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const containerId = (await readFile(cidFile, "utf8")).trim();
      if (isDockerContainerId(containerId)) return containerId;
    } catch {
      // A bounded retry handles a CID file written just after logical timeout.
    }
    if (attempt < attempts) await delay(delayMs);
  }
  return null;
}

function isAlreadyRemoved(stderr: string): boolean {
  return stderr.toLowerCase().includes("no such container");
}

async function cleanupExactContainer(
  spawnProcess: SpawnProcess,
  containerId: string,
  timings: CommandTimings
): Promise<{ status: "succeeded" | "failed"; cliClosed: boolean }> {
  const result = await runBoundedCommand(
    spawnProcess,
    "docker",
    ["rm", "--force", containerId],
    timings
  );
  if (result.status === "exited" && result.code === 0) {
    return { status: "succeeded", cliClosed: result.closeConfirmed };
  }
  if (result.status === "exited" && isAlreadyRemoved(result.stderrText)) {
    return { status: "succeeded", cliClosed: result.closeConfirmed };
  }
  return { status: "failed", cliClosed: result.closeConfirmed };
}

export interface TypstSandboxRunner {
  compile(project: TypstCompileProject): Promise<Buffer>;
}

interface SandboxTimings {
  executionTimeoutMs: number;
  termGraceMs: number;
  killGraceMs: number;
  cleanupTimeoutMs: number;
  cleanupTermGraceMs: number;
  cleanupKillGraceMs: number;
  cidReadAttempts: number;
  cidReadDelayMs: number;
  maxOutputBytes: number;
}

export function createTypstSandboxRunner(
  options: {
    spawnProcess?: SpawnProcess;
    createRunId?: () => string;
    timings?: Partial<SandboxTimings>;
  } = {}
): TypstSandboxRunner {
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  const createRunId = options.createRunId ?? randomUUID;
  const timings: SandboxTimings = {
    executionTimeoutMs: SANDBOX_LIMITS.timeoutMs,
    termGraceMs: SANDBOX_LIMITS.termGraceMs,
    killGraceMs: SANDBOX_LIMITS.killGraceMs,
    cleanupTimeoutMs: SANDBOX_LIMITS.cleanupTimeoutMs,
    cleanupTermGraceMs: SANDBOX_LIMITS.cleanupTermGraceMs,
    cleanupKillGraceMs: SANDBOX_LIMITS.cleanupKillGraceMs,
    cidReadAttempts: SANDBOX_LIMITS.cidReadAttempts,
    cidReadDelayMs: SANDBOX_LIMITS.cidReadDelayMs,
    maxOutputBytes: SANDBOX_LIMITS.maxOutputBytes,
    ...options.timings,
  };

  return {
    async compile(project) {
      const runId = createRunId();
      const runDir = await mkdtemp(join(tmpdir(), "depress-typst-"));
      const workDir = join(runDir, "work");
      const cidFile = join(runDir, SANDBOX_CID_FILE);
      try {
        await mkdir(workDir);
        await writeFile(join(workDir, SANDBOX_INPUT_FILE), project.main, "utf8");
        if (project.bibliography !== undefined) {
          await writeFile(join(workDir, SANDBOX_BIBLIOGRAPHY_FILE), project.bibliography, "utf8");
        }

        const result = await runBoundedCommand(
          spawnProcess,
          "docker",
          buildTypstDockerArgs({ workDir, runId, cidFile }),
          {
            timeoutMs: timings.executionTimeoutMs,
            termGraceMs: timings.termGraceMs,
            killGraceMs: timings.killGraceMs,
            maxOutputBytes: timings.maxOutputBytes,
          }
        );
        const containerId = await readValidatedContainerId(
          cidFile,
          result.closeConfirmed ? 1 : timings.cidReadAttempts,
          timings.cidReadDelayMs
        );

        if (result.status !== "exited" || result.code !== 0) {
          const cleanupResult = containerId
            ? await cleanupExactContainer(spawnProcess, containerId, {
                timeoutMs: timings.cleanupTimeoutMs,
                termGraceMs: timings.cleanupTermGraceMs,
                killGraceMs: timings.cleanupKillGraceMs,
                maxOutputBytes: timings.maxOutputBytes,
              })
            : null;
          throw new SandboxCompileError({
            reason:
              result.status === "timed-out"
                ? "docker-timeout"
                : result.status === "spawn-error"
                  ? "docker-spawn"
                  : "docker-exit",
            cleanup: cleanupResult?.status ?? "identity-unavailable",
            dockerCliClosed: result.closeConfirmed,
            cleanupCliClosed: cleanupResult?.cliClosed ?? null,
            sigtermAttempted: result.sigtermAttempted,
            sigtermAccepted: result.sigtermAccepted,
            sigkillAttempted: result.sigkillAttempted,
            sigkillAccepted: result.sigkillAccepted,
            stdout: result.stdout,
            stderr: result.stderr,
          });
        }

        if (!containerId) {
          throw new SandboxCompileError({
            reason: "container-identity",
            cleanup: "identity-unavailable",
            dockerCliClosed: result.closeConfirmed,
            cleanupCliClosed: null,
            sigtermAttempted: result.sigtermAttempted,
            sigtermAccepted: result.sigtermAccepted,
            sigkillAttempted: result.sigkillAttempted,
            sigkillAccepted: result.sigkillAccepted,
            stdout: result.stdout,
            stderr: result.stderr,
          });
        }

        try {
          return await readFile(join(workDir, SANDBOX_OUTPUT_FILE));
        } catch {
          throw new SandboxCompileError({
            reason: "output-read",
            cleanup: "not-needed",
            dockerCliClosed: result.closeConfirmed,
            cleanupCliClosed: null,
            sigtermAttempted: result.sigtermAttempted,
            sigtermAccepted: result.sigtermAccepted,
            sigkillAttempted: result.sigkillAttempted,
            sigkillAccepted: result.sigkillAccepted,
            stdout: result.stdout,
            stderr: result.stderr,
          });
        }
      } finally {
        // Exact container cleanup above always settles before host files go away.
        await rm(runDir, { recursive: true, force: true });
      }
    },
  };
}
