import { describe, expect, it, vi } from "vitest";
import type {
  ArtifactCleanupRepository,
  ClaimedArtifact,
} from "./db/artifact-cleanup-repository";
import {
  cleanupExpiredArtifactsOnce,
  type ArtifactCleanupDeleter,
} from "./artifact-cleanup-service";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_TOKEN = "33333333-3333-4333-8333-333333333333";

function claim(jobId: string, artifactKey = `artifacts/${jobId}.pdf`): ClaimedArtifact {
  return {
    jobId,
    artifactKey,
    artifactByteLength: 100,
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    claimToken: CLAIM_TOKEN,
    claimStartedAt: new Date("2026-08-10T00:00:00.000Z"),
  };
}

function repositoryFor(
  claims: ClaimedArtifact[],
  finalize: (jobId: string, token: string) => Promise<boolean> = async () =>
    true,
) {
  const claimExpiredArtifacts = vi.fn(async () => claims);
  const finalizeArtifactDeletion = vi.fn(finalize);
  return {
    repository: {
      claimExpiredArtifacts,
      finalizeArtifactDeletion,
    } as ArtifactCleanupRepository,
    claimExpiredArtifacts,
    finalizeArtifactDeletion,
  };
}

describe("artifact cleanup service", () => {
  it("deletes only exact job keys and reports a mismatched key without touching it", async () => {
    const valid = claim(FIRST_ID);
    const mismatched = claim(
      SECOND_ID,
      `artifacts/${FIRST_ID}.pdf`,
    );
    const { repository, claimExpiredArtifacts, finalizeArtifactDeletion } =
      repositoryFor([valid, mismatched]);
    const deleteArtifact = vi.fn(async () => undefined);

    const result = await cleanupExpiredArtifactsOnce({
      repository,
      artifacts: { deleteArtifact } satisfies ArtifactCleanupDeleter,
    });

    expect(result).toEqual({
      claimed: 2,
      deleted: 1,
      failed: 1,
      failures: [
        { jobId: SECOND_ID, reason: "ARTIFACT_KEY_MISMATCH" },
      ],
    });
    expect(claimExpiredArtifacts).toHaveBeenCalledTimes(1);
    expect(deleteArtifact).toHaveBeenCalledTimes(1);
    expect(deleteArtifact).toHaveBeenCalledWith(`artifacts/${FIRST_ID}.pdf`);
    expect(finalizeArtifactDeletion).toHaveBeenCalledTimes(1);
    expect(finalizeArtifactDeletion).toHaveBeenCalledWith(
      FIRST_ID,
      CLAIM_TOKEN,
    );
  });

  it("continues the claimed batch after a delete failure without finalizing the failed row", async () => {
    const { repository, finalizeArtifactDeletion } = repositoryFor([
      claim(FIRST_ID),
      claim(SECOND_ID),
    ]);
    const deleteArtifact = vi.fn(async (key: string) => {
      if (key === `artifacts/${FIRST_ID}.pdf`) {
        throw new Error("controlled storage outage");
      }
    });

    const result = await cleanupExpiredArtifactsOnce({
      repository,
      artifacts: { deleteArtifact },
    });

    expect(result).toEqual({
      claimed: 2,
      deleted: 1,
      failed: 1,
      failures: [{ jobId: FIRST_ID, reason: "DELETE_FAILED" }],
    });
    expect(deleteArtifact).toHaveBeenCalledTimes(2);
    expect(finalizeArtifactDeletion).toHaveBeenCalledTimes(1);
    expect(finalizeArtifactDeletion).toHaveBeenCalledWith(
      SECOND_ID,
      CLAIM_TOKEN,
    );
  });

  it("reports lost finalize ownership after deletion instead of claiming success", async () => {
    const { repository } = repositoryFor([claim(FIRST_ID)], async () => false);
    const deleteArtifact = vi.fn(async () => undefined);

    const result = await cleanupExpiredArtifactsOnce({
      repository,
      artifacts: { deleteArtifact },
    });

    expect(result).toEqual({
      claimed: 1,
      deleted: 0,
      failed: 1,
      failures: [{ jobId: FIRST_ID, reason: "FINALIZE_FAILED" }],
    });
    expect(deleteArtifact).toHaveBeenCalledTimes(1);
  });

  it("continues after a finalize error so another claimed artifact can complete", async () => {
    const { repository, finalizeArtifactDeletion } = repositoryFor(
      [claim(FIRST_ID), claim(SECOND_ID)],
      async (jobId) => {
        if (jobId === FIRST_ID) throw new Error("controlled database outage");
        return true;
      },
    );
    const deleteArtifact = vi.fn(async () => undefined);

    const result = await cleanupExpiredArtifactsOnce({
      repository,
      artifacts: { deleteArtifact },
    });

    expect(result).toEqual({
      claimed: 2,
      deleted: 1,
      failed: 1,
      failures: [{ jobId: FIRST_ID, reason: "FINALIZE_FAILED" }],
    });
    expect(deleteArtifact).toHaveBeenCalledTimes(2);
    expect(finalizeArtifactDeletion).toHaveBeenCalledTimes(2);
  });
});
