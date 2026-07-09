import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  artifactKeyForJob,
  processCompileJob,
  type ArtifactUploader,
} from "./compile-processor";
import { createJobStore } from "../services/job-store";
import type { TypstSandboxRunner } from "./typst-sandbox";

const validPayload = () => ({
  jobId: randomUUID(),
  ast: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "citation", citeKey: "smith2024" },
        ],
      },
    ],
  },
  references: [
    {
      id: "smith2024",
      type: "article-journal",
      title: "A Study",
      volume: "12",
    },
  ],
  templateId: "ieee",
  format: "pdf",
});

function fakeSandbox(
  impl: (source: string) => Promise<Buffer> = async () => Buffer.from("%PDF"),
) {
  const compile = vi.fn(impl);
  const sandbox: TypstSandboxRunner = { compile };
  return { sandbox, compile };
}

function fakeArtifacts(
  impl: (key: string, pdf: Buffer) => Promise<void> = async () => {},
) {
  const uploadArtifact = vi.fn(impl);
  const artifacts: ArtifactUploader = { uploadArtifact };
  return { artifacts, uploadArtifact };
}

describe("processCompileJob", () => {
  it("re-validates the payload and rejects an invalid AST without compiling", async () => {
    const { sandbox, compile } = fakeSandbox();
    const { artifacts, uploadArtifact } = fakeArtifacts();
    const outcome = await processCompileJob(
      {
        ...validPayload(),
        ast: { type: "doc", content: [{ type: "heading", level: 4 }] },
      },
      { sandbox, artifacts },
    );
    expect(outcome).toEqual({ status: "failed", error: "INVALID_AST" });
    expect(compile).not.toHaveBeenCalled();
    expect(uploadArtifact).not.toHaveBeenCalled();
  });

  it("rejects invalid queued references without compiling", async () => {
    const { sandbox, compile } = fakeSandbox();
    const { artifacts, uploadArtifact } = fakeArtifacts();
    const outcome = await processCompileJob(
      {
        ...validPayload(),
        references: [{ id: "   ", type: "book", title: "T" }],
      },
      { sandbox, artifacts },
    );
    expect(outcome).toEqual({ status: "failed", error: "INVALID_AST" });
    expect(compile).not.toHaveBeenCalled();
    expect(uploadArtifact).not.toHaveBeenCalled();
  });

  it("accepts valid references and leaves compilation behavior unchanged", async () => {
    const { sandbox, compile } = fakeSandbox();
    const { artifacts } = fakeArtifacts();
    const payload = validPayload();
    const outcome = await processCompileJob(payload, { sandbox, artifacts });
    expect(outcome.status).toBe("succeeded");
    // TODO #3 will consume references; this task only transports them.
    expect(payload.references).toHaveLength(1);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("renders via renderIeeeTypstDocument and passes IEEE Typst to the sandbox", async () => {
    const { sandbox, compile } = fakeSandbox();
    const { artifacts } = fakeArtifacts();
    const outcome = await processCompileJob(validPayload(), {
      sandbox,
      artifacts,
    });
    expect(outcome.status).toBe("succeeded");
    expect(compile).toHaveBeenCalledTimes(1);
    const source = compile.mock.calls[0]?.[0] ?? "";
    // Citation goes through the transformer as #cite — never literal "[1]".
    expect(source).toContain('#cite(label("smith2024"))');
    expect(source).not.toContain("[1]");
    // Body is injected into the built-in IEEE template, not sent bare.
    expect(source).toContain("DePress Draft");
  });

  it("uploads the PDF under artifacts/{jobId}.pdf and returns the key", async () => {
    const payload = validPayload();
    const { sandbox } = fakeSandbox(async () => Buffer.from("%PDF-1.7"));
    const { artifacts, uploadArtifact } = fakeArtifacts();
    const outcome = await processCompileJob(payload, { sandbox, artifacts });
    expect(outcome).toEqual({
      status: "succeeded",
      artifactKey: artifactKeyForJob(payload.jobId),
      pdfByteLength: 8,
    });
    expect(uploadArtifact).toHaveBeenCalledWith(
      `artifacts/${payload.jobId}.pdf`,
      expect.any(Buffer),
    );
    // Signed URLs are minted on read by the API, never by the worker.
    expect(outcome).not.toHaveProperty("downloadUrl");
    expect(outcome).not.toHaveProperty("signedUrl");
  });

  it("maps sandbox failures to a safe COMPILE_FAILED error and skips upload", async () => {
    const { sandbox } = fakeSandbox(async () => {
      throw new Error("stderr: /host/secret/path exploded");
    });
    const { artifacts, uploadArtifact } = fakeArtifacts();
    const outcome = await processCompileJob(validPayload(), {
      sandbox,
      artifacts,
    });
    expect(outcome).toEqual({ status: "failed", error: "COMPILE_FAILED" });
    expect(JSON.stringify(outcome)).not.toContain("secret");
    expect(uploadArtifact).not.toHaveBeenCalled();
  });

  it("maps upload failures to a safe UPLOAD_FAILED error", async () => {
    const { sandbox } = fakeSandbox();
    const { artifacts } = fakeArtifacts(async () => {
      throw new Error("S3: AccessDenied for arn:aws:secret");
    });
    const outcome = await processCompileJob(validPayload(), {
      sandbox,
      artifacts,
    });
    expect(outcome).toEqual({ status: "failed", error: "UPLOAD_FAILED" });
    expect(JSON.stringify(outcome)).not.toContain("arn:aws");
  });

  it("still runs the sandbox finally-cleanup when the upload throws", async () => {
    // Real sandbox with a fake docker runner: the tmp dir must be gone even
    // though the artifact upload fails afterwards.
    const fs = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { createTypstSandboxRunner, SANDBOX_OUTPUT_FILE } = await import(
      "./typst-sandbox"
    );
    const dirs: string[] = [];
    const sandbox = createTypstSandboxRunner({
      runner: async (_cmd, args) => {
        // -v mount is "<workDir>:/work"; lastIndexOf handles Windows drive colons.
        const mount = args[args.indexOf("-v") + 1] ?? "";
        const workDir = mount.slice(0, mount.lastIndexOf(":"));
        dirs.push(workDir);
        await fs.writeFile(
          join(workDir, SANDBOX_OUTPUT_FILE),
          Buffer.from("%PDF"),
        );
      },
    });
    const { artifacts } = fakeArtifacts(async () => {
      throw new Error("upload boom");
    });

    const outcome = await processCompileJob(validPayload(), {
      sandbox,
      artifacts,
    });

    expect(outcome).toEqual({ status: "failed", error: "UPLOAD_FAILED" });
    expect(dirs.length).toBe(1);
    const stat = await fs.stat(dirs[0]!).catch(() => null);
    expect(stat).toBeNull();
  });

  it("drives job store status to succeeded / failed via outcomes", async () => {
    const store = createJobStore();
    const job = store.create({ templateId: "ieee", format: "pdf" });
    const deps = { ...fakeSandbox(), ...fakeArtifacts() };

    const ok = await processCompileJob(
      { ...validPayload(), jobId: job.id },
      deps,
    );
    if (ok.status !== "succeeded") throw new Error("expected success");
    store.setStatus(job.id, ok.status, { artifactKey: ok.artifactKey });
    expect(store.get(job.id)?.status).toBe("succeeded");
    expect(store.get(job.id)?.artifactKey).toBe(artifactKeyForJob(job.id));

    const bad = await processCompileJob({ nonsense: true }, deps);
    if (bad.status !== "failed") throw new Error("expected failure");
    store.setStatus(job.id, bad.status, { error: bad.error });
    expect(store.get(job.id)?.status).toBe("failed");
    expect(store.get(job.id)?.error).toBe("INVALID_AST");
  });
});
