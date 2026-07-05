import { renderIeeeTypstDocument } from "@depress/transformers";
import { CompileJobPayloadSchema } from "../queue/compile-queue";
import type { TypstSandboxRunner } from "./typst-sandbox";

// Worker-side result contract. Deliberately no artifactUrl/signedUrl — the
// PDF stays local to the worker until the S3 TODO. Errors carry only safe,
// enum-like codes; never raw compiler output or Zod internals.
export type CompileJobOutcome =
  | { status: "succeeded"; pdfByteLength: number }
  | { status: "failed"; error: "INVALID_AST" | "COMPILE_FAILED" };

export interface CompileProcessorDeps {
  sandbox: TypstSandboxRunner;
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

  // renderIeeeTypstDocument re-validates the AST internally and injects it
  // into the immutable built-in IEEE template; citations flow citeKey →
  // #cite via the transformer only.
  let typstSource: string;
  try {
    typstSource = renderIeeeTypstDocument(parsed.data.ast);
  } catch {
    return { status: "failed", error: "INVALID_AST" };
  }

  try {
    const pdf = await deps.sandbox.compile(typstSource);
    return { status: "succeeded", pdfByteLength: pdf.byteLength };
  } catch {
    return { status: "failed", error: "COMPILE_FAILED" };
  }
}
