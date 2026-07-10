import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import {
  TYPST_BIBLIOGRAPHY_FILE,
  TYPST_ENTRYPOINT_FILE,
  type TypstCompileProject,
} from "@depress/transformers";

// Sandbox policy (architecture.md §2 "Sandbox", Invariant #4): Typst
// processes untrusted input, so it runs in Docker with no network, a
// read-only rootfs, an isolated per-job work dir, and hard resource limits.
// Image verified against ghcr.io (official typst/typst package); latest
// stable tag at time of writing is 0.15.0. Override via TYPST_SANDBOX_IMAGE.
export const DEFAULT_TYPST_IMAGE = "ghcr.io/typst/typst:0.15.0";

export const SANDBOX_LIMITS = {
  memory: "512m",
  cpus: "1",
  pidsLimit: "64",
  timeoutMs: 30_000,
} as const;

export const SANDBOX_INPUT_FILE = TYPST_ENTRYPOINT_FILE;
export const SANDBOX_BIBLIOGRAPHY_FILE = TYPST_BIBLIOGRAPHY_FILE;
export const SANDBOX_OUTPUT_FILE = "out.pdf";

// Pure — unit-testable without Docker. workDir is the only writable mount.
export function buildTypstDockerArgs(options: {
  workDir: string;
  image?: string | undefined;
}): string[] {
  const image = options.image ?? DEFAULT_TYPST_IMAGE;
  return [
    "run",
    "--rm",
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
    "-w",
    "/work",
    // Explicit entrypoint: never rely on the image default.
    "--entrypoint",
    "typst",
    image,
    "compile",
    SANDBOX_INPUT_FILE,
    SANDBOX_OUTPUT_FILE,
  ];
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<void>;

const defaultRunner: CommandRunner = (command, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

export class SandboxCompileError extends Error {
  // Message is intentionally generic; raw stderr may echo document content
  // or host paths and must not reach API clients.
  constructor() {
    super("Typst compilation failed in sandbox");
    this.name = "SandboxCompileError";
  }
}

export interface TypstSandboxRunner {
  compile(project: TypstCompileProject): Promise<Buffer>;
}

// Writes the source into a fresh controlled tmp dir, runs Typst in Docker,
// returns the PDF bytes, and always removes the tmp dir — success or failure.
// No upload, no URL: artifact handling belongs to the S3 TODO.
export function createTypstSandboxRunner(
  options: { image?: string; runner?: CommandRunner } = {},
): TypstSandboxRunner {
  const runner = options.runner ?? defaultRunner;
  return {
    async compile(project) {
      const workDir = await mkdtemp(join(tmpdir(), "depress-typst-"));
      try {
        await writeFile(join(workDir, SANDBOX_INPUT_FILE), project.main, "utf8");
        if (project.bibliography !== undefined) {
          await writeFile(
            join(workDir, SANDBOX_BIBLIOGRAPHY_FILE),
            project.bibliography,
            "utf8",
          );
        }
        try {
          await runner(
            "docker",
            buildTypstDockerArgs({ workDir, image: options.image }),
            { timeoutMs: SANDBOX_LIMITS.timeoutMs },
          );
        } catch {
          throw new SandboxCompileError();
        }
        return await readFile(join(workDir, SANDBOX_OUTPUT_FILE));
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}
