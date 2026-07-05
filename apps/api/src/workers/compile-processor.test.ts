import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { processCompileJob } from "./compile-processor";
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

describe("processCompileJob", () => {
  it("re-validates the payload and rejects an invalid AST without compiling", async () => {
    const { sandbox, compile } = fakeSandbox();
    const outcome = await processCompileJob(
      {
        ...validPayload(),
        ast: { type: "doc", content: [{ type: "heading", level: 4 }] },
      },
      { sandbox },
    );
    expect(outcome).toEqual({ status: "failed", error: "INVALID_AST" });
    expect(compile).not.toHaveBeenCalled();
  });

  it("renders via renderIeeeTypstDocument and passes IEEE Typst to the sandbox", async () => {
    const { sandbox, compile } = fakeSandbox();
    const outcome = await processCompileJob(validPayload(), { sandbox });
    expect(outcome.status).toBe("succeeded");
    expect(compile).toHaveBeenCalledTimes(1);
    const source = compile.mock.calls[0]?.[0] ?? "";
    // Citation goes through the transformer as #cite — never literal "[1]".
    expect(source).toContain('#cite(label("smith2024"))');
    expect(source).not.toContain("[1]");
    // Body is injected into the built-in IEEE template, not sent bare.
    expect(source).toContain("DePress Draft");
  });

  it("succeeds with pdf byte length and no artifact url fields", async () => {
    const { sandbox } = fakeSandbox(async () => Buffer.from("%PDF-1.7"));
    const outcome = await processCompileJob(validPayload(), { sandbox });
    expect(outcome).toEqual({ status: "succeeded", pdfByteLength: 8 });
    expect(outcome).not.toHaveProperty("artifactUrl");
    expect(outcome).not.toHaveProperty("signedUrl");
  });

  it("maps sandbox failures to a safe COMPILE_FAILED error", async () => {
    const { sandbox } = fakeSandbox(async () => {
      throw new Error("stderr: /host/secret/path exploded");
    });
    const outcome = await processCompileJob(validPayload(), { sandbox });
    expect(outcome).toEqual({ status: "failed", error: "COMPILE_FAILED" });
    expect(JSON.stringify(outcome)).not.toContain("secret");
  });

  it("drives job store status to succeeded / failed via outcomes", async () => {
    const store = createJobStore();
    const job = store.create({ templateId: "ieee", format: "pdf" });

    const ok = await processCompileJob(
      { ...validPayload(), jobId: job.id },
      fakeSandbox(),
    );
    store.setStatus(job.id, ok.status);
    expect(store.get(job.id)?.status).toBe("succeeded");

    const bad = await processCompileJob({ nonsense: true }, fakeSandbox());
    store.setStatus(job.id, bad.status);
    expect(store.get(job.id)?.status).toBe("failed");
  });
});
