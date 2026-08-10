import type { CompileSnapshot } from "@depress/ast";
import { describe, expect, it } from "vitest";
import {
  CompileInputTooLargeError,
  hashCompileSnapshot,
} from "./compile-job-repository";

function snapshot(text: string): CompileSnapshot {
  return {
    schemaVersion: 1,
    documentId: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    projectId: "22222222-2222-4222-8222-222222222222",
    compileRequest: {
      ast: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
      references: [],
      templateId: "ieee",
      format: "pdf",
    },
  };
}

describe("canonical compile snapshot size", () => {
  it("allows the exact UTF-8 byte boundary and rejects one byte over", () => {
    const candidate = snapshot("ascii");
    const measured = hashCompileSnapshot(candidate, Number.MAX_SAFE_INTEGER);
    const bytes = Buffer.byteLength(measured.canonical, "utf8");

    expect(hashCompileSnapshot(candidate, bytes).hash).toBe(measured.hash);
    expect(hashCompileSnapshot(candidate, bytes + 1).hash).toBe(measured.hash);
    expect(() => hashCompileSnapshot(candidate, bytes - 1)).toThrow(
      CompileInputTooLargeError,
    );
  });

  it("measures multibyte input as UTF-8 bytes rather than JS characters", () => {
    const measured = hashCompileSnapshot(snapshot("论文😀"), Number.MAX_SAFE_INTEGER);
    expect(Buffer.byteLength(measured.canonical, "utf8")).toBeGreaterThan(
      measured.canonical.length,
    );
    expect(() =>
      hashCompileSnapshot(snapshot("论文😀"), measured.canonical.length),
    ).toThrow(CompileInputTooLargeError);
  });
});
