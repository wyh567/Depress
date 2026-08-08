import {
  CompileJobPayloadSchema,
  CompileRequestSchema,
  type CompileRequest,
  type JobFailureCode,
} from "@depress/ast";
import {
  renderTypstProject,
  type TypstCompileProject,
} from "@depress/transformers";
import type { TypstSandboxRunner } from "./typst-sandbox";

export type CompileJobOutcome =
  | { status: "succeeded"; artifactKey: string; pdfByteLength: number }
  | {
      status: "failed";
      error: Extract<
        JobFailureCode,
        "INVALID_AST" | "COMPILE_FAILED" | "UPLOAD_FAILED"
      >;
    };

export interface ArtifactUploader {
  uploadArtifact(key: string, pdf: Buffer): Promise<void>;
}

export interface CompileProcessorDeps {
  sandbox: TypstSandboxRunner;
  artifacts: ArtifactUploader;
}

export function artifactKeyForJob(jobId: string): string {
  return `artifacts/${jobId}.pdf`;
}

// Shared execution boundary for both the legacy full-payload worker and the
// persisted pointer worker. Callers must validate their own transport first.
export async function executeCompileRequest(
  jobId: string,
  request: CompileRequest,
  deps: CompileProcessorDeps,
): Promise<CompileJobOutcome> {
  const parsed = CompileRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { status: "failed", error: "INVALID_AST" };
  }

  let typstProject: TypstCompileProject;
  try {
    typstProject = renderTypstProject(parsed.data);
  } catch {
    return { status: "failed", error: "INVALID_AST" };
  }

  // The hardened sandbox owns temporary-directory cleanup in its finally
  // block. Nothing here derives a path from document content.
  let pdf: Buffer;
  try {
    pdf = await deps.sandbox.compile(typstProject);
  } catch {
    return { status: "failed", error: "COMPILE_FAILED" };
  }
  if (
    pdf.byteLength < 5 ||
    pdf.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    return { status: "failed", error: "COMPILE_FAILED" };
  }

  const artifactKey = artifactKeyForJob(jobId);
  try {
    await deps.artifacts.uploadArtifact(artifactKey, pdf);
  } catch {
    return { status: "failed", error: "UPLOAD_FAILED" };
  }

  return { status: "succeeded", artifactKey, pdfByteLength: pdf.byteLength };
}

// Legacy Phase 3 queue contract remains operational until final cutover.
export async function processCompileJob(
  payload: unknown,
  deps: CompileProcessorDeps,
): Promise<CompileJobOutcome> {
  const parsed = CompileJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: "failed", error: "INVALID_AST" };
  }
  return executeCompileRequest(
    parsed.data.jobId,
    {
      ast: parsed.data.ast,
      references: parsed.data.references,
      templateId: parsed.data.templateId,
      format: parsed.data.format,
    },
    deps,
  );
}
