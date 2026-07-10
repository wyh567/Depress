import {
  renderIeeeTypstProject,
  type TypstCompileProject,
} from "@depress/transformers";
import { CompileJobPayloadSchema, type JobFailureCode } from "@depress/ast";
import type { TypstSandboxRunner } from "./typst-sandbox";

// Worker-side result contract. The succeeded outcome carries the S3 object
// key only — signed URLs are generated on read by GET /jobs/:id, never here.
// Errors carry only safe, enum-like codes; never raw compiler/S3 output.
export type CompileJobOutcome =
  | { status: "succeeded"; artifactKey: string; pdfByteLength: number }
  | {
      status: "failed";
      error: Extract<
        JobFailureCode,
        "INVALID_AST" | "COMPILE_FAILED" | "UPLOAD_FAILED"
      >;
    };

// Storage seam — the S3 service satisfies this; tests inject a fake so no
// AWS traffic ever occurs in unit tests.
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

// Pure orchestration, injectable sandbox — unit-testable without Docker or
// Redis. The payload arrives as unknown: the worker never trusts the queue
// (cross-boundary data re-validated via @depress/ast, cursorrules).
export async function processCompileJob(
  payload: unknown,
  deps: CompileProcessorDeps,
): Promise<CompileJobOutcome> {
  const parsed = CompileJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: "failed", error: "INVALID_AST" };
  }

  // The project renderer reuses the shared compile schema, selects cited
  // references in first-occurrence order, and emits only fixed semantic file
  // contents. Citations remain citeKey-only until Typst applies IEEE style.
  let typstProject: TypstCompileProject;
  try {
    typstProject = renderIeeeTypstProject({
      ast: parsed.data.ast,
      references: parsed.data.references,
    });
  } catch {
    return { status: "failed", error: "INVALID_AST" };
  }

  // Sandbox tmp-dir cleanup lives in the sandbox's own finally block
  // (typst-sandbox.ts) and runs regardless of what happens after compile —
  // including an upload failure below.
  let pdf: Buffer;
  try {
    pdf = await deps.sandbox.compile(typstProject);
  } catch {
    return { status: "failed", error: "COMPILE_FAILED" };
  }

  const artifactKey = artifactKeyForJob(parsed.data.jobId);
  try {
    await deps.artifacts.uploadArtifact(artifactKey, pdf);
  } catch {
    return { status: "failed", error: "UPLOAD_FAILED" };
  }

  return { status: "succeeded", artifactKey, pdfByteLength: pdf.byteLength };
}
