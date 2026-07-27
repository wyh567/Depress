import {
  type CompileJobCreateRequest,
  type PersistedCompileJobResource,
} from "@depress/ast";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompileJobRequestError,
  createCompileJob,
  getCompileDownload,
  getCompileJob,
} from "@/lib/compile-job-client";

const request: CompileJobCreateRequest = {
  documentId: "39e35789-2e60-4d40-840a-ef10cf05fab7",
  revision: 7,
  templateId: "elsevier",
  format: "pdf",
};

const job: PersistedCompileJobResource = {
  jobId: "33dcf023-2a4f-4d3a-9b27-00e907f34b83",
  ...request,
  snapshotHash: "a".repeat(64),
  status: "accepted",
  createdAt: "2026-07-27T12:00:00.000Z",
  updatedAt: "2026-07-27T12:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("compile job API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates and sends the three same-origin credentialed operations", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(job, 202))
      .mockResolvedValueOnce(jsonResponse({ ...job, status: "queued" }))
      .mockResolvedValueOnce(
        jsonResponse({ downloadUrl: "https://download.example.test/signed" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createCompileJob(request)).resolves.toEqual(job);
    await expect(getCompileJob(job.jobId)).resolves.toMatchObject({
      status: "queued",
    });
    await expect(getCompileDownload(job.jobId)).resolves.toBe(
      "https://download.example.test/signed",
    );

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/compile-jobs",
      `/api/compile-jobs/${job.jobId}`,
      `/api/compile-jobs/${job.jobId}/download`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      request,
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ credentials: "include" });
    }
  });

  it("rejects invalid requests and responses with safe errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ...job, artifactKey: "secret" }, 202))
      .mockResolvedValueOnce(
        jsonResponse({ downloadUrl: "not-a-signed-url" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createCompileJob({ ...request, revision: 0 }),
    ).rejects.toBeInstanceOf(CompileJobRequestError);
    await expect(createCompileJob(request)).rejects.toBeInstanceOf(
      CompileJobRequestError,
    );
    await expect(getCompileDownload(job.jobId)).rejects.toBeInstanceOf(
      CompileJobRequestError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
