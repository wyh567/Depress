import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JobFailureCodeSchema, JobResponseSchema } from "./job";

const jobId = randomUUID();

describe("JobResponseSchema", () => {
  it("accepts queued/processing without extra fields", () => {
    expect(JobResponseSchema.parse({ jobId, status: "queued" })).toEqual({
      jobId,
      status: "queued",
    });
    expect(
      JobResponseSchema.parse({ jobId, status: "processing" }),
    ).toEqual({ jobId, status: "processing" });
  });

  it("requires downloadUrl on succeeded jobs", () => {
    expect(
      JobResponseSchema.parse({
        jobId,
        status: "succeeded",
        downloadUrl: "https://s3.example.com/artifacts/x.pdf?sig=abc",
      }).status,
    ).toBe("succeeded");
    expect(
      JobResponseSchema.safeParse({ jobId, status: "succeeded" }).success,
    ).toBe(false);
  });

  it("rejects downloadUrl on non-succeeded jobs (strict variants)", () => {
    for (const status of ["queued", "processing"] as const) {
      const res = JobResponseSchema.safeParse({
        jobId,
        status,
        downloadUrl: "https://s3.example.com/leak.pdf",
      });
      expect(res.success).toBe(false);
    }
    expect(
      JobResponseSchema.safeParse({
        jobId,
        status: "failed",
        error: "COMPILE_FAILED",
        downloadUrl: "https://s3.example.com/leak.pdf",
      }).success,
    ).toBe(false);
  });

  it("requires a known failure code on failed jobs", () => {
    expect(
      JobResponseSchema.parse({
        jobId,
        status: "failed",
        error: "UPLOAD_FAILED",
      }).status,
    ).toBe("failed");
    expect(
      JobResponseSchema.safeParse({ jobId, status: "failed" }).success,
    ).toBe(false);
    expect(
      JobResponseSchema.safeParse({
        jobId,
        status: "failed",
        error: "stderr: raw compiler dump",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-url downloadUrl and a non-uuid jobId", () => {
    expect(
      JobResponseSchema.safeParse({
        jobId,
        status: "succeeded",
        downloadUrl: "not-a-url",
      }).success,
    ).toBe(false);
    expect(
      JobResponseSchema.safeParse({ jobId: "42", status: "queued" }).success,
    ).toBe(false);
  });
});

describe("JobFailureCodeSchema", () => {
  it("only admits the safe enum codes", () => {
    expect(JobFailureCodeSchema.parse("INVALID_AST")).toBe("INVALID_AST");
    expect(JobFailureCodeSchema.safeParse("EACCES /host/path").success).toBe(
      false,
    );
  });
});
