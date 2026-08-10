import { describe, expect, it, vi } from "vitest";
import type { ArtifactCleanupBatchResult } from "./artifact-cleanup-service";
import { runArtifactCleanupCli } from "./artifact-cleanup-main";

const EMPTY_RESULT: ArtifactCleanupBatchResult = {
  claimed: 0,
  deleted: 0,
  failed: 0,
  failures: [],
};

describe("one-shot artifact cleanup CLI", () => {
  it("returns zero for an empty or successful single batch and closes resources", async () => {
    for (const result of [
      EMPTY_RESULT,
      { claimed: 1, deleted: 1, failed: 0, failures: [] },
    ] satisfies ArtifactCleanupBatchResult[]) {
      const runBatch = vi.fn(async () => result);
      const close = vi.fn(async () => undefined);
      const report = vi.fn<(message: string) => void>();

      await expect(
        runArtifactCleanupCli({ runBatch, close, report }),
      ).resolves.toBe(0);

      expect(runBatch).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(
        JSON.stringify({
          claimed: result.claimed,
          deleted: result.deleted,
          failed: result.failed,
        }),
      );
    }
  });

  it("returns nonzero for any claimed artifact failure", async () => {
    const runBatch = vi.fn(async () => ({
      claimed: 2,
      deleted: 1,
      failed: 1,
      failures: [
        {
          jobId: "11111111-1111-4111-8111-111111111111",
          reason: "DELETE_FAILED" as const,
        },
      ],
    }));
    const close = vi.fn(async () => undefined);
    const report = vi.fn<(message: string) => void>();

    await expect(
      runArtifactCleanupCli({ runBatch, close, report }),
    ).resolves.toBe(1);

    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      JSON.stringify({ claimed: 2, deleted: 1, failed: 1 }),
    );
  });

  it("returns nonzero, closes resources, and hides unexpected error details", async () => {
    const runBatch = vi.fn(async (): Promise<ArtifactCleanupBatchResult> => {
      throw new Error("secret endpoint and credentials");
    });
    const close = vi.fn(async () => undefined);
    const report = vi.fn<(message: string) => void>();

    await expect(
      runArtifactCleanupCli({ runBatch, close, report }),
    ).resolves.toBe(1);

    expect(close).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("Artifact cleanup failed");
    expect(report.mock.calls.flat().join(" ")).not.toMatch(
      /endpoint|credentials|secret/i,
    );
  });
});
