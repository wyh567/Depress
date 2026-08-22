"use client";

import type {
  CompileJobCreateRequest,
  CompileTemplateId,
  PersistedCompileJobResource,
  PersistedCompileJobStatus,
} from "@depress/ast";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CompileJobRequestError,
  type CompileJobApiClient,
} from "@/lib/compile-job-client";
import type { DocumentSaveState } from "./editor-area";
import {
  clearCompileSessionJobId,
  readCompileSessionJobId,
  writeCompileSessionJobId,
  type CompileSessionIdentity,
} from "./compile-session-storage";

// T-06 Slice 7A: the revision-scoped compile state machine extracted out of
// `compile-controls.tsx`'s `CompileControlsForRevision`, mechanically and
// with zero behavior change (state, refs, effects, and callbacks moved
// as-is). This hook must remain invoked from INSIDE that same
// `key={documentId:revision}`-keyed component — the key remount is still
// what resets/cleans up this hook's state and refs on document or revision
// change; nothing here replicates that reset independently. Hoisting this
// hook above the keyed boundary so it survives a document/revision change
// on its own is a separate, not-yet-approved architecture change (T-06
// Slice 7B).
export const COMPILE_POLLING_INVALIDATE_EVENT =
  "depress:compile-polling-invalidate";

const POLL_BASE_DELAY_MS = 750;
const POLL_MAX_DELAY_MS = 3_000;
const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3;
const NONTERMINAL_STATUSES = new Set<PersistedCompileJobStatus>([
  "accepted",
  "queued",
  "processing",
]);

export type Sleep = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

export function abortableSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function safeMessage(error: unknown): string {
  return error instanceof CompileJobRequestError
    ? error.message
    : "The compile service is unavailable. Try again.";
}

// T-07 (P2-04): the only thing ever written down about a finished compile is
// its job id, filed under the exact identity it belongs to. Nothing is trusted
// on the way back in -- see the rehydration effect below.
function rememberSucceededJob(job: PersistedCompileJobResource): void {
  if (job.status !== "succeeded" || job.format !== "pdf") return;
  writeCompileSessionJobId(
    {
      documentId: job.documentId,
      revision: job.revision,
      templateId: job.templateId,
      format: "pdf",
    },
    job.jobId,
  );
}

interface ActiveRequest {
  generation: number;
  documentId?: string;
  revision?: number;
  // T-07 (P1-01): templateId is part of a compile job's identity, so it has to
  // be part of the request identity too. Without it a job created under one
  // template stayed "current" after the template changed, which is exactly what
  // kept a stale artifact pollable and downloadable.
  templateId?: CompileTemplateId;
  jobId?: string;
}

export interface UseCompileJobSessionParams {
  activeDocumentId?: string;
  activeRevision?: number;
  saveState: DocumentSaveState;
  selectedTemplateId: CompileTemplateId;
  setSelectedTemplateId: (templateId: CompileTemplateId) => void;
  client: CompileJobApiClient;
  sleep: Sleep;
  openDownload: (url: string) => void;
}

export interface UseCompileJobSessionResult {
  activeCompileJobId: string | undefined;
  compileStatus: PersistedCompileJobStatus | undefined;
  compileError: string | undefined;
  submitting: boolean;
  polling: boolean;
  canCompile: boolean;
  needsSave: boolean;
  submit: () => Promise<void>;
  download: () => Promise<void>;
}

export function useCompileJobSession({
  activeDocumentId,
  activeRevision,
  saveState,
  selectedTemplateId,
  setSelectedTemplateId,
  client,
  sleep,
  openDownload,
}: UseCompileJobSessionParams): UseCompileJobSessionResult {
  const [activeCompileJobId, setActiveCompileJobId] = useState<string>();
  const [compileStatus, setCompileStatus] =
    useState<PersistedCompileJobStatus>();
  const [compileError, setCompileError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const activeRequest = useRef<ActiveRequest>({ generation: 0 });
  const submissionLocked = useRef(false);

  const invalidate = useCallback(
    (clear: boolean) => {
      generation.current += 1;
      controller.current?.abort();
      controller.current = undefined;
      activeRequest.current = { generation: generation.current };
      submissionLocked.current = false;
      if (clear) {
        setSelectedTemplateId("ieee");
        setActiveCompileJobId(undefined);
        setCompileStatus(undefined);
        setCompileError(undefined);
        setSubmitting(false);
        setPolling(false);
      }
    },
    [setSelectedTemplateId],
  );

  useEffect(() => {
    const onLogout = () => invalidate(true);
    window.addEventListener(COMPILE_POLLING_INVALIDATE_EVENT, onLogout);
    return () => {
      window.removeEventListener(COMPILE_POLLING_INVALIDATE_EVENT, onLogout);
      invalidate(false);
    };
  }, [invalidate]);

  const isCurrent = useCallback(
    (request: ActiveRequest) => {
      const current = activeRequest.current;
      return (
        request.generation === generation.current &&
        request.generation === current.generation &&
        request.documentId === activeDocumentId &&
        request.revision === activeRevision &&
        request.templateId === selectedTemplateId &&
        request.jobId === current.jobId
      );
    },
    [activeDocumentId, activeRevision, selectedTemplateId],
  );

  const poll = useCallback(
    async (request: Required<ActiveRequest>, signal: AbortSignal) => {
      let consecutiveTransportFailures = 0;
      while (!signal.aborted && isCurrent(request)) {
        const delay = Math.min(
          POLL_BASE_DELAY_MS * 2 ** consecutiveTransportFailures,
          POLL_MAX_DELAY_MS,
        );
        try {
          await sleep(delay, signal);
          if (signal.aborted || !isCurrent(request)) return;
          const job = await client.getCompileJob(request.jobId, signal);
          if (signal.aborted || !isCurrent(request)) return;
          if (
            job.jobId !== request.jobId ||
            job.documentId !== request.documentId ||
            job.revision !== request.revision ||
            job.templateId !== request.templateId
          ) {
            setCompileError("The compile service returned an invalid job.");
            setPolling(false);
            return;
          }
          consecutiveTransportFailures = 0;
          setCompileStatus(job.status);
          if (job.status === "failed") {
            setCompileError("PDF compilation failed. Try compiling again.");
            setPolling(false);
            return;
          }
          if (job.status === "succeeded") {
            setCompileError(undefined);
            setPolling(false);
            rememberSucceededJob(job);
            return;
          }
        } catch (error) {
          if (signal.aborted || !isCurrent(request) || isAbort(error)) return;
          consecutiveTransportFailures += 1;
          if (
            consecutiveTransportFailures >=
            MAX_CONSECUTIVE_TRANSPORT_FAILURES
          ) {
            setCompileError(
              "Compile status is temporarily unavailable. Reload the document to check again.",
            );
            setPolling(false);
            return;
          }
        }
      }
    },
    [client, isCurrent, sleep],
  );

  const nonterminalJob =
    compileStatus !== undefined && NONTERMINAL_STATUSES.has(compileStatus);
  const canCompile =
    activeDocumentId !== undefined &&
    activeRevision !== undefined &&
    saveState === "saved" &&
    !submitting &&
    !nonterminalJob;
  const needsSave =
    activeDocumentId !== undefined &&
    (saveState === "dirty" ||
      saveState === "saving" ||
      saveState === "failed" ||
      saveState === "conflict");

  const submit = useCallback(async () => {
    if (
      submissionLocked.current ||
      !activeDocumentId ||
      activeRevision === undefined ||
      saveState !== "saved" ||
      nonterminalJob
    ) {
      return;
    }
    submissionLocked.current = true;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const request: CompileJobCreateRequest = {
      documentId: activeDocumentId,
      revision: activeRevision,
      templateId: selectedTemplateId,
      format: "pdf",
    };
    const requestGeneration = ++generation.current;
    const requestIdentity: ActiveRequest = {
      generation: requestGeneration,
      documentId: activeDocumentId,
      revision: activeRevision,
      templateId: selectedTemplateId,
    };
    activeRequest.current = requestIdentity;
    setActiveCompileJobId(undefined);
    setCompileStatus(undefined);
    setCompileError(undefined);
    setSubmitting(true);
    setPolling(false);
    try {
      const created = await client.createCompileJob(
        request,
        nextController.signal,
      );
      if (
        nextController.signal.aborted ||
        requestGeneration !== generation.current ||
        activeRequest.current.generation !== requestGeneration ||
        activeDocumentId !== created.documentId ||
        activeRevision !== created.revision ||
        selectedTemplateId !== created.templateId
      ) {
        return;
      }
      const persistedRequest = {
        ...requestIdentity,
        jobId: created.jobId,
      } as Required<ActiveRequest>;
      activeRequest.current = persistedRequest;
      setActiveCompileJobId(created.jobId);
      setCompileStatus(created.status);
      setSubmitting(false);
      submissionLocked.current = false;
      if (created.status === "failed") {
        setCompileError("PDF compilation failed. Try compiling again.");
        return;
      }
      if (created.status === "succeeded") {
        rememberSucceededJob(created);
        return;
      }
      setPolling(true);
      void poll(persistedRequest, nextController.signal);
    } catch (error) {
      if (
        nextController.signal.aborted ||
        requestGeneration !== generation.current ||
        isAbort(error)
      ) {
        return;
      }
      setCompileError(safeMessage(error));
      setSubmitting(false);
      submissionLocked.current = false;
    }
  }, [
    activeDocumentId,
    activeRevision,
    client,
    nonterminalJob,
    poll,
    saveState,
    selectedTemplateId,
  ]);

  // T-07 (P2-04): restore the most recent succeeded output for exactly this
  // paper + revision + template + format when the session mounts, so a reload
  // no longer reports "No PDF output for this revision yet" for work the server
  // has already finished. Only an opaque job id was ever stored: the job itself
  // is re-read through the owner-authorized API and every identity field is
  // re-checked below, so an entry belonging to another template, revision, or
  // paper can never be adopted -- it is dropped and the entry is cleared.
  useEffect(() => {
    if (activeDocumentId === undefined || activeRevision === undefined) return;
    const identity: CompileSessionIdentity = {
      documentId: activeDocumentId,
      revision: activeRevision,
      templateId: selectedTemplateId,
      format: "pdf",
    };
    const storedJobId = readCompileSessionJobId(identity);
    if (storedJobId === undefined) return;
    const rehydrationGeneration = ++generation.current;
    const rehydrationController = new AbortController();
    controller.current?.abort();
    controller.current = rehydrationController;
    activeRequest.current = {
      generation: rehydrationGeneration,
      documentId: identity.documentId,
      revision: identity.revision,
      templateId: identity.templateId,
      jobId: storedJobId,
    };
    const abandon = () => {
      if (rehydrationGeneration !== generation.current) return;
      activeRequest.current = { generation: rehydrationGeneration };
    };
    void (async () => {
      try {
        const restored = await client.getCompileJob(
          storedJobId,
          rehydrationController.signal,
        );
        if (rehydrationController.signal.aborted) return;
        if (rehydrationGeneration !== generation.current) return;
        if (
          restored.jobId !== storedJobId ||
          restored.documentId !== identity.documentId ||
          restored.revision !== identity.revision ||
          restored.templateId !== identity.templateId ||
          restored.format !== identity.format ||
          restored.status !== "succeeded"
        ) {
          clearCompileSessionJobId(identity);
          abandon();
          return;
        }
        setActiveCompileJobId(restored.jobId);
        setCompileStatus(restored.status);
        setCompileError(undefined);
      } catch {
        // A transport failure only means there is no restored output this
        // time. The entry is left alone so a later mount can try again.
        if (!rehydrationController.signal.aborted) abandon();
      }
    })();
    return () => {
      rehydrationController.abort();
    };
  }, [activeDocumentId, activeRevision, selectedTemplateId, client]);

  const download = useCallback(async () => {
    if (compileStatus !== "succeeded" || !activeCompileJobId) return;
    const request = activeRequest.current;
    const signal = controller.current?.signal;
    if (!signal || !isCurrent(request)) return;
    try {
      const signedUrl = await client.getCompileDownload(
        activeCompileJobId,
        signal,
      );
      if (signal.aborted || !isCurrent(request)) return;
      openDownload(signedUrl);
      setCompileError(undefined);
    } catch (error) {
      if (signal.aborted || !isCurrent(request) || isAbort(error)) return;
      setCompileError(safeMessage(error));
    }
  }, [activeCompileJobId, client, compileStatus, isCurrent, openDownload]);

  return {
    activeCompileJobId,
    compileStatus,
    compileError,
    submitting,
    polling,
    canCompile,
    needsSave,
    submit,
    download,
  };
}
