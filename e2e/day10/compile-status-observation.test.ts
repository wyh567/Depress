import assert from "node:assert/strict";
import test from "node:test";

import {
  createCompileStatusObservation,
  observeCompileUiStatus,
  validateSuccessfulCompileObservation,
} from "./compile-status-observation.ts";

const jobId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";

function successfulValidation(overrides: Record<string, unknown> = {}) {
  return {
    expectedJobId: jobId,
    apiJobId: jobId,
    expectedDocumentId: documentId,
    apiDocumentId: documentId,
    expectedRevision: 3,
    apiRevision: 3,
    apiTerminalStatus: "succeeded",
    downloadAvailable: true,
    timedOut: false,
    ...overrides,
  };
}

function observe(statuses: Array<"accepted" | "queued" | "processing" | "succeeded" | "failed">) {
  const observation = createCompileStatusObservation(jobId, "ieee");
  for (const status of statuses) observeCompileUiStatus(observation, status);
  return observation;
}

test("accepts accepted -> queued -> processing -> succeeded and records processing", () => {
  const observation = observe(["accepted", "queued", "processing", "succeeded"]);
  validateSuccessfulCompileObservation(observation, successfulValidation());
  assert.deepEqual(observation.uiObservedStatuses, [
    "accepted",
    "queued",
    "processing",
    "succeeded",
  ]);
  assert.equal(observation.processingUiObserved, true);
  assert.equal(observation.terminalUiStatus, "succeeded");
  assert.equal(observation.apiTerminalStatus, "succeeded");
});

test("accepts accepted -> queued -> succeeded without inventing processing", () => {
  const observation = observe(["accepted", "queued", "succeeded"]);
  validateSuccessfulCompileObservation(observation, successfulValidation());
  assert.deepEqual(observation.uiObservedStatuses, ["accepted", "queued", "succeeded"]);
  assert.equal(observation.processingUiObserved, false);
  assert.equal(observation.uiObservedStatuses.includes("processing"), false);
});

test("rejects failed on the successful path", () => {
  const observation = observe(["accepted", "queued", "failed"]);
  assert.throws(
    () => validateSuccessfulCompileObservation(observation, successfulValidation()),
    /succeeded/u
  );
});

test("rejects accepted -> succeeded when queued was not observed", () => {
  const observation = observe(["accepted", "succeeded"]);
  assert.throws(
    () => validateSuccessfulCompileObservation(observation, successfulValidation()),
    /queued/u
  );
});

test("rejects a compile that times out while queued", () => {
  const observation = observe(["accepted", "queued"]);
  assert.throws(
    () =>
      validateSuccessfulCompileObservation(observation, successfulValidation({ timedOut: true })),
    /timed out/u
  );
});

test("rejects an API response for a different job", () => {
  const observation = observe(["accepted", "queued", "succeeded"]);
  assert.throws(
    () =>
      validateSuccessfulCompileObservation(
        observation,
        successfulValidation({ apiJobId: "33333333-3333-4333-8333-333333333333" })
      ),
    /different job ID/u
  );
});

test("rejects succeeded without Download PDF", () => {
  const observation = observe(["accepted", "queued", "succeeded"]);
  assert.throws(
    () =>
      validateSuccessfulCompileObservation(
        observation,
        successfulValidation({ downloadAvailable: false })
      ),
    /Download PDF/u
  );
});
