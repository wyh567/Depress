"use client";

import {
  CompileTemplateIdSchema,
  type CompileJobCreateRequest,
  type CompileTemplateId,
  type PersistedCompileJobStatus,
} from "@depress/ast";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CompileJobRequestError,
  compileJobClient,
  type CompileJobApiClient,
} from "@/lib/compile-job-client";
import type { DocumentSaveState } from "./editor-area";

export const COMPILE_POLLING_INVALIDATE_EVENT =
  "depress:compile-polling-invalidate";

export const COMPILE_TEMPLATE_OPTIONS = [
  { id: "ieee", label: "IEEE" },
  { id: "elsevier", label: "Elsevier" },
  { id: "gbt7714", label: "GB/T 7714" },
] as const satisfies readonly { id: CompileTemplateId; label: string }[];

const POLL_BASE_DELAY_MS = 750;
const POLL_MAX_DELAY_MS = 3_000;
const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3;
const NONTERMINAL_STATUSES = new Set<PersistedCompileJobStatus>([
  "accepted",
  "queued",
  "processing",
]);

type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

function abortableSleep(
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

interface ActiveRequest {
  generation: number;
  documentId?: string;
  revision?: number;
  jobId?: string;
}

interface CompileControlsProps {
  activeDocumentId?: string;
  activeRevision?: number;
  saveState: DocumentSaveState;
  client?: CompileJobApiClient;
  sleep?: Sleep;
  openDownload?: (url: string) => void;
}

export function CompileControls({
  activeDocumentId,
  activeRevision,
  ...props
}: CompileControlsProps) {
  return (
    <CompileControlsForRevision
      key={`${activeDocumentId ?? "none"}:${activeRevision ?? "none"}`}
      {...(activeDocumentId === undefined ? {} : { activeDocumentId })}
      {...(activeRevision === undefined ? {} : { activeRevision })}
      {...props}
    />
  );
}

function CompileControlsForRevision({
  activeDocumentId,
  activeRevision,
  saveState,
  client = compileJobClient,
  sleep = abortableSleep,
  openDownload = (url) => window.location.assign(url),
}: CompileControlsProps) {
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<CompileTemplateId>("ieee");
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

  const invalidate = useCallback((clear: boolean) => {
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
  }, []);

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
        request.jobId === current.jobId
      );
    },
    [activeDocumentId, activeRevision],
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
            job.revision !== request.revision
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
        activeRevision !== created.revision
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
      if (created.status === "succeeded") return;
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
  }, [
    activeCompileJobId,
    client,
    compileStatus,
    isCurrent,
    openDownload,
  ]);

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="sr-only" htmlFor="compile-template">
        PDF template
      </label>
      <select
        id="compile-template"
        aria-label="PDF template"
        value={selectedTemplateId}
        onChange={(event) => {
          const parsed = CompileTemplateIdSchema.safeParse(
            event.currentTarget.value,
          );
          if (parsed.success) setSelectedTemplateId(parsed.data);
        }}
      >
        {COMPILE_TEMPLATE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="button" disabled={!canCompile} onClick={() => void submit()}>
        {submitting ? "Submitting\u2026" : polling ? "Compiling\u2026" : "Compile"}
      </button>
      {needsSave && (
        <p role="status" className="text-xs text-amber-700">
          Save the document before compiling
        </p>
      )}
      {compileStatus && (
        <p role="status" className="text-xs text-gray-600">
          Compile status: {compileStatus}
        </p>
      )}
      {compileStatus === "succeeded" && activeCompileJobId && (
        <button type="button" onClick={() => void download()}>
          Download PDF
        </button>
      )}
      {compileError && (
        <p role="alert" className="text-xs text-red-700">
          {compileError}
        </p>
      )}
    </div>
  );
}
