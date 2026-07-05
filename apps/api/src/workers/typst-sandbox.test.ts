import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TYPST_IMAGE,
  SANDBOX_INPUT_FILE,
  SANDBOX_OUTPUT_FILE,
  SandboxCompileError,
  buildTypstDockerArgs,
  createTypstSandboxRunner,
  type CommandRunner,
} from "./typst-sandbox";

describe("buildTypstDockerArgs", () => {
  const args = buildTypstDockerArgs({ workDir: "/tmp/job-1" });

  it("disables networking", () => {
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
  });

  it("hardens the container (read-only, caps, no-new-privileges, --rm)", () => {
    expect(args).toContain("--read-only");
    expect(args).toContain("--rm");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(args[args.indexOf("--security-opt") + 1]).toBe("no-new-privileges");
  });

  it("applies resource limits", () => {
    expect(args).toContain("--memory");
    expect(args).toContain("--cpus");
    expect(args).toContain("--pids-limit");
  });

  it("mounts only the controlled work dir and runs typst compile", () => {
    expect(args[args.indexOf("-v") + 1]).toBe("/tmp/job-1:/work");
    expect(args).toContain(DEFAULT_TYPST_IMAGE);
    expect(args.slice(-3)).toEqual([
      "compile",
      SANDBOX_INPUT_FILE,
      SANDBOX_OUTPUT_FILE,
    ]);
  });
});

describe("createTypstSandboxRunner", () => {
  function workDirFromArgs(args: string[]): string {
    const mount = args[args.indexOf("-v") + 1] ?? "";
    return mount.slice(0, mount.lastIndexOf(":/work"));
  }

  it("writes the source, returns the pdf, and cleans up the tmp dir", async () => {
    let workDir = "";
    const runner: CommandRunner = vi.fn(async (_cmd, args) => {
      workDir = workDirFromArgs(args);
      // Docker would produce out.pdf next to main.typ.
      expect(existsSync(join(workDir, SANDBOX_INPUT_FILE))).toBe(true);
      await writeFile(join(workDir, SANDBOX_OUTPUT_FILE), "%PDF-fake");
    });
    const sandbox = createTypstSandboxRunner({ runner });
    const pdf = await sandbox.compile("#lorem(5)");
    expect(pdf.toString()).toBe("%PDF-fake");
    expect(workDir).not.toBe("");
    expect(existsSync(workDir)).toBe(false);
  });

  it("cleans up and throws a safe error when docker fails", async () => {
    let workDir = "";
    const runner: CommandRunner = async (_cmd, args) => {
      workDir = workDirFromArgs(args);
      throw new Error("docker stderr with host details");
    };
    const sandbox = createTypstSandboxRunner({ runner });
    await expect(sandbox.compile("#lorem(5)")).rejects.toThrow(
      SandboxCompileError,
    );
    await expect(sandbox.compile("#lorem(5)")).rejects.not.toThrow(
      /host details/,
    );
    expect(existsSync(workDir)).toBe(false);
  });

  it("invokes docker with a timeout", async () => {
    const runner = vi.fn<CommandRunner>(async (_cmd, args) => {
      await writeFile(
        join(workDirFromArgs(args), SANDBOX_OUTPUT_FILE),
        "%PDF",
      );
    });
    await createTypstSandboxRunner({ runner }).compile("x");
    expect(runner).toHaveBeenCalledWith(
      "docker",
      expect.any(Array),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });
});

// Optional real-Docker smoke test — opt in with DEPRESS_DOCKER_SMOKE=1.
// Requires Docker and pulls the Typst image on first run.
describe.skipIf(process.env["DEPRESS_DOCKER_SMOKE"] !== "1")(
  "typst sandbox (docker smoke)",
  () => {
    it("compiles a trivial document to a real PDF", async () => {
      const sandbox = createTypstSandboxRunner();
      const pdf = await sandbox.compile("Hello from DePress.");
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }, 120_000);
  },
);
