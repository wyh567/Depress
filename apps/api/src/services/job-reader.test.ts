import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { JobResponseSchema } from "@depress/ast";
import { buildApp } from "../app";
import {
  createBullmqJobReader,
  type BullmqJobLike,
  type BullmqQueueLike,
} from "./job-reader";

function fakeQueue(jobs: Record<string, BullmqJobLike>): BullmqQueueLike {
  return {
    async getJob(id) {
      return jobs[id] ?? null;
    },
  };
}

function fakeJob(
  state: string,
  extra: Partial<Pick<BullmqJobLike, "returnvalue" | "failedReason">> = {},
): BullmqJobLike {
  return {
    returnvalue: extra.returnvalue ?? null,
    ...(extra.failedReason !== undefined
      ? { failedReason: extra.failedReason }
      : {}),
    getState: vi.fn(async () => state),
  };
}

describe("createBullmqJobReader state mapping", () => {
  const id = randomUUID();

  it.each([
    ["waiting", "queued"],
    ["delayed", "queued"],
    ["prioritized", "queued"],
    ["waiting-children", "queued"],
    ["active", "processing"],
  ] as const)("maps BullMQ %s to %s", async (state, status) => {
    const reader = createBullmqJobReader(
      { host: "unused", port: 0 },
      { queue: fakeQueue({ [id]: fakeJob(state) }) },
    );
    expect(await reader.get(id)).toEqual({ id, status });
  });

  it("maps completed with a valid returnvalue to succeeded + artifactKey", async () => {
    const reader = createBullmqJobReader(
      { host: "unused", port: 0 },
      {
        queue: fakeQueue({
          [id]: fakeJob("completed", {
            returnvalue: {
              status: "succeeded",
              artifactKey: `artifacts/${id}.pdf`,
              pdfByteLength: 1234,
            },
          }),
        }),
      },
    );
    expect(await reader.get(id)).toEqual({
      id,
      status: "succeeded",
      artifactKey: `artifacts/${id}.pdf`,
    });
  });

  it("degrades completed with a corrupt returnvalue to failed COMPILE_FAILED", async () => {
    const reader = createBullmqJobReader(
      { host: "unused", port: 0 },
      {
        queue: fakeQueue({
          [id]: fakeJob("completed", {
            returnvalue: { status: "succeeded" }, // missing artifactKey
          }),
        }),
      },
    );
    expect(await reader.get(id)).toEqual({
      id,
      status: "failed",
      error: "COMPILE_FAILED",
    });
  });

  it("passes through a safe failure code from failedReason", async () => {
    const reader = createBullmqJobReader(
      { host: "unused", port: 0 },
      {
        queue: fakeQueue({
          [id]: fakeJob("failed", { failedReason: "UPLOAD_FAILED" }),
        }),
      },
    );
    expect(await reader.get(id)).toEqual({
      id,
      status: "failed",
      error: "UPLOAD_FAILED",
    });
  });

  it("never leaks a raw failedReason — unknown reasons become COMPILE_FAILED", async () => {
    const reader = createBullmqJobReader(
      { host: "unused", port: 0 },
      {
        queue: fakeQueue({
          [id]: fakeJob("failed", {
            failedReason: "ENOMEM: docker killed pid 1234 at /var/run/x",
          }),
        }),
      },
    );
    expect(await reader.get(id)).toEqual({
      id,
      status: "failed",
      error: "COMPILE_FAILED",
    });
  });

  it("returns undefined for a missing job and for the unknown state", async () => {
    const reader = createBullmqJobReader(
      { host: "unused", port: 0 },
      { queue: fakeQueue({ [id]: fakeJob("unknown") }) },
    );
    expect(await reader.get(id)).toBeUndefined();
    expect(await reader.get(randomUUID())).toBeUndefined();
  });
});

describe("buildApp with an injected BullMQ-backed reader", () => {
  it("serves a succeeded job read from queue state with a freshly signed URL", async () => {
    const id = randomUUID();
    const app = buildApp({
      jobs: createBullmqJobReader(
        { host: "unused", port: 0 },
        {
          queue: fakeQueue({
            [id]: fakeJob("completed", {
              returnvalue: {
                status: "succeeded",
                artifactKey: `artifacts/${id}.pdf`,
                pdfByteLength: 10,
              },
            }),
          }),
        },
      ),
      signArtifactUrl: async (key) => `https://s3.example.com/${key}?sig=x`,
    });
    const res = await app.inject({ method: "GET", url: `/jobs/${id}` });
    expect(res.statusCode).toBe(200);
    expect(JobResponseSchema.parse(res.json())).toEqual({
      jobId: id,
      status: "succeeded",
      downloadUrl: `https://s3.example.com/artifacts/${id}.pdf?sig=x`,
    });
  });

  it("404s when the queue has never seen the job", async () => {
    const app = buildApp({
      jobs: createBullmqJobReader(
        { host: "unused", port: 0 },
        { queue: fakeQueue({}) },
      ),
    });
    const res = await app.inject({
      method: "GET",
      url: `/jobs/${randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "JOB_NOT_FOUND" });
  });
});
