export type CompileUiStatus = "accepted" | "queued" | "processing" | "succeeded" | "failed";

export const BACKEND_PROCESSING_PROOF =
  "succeeded transition is conditional on prior processing ownership";

export interface CompileStatusObservation {
  jobId: string;
  template: string;
  uiObservedStatuses: CompileUiStatus[];
  processingUiObserved: boolean;
  terminalUiStatus?: "succeeded" | "failed";
  apiTerminalStatus?: "succeeded" | "failed";
  backendProcessingProof: typeof BACKEND_PROCESSING_PROOF;
}

export interface SuccessfulCompileValidation {
  expectedJobId: string;
  apiJobId: string;
  expectedDocumentId: unknown;
  apiDocumentId: unknown;
  expectedRevision: unknown;
  apiRevision: unknown;
  apiTerminalStatus: unknown;
  downloadAvailable: boolean;
  timedOut: boolean;
}

export function createCompileStatusObservation(
  jobId: string,
  template: string
): CompileStatusObservation {
  return {
    jobId,
    template,
    uiObservedStatuses: [],
    processingUiObserved: false,
    backendProcessingProof: BACKEND_PROCESSING_PROOF,
  };
}

export function parseCompileUiStatus(text: string | null): CompileUiStatus | undefined {
  const match = /^Compile status: (accepted|queued|processing|succeeded|failed)$/u.exec(
    text?.trim() ?? ""
  );
  return match?.[1] as CompileUiStatus | undefined;
}

export function observeCompileUiStatus(
  observation: CompileStatusObservation,
  status: CompileUiStatus
): void {
  const currentTerminal = observation.terminalUiStatus;
  if (currentTerminal && currentTerminal !== status) {
    throw new Error(`compile UI changed after terminal status ${currentTerminal}`);
  }
  if (observation.uiObservedStatuses.at(-1) !== status) {
    observation.uiObservedStatuses.push(status);
  }
  if (status === "processing") observation.processingUiObserved = true;
  if (status === "succeeded" || status === "failed") {
    observation.terminalUiStatus = status;
  }
}

export function validateSuccessfulCompileObservation(
  observation: CompileStatusObservation,
  validation: SuccessfulCompileValidation
): CompileStatusObservation {
  if (validation.timedOut) throw new Error("compile UI timed out before succeeded");
  if (validation.expectedJobId !== validation.apiJobId) {
    throw new Error("compile API returned a different job ID");
  }
  if (validation.expectedDocumentId !== validation.apiDocumentId) {
    throw new Error("compile API returned a different document ID");
  }
  if (validation.expectedRevision !== validation.apiRevision) {
    throw new Error("compile API returned a different revision");
  }

  const acceptedIndex = observation.uiObservedStatuses.indexOf("accepted");
  const queuedIndex = observation.uiObservedStatuses.indexOf("queued");
  const processingIndex = observation.uiObservedStatuses.indexOf("processing");
  const succeededIndex = observation.uiObservedStatuses.indexOf("succeeded");
  if (acceptedIndex < 0 || queuedIndex <= acceptedIndex) {
    throw new Error("successful compile did not visibly reach queued after accepted");
  }
  if (succeededIndex <= queuedIndex || observation.terminalUiStatus !== "succeeded") {
    throw new Error("successful compile did not visibly reach succeeded after queued");
  }
  if (
    processingIndex >= 0 &&
    (processingIndex <= queuedIndex || processingIndex >= succeededIndex)
  ) {
    throw new Error("observed processing status was outside the queued-to-succeeded interval");
  }
  if (observation.uiObservedStatuses.includes("failed")) {
    throw new Error("failed status cannot satisfy a successful compile");
  }
  if (validation.apiTerminalStatus !== "succeeded") {
    throw new Error("compile API did not confirm succeeded");
  }
  if (!validation.downloadAvailable) {
    throw new Error("succeeded compile did not expose Download PDF");
  }

  observation.apiTerminalStatus = "succeeded";
  return observation;
}
