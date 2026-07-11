import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderIeeeTypstProject } from "@depress/transformers";
import {
  DEFAULT_TYPST_IMAGE,
  TYPST_FONT_DIRECTORY,
  SANDBOX_BIBLIOGRAPHY_FILE,
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

  it("mounts controlled work and code-owned font directories, then runs typst", () => {
    expect(args[args.indexOf("-v") + 1]).toBe("/tmp/job-1:/work");
    expect(args[args.lastIndexOf("-v") + 1]).toBe(`${TYPST_FONT_DIRECTORY}:/fonts:ro`);
    expect(args).toContain(DEFAULT_TYPST_IMAGE);
    expect(args.slice(-5)).toEqual([
      "compile",
      "--font-path",
      "/fonts",
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
      expect(existsSync(join(workDir, SANDBOX_BIBLIOGRAPHY_FILE))).toBe(true);
      expect(await readFile(join(workDir, SANDBOX_INPUT_FILE), "utf8")).toBe(
        "#lorem(5)",
      );
      expect(
        await readFile(join(workDir, SANDBOX_BIBLIOGRAPHY_FILE), "utf8"),
      ).toBe('"a":\n  type: Book\n  title: "A"\n');
      await writeFile(join(workDir, SANDBOX_OUTPUT_FILE), "%PDF-fake");
    });
    const sandbox = createTypstSandboxRunner({ runner });
    const pdf = await sandbox.compile({
      main: "#lorem(5)",
      bibliography: '"a":\n  type: Book\n  title: "A"\n',
    });
    expect(pdf.toString()).toBe("%PDF-fake");
    expect(workDir).not.toBe("");
    expect(existsSync(workDir)).toBe(false);
  });

  it("writes only fixed filenames and has no path-bearing sandbox input", async () => {
    let files: string[] = [];
    const runner: CommandRunner = async (_cmd, args) => {
      const workDir = workDirFromArgs(args);
      files = (await readdir(workDir)).sort();
      await writeFile(join(workDir, SANDBOX_OUTPUT_FILE), "%PDF");
    };
    const sandbox = createTypstSandboxRunner({ runner });
    await sandbox.compile({
      main: "Body",
      bibliography: '"safe":\n  type: Misc\n  title: "Safe"\n',
      // Runtime excess properties cannot influence filenames because the API
      // accepts semantic contents, not a filename map.
      ...({ "../escape.typ": "evil" } as Record<string, string>),
    });
    expect(files).toEqual([
      SANDBOX_INPUT_FILE,
      SANDBOX_BIBLIOGRAPHY_FILE,
    ].sort());
  });

  it("omits references.yml for a citation-free project", async () => {
    const runner: CommandRunner = async (_cmd, args) => {
      const workDir = workDirFromArgs(args);
      expect(existsSync(join(workDir, SANDBOX_INPUT_FILE))).toBe(true);
      expect(existsSync(join(workDir, SANDBOX_BIBLIOGRAPHY_FILE))).toBe(false);
      await writeFile(join(workDir, SANDBOX_OUTPUT_FILE), "%PDF");
    };
    await createTypstSandboxRunner({ runner }).compile({ main: "No cites" });
  });

  it("cleans up and throws a safe error when docker fails", async () => {
    let workDir = "";
    const runner: CommandRunner = async (_cmd, args) => {
      workDir = workDirFromArgs(args);
      throw new Error("docker stderr with host details");
    };
    const sandbox = createTypstSandboxRunner({ runner });
    await expect(sandbox.compile({ main: "#lorem(5)" })).rejects.toThrow(
      SandboxCompileError,
    );
    await expect(sandbox.compile({ main: "#lorem(5)" })).rejects.not.toThrow(
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
    await createTypstSandboxRunner({ runner }).compile({ main: "x" });
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
  },
);
