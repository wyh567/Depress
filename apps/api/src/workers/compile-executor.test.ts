import { randomUUID } from "node:crypto";
import type { CompileRequest } from "@depress/ast";
import type { TypstCompileProject } from "@depress/transformers";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactUploader } from "../services/artifact-contracts";
import {
  artifactKeyForJob,
  executeCompileRequest,
} from "./compile-executor";
import type { TypstSandboxRunner } from "./typst-sandbox";

const validRequest = (): CompileRequest => ({
  ast: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }],
  },
  references: [],
  templateId: "ieee",
  format: "pdf",
});

function fakeSandbox(
  impl: (project: TypstCompileProject) => Promise<Buffer> = async () =>
    Buffer.from("%PDF-1.7"),
): TypstSandboxRunner {
  return { compile: vi.fn(impl) };
}

function fakeArtifacts(
  impl: (key: string, pdf: Buffer) => Promise<void> = async () => undefined,
): ArtifactUploader {
  return { uploadArtifact: vi.fn(impl) };
}

describe("authenticated compile executor", () => {
  it("uploads a valid PDF under the deterministic artifact key", async () => {
    const jobId = randomUUID();
    const sandbox = fakeSandbox();
    const artifacts = fakeArtifacts();

    await expect(
      executeCompileRequest(jobId, validRequest(), { sandbox, artifacts }),
    ).resolves.toEqual({
      status: "succeeded",
      artifactKey: `artifacts/${jobId}.pdf`,
      pdfByteLength: 8,
    });
    expect(artifacts.uploadArtifact).toHaveBeenCalledWith(
      artifactKeyForJob(jobId),
      Buffer.from("%PDF-1.7"),
    );
  });

  it("fails closed before sandbox execution for an invalid request", async () => {
    const sandbox = fakeSandbox();
    const artifacts = fakeArtifacts();

    await expect(
      executeCompileRequest(
        randomUUID(),
        { ...validRequest(), format: "docx" } as unknown as CompileRequest,
        { sandbox, artifacts },
      ),
    ).resolves.toEqual({ status: "failed", error: "INVALID_AST" });
    expect(sandbox.compile).not.toHaveBeenCalled();
    expect(artifacts.uploadArtifact).not.toHaveBeenCalled();
  });

  it("rejects non-PDF sandbox output without uploading it", async () => {
    const artifacts = fakeArtifacts();

    await expect(
      executeCompileRequest(randomUUID(), validRequest(), {
        sandbox: fakeSandbox(async () => Buffer.from("not a pdf")),
        artifacts,
      }),
    ).resolves.toEqual({ status: "failed", error: "COMPILE_FAILED" });
    expect(artifacts.uploadArtifact).not.toHaveBeenCalled();
  });

  it("maps artifact upload failures to the safe public error", async () => {
    await expect(
      executeCompileRequest(randomUUID(), validRequest(), {
        sandbox: fakeSandbox(),
        artifacts: fakeArtifacts(async () => {
          throw new Error("private storage detail");
        }),
      }),
    ).resolves.toEqual({ status: "failed", error: "UPLOAD_FAILED" });
  });
});
