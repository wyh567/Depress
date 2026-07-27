// @vitest-environment jsdom
import {
  type CompileJobCreateRequest,
  type PersistedCompileJobResource,
  type PersistedCompileJobStatus,
} from "@depress/ast";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CompileJobRequestError,
  type CompileJobApiClient,
} from "@/lib/compile-job-client";
import {
  COMPILE_POLLING_INVALIDATE_EVENT,
  CompileControls,
} from "./compile-controls";

const DOCUMENT_A = "39e35789-2e60-4d40-840a-ef10cf05fab7";
const DOCUMENT_B = "e58dc609-e84d-4f0d-aa61-8c014edecf40";
const JOB_A = "33dcf023-2a4f-4d3a-9b27-00e907f34b83";
const JOB_B = "1c046c5c-eeac-4c6c-bda4-793158001848";

function job(
  status: PersistedCompileJobStatus,
  overrides: Partial<PersistedCompileJobResource> = {},
): PersistedCompileJobResource {
  return {
    jobId: JOB_A,
    documentId: DOCUMENT_A,
    revision: 7,
    templateId: "ieee",
    format: "pdf",
    snapshotHash: "a".repeat(64),
    status,
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
    ...overrides,
  };
}

function clientWith(
  overrides: Partial<CompileJobApiClient> = {},
): CompileJobApiClient {
  return {
    createCompileJob: vi.fn().mockResolvedValue(job("accepted")),
    getCompileJob: vi.fn().mockResolvedValue(job("succeeded")),
    getCompileDownload: vi
      .fn()
      .mockResolvedValue("https://download.example.test/signed"),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("persisted compile controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("offers exactly three fixed templates and blocks dirty revisions", async () => {
    const client = clientWith();
    const view = render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="dirty"
        client={client}
      />,
    );

    expect(
      screen.getAllByRole("option").map((option) => ({
        label: option.textContent,
        value: (option as HTMLOptionElement).value,
      })),
    ).toEqual([
      { label: "IEEE", value: "ieee" },
      { label: "Elsevier", value: "elsevier" },
      { label: "GB/T 7714", value: "gbt7714" },
    ]);
    expect(screen.getByText("Save the document before compiling")).toBeVisible();
    expect(screen.getByRole("button", { name: "Compile" })).toBeDisabled();

    view.rerender(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={client}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    expect(client.createCompileJob).toHaveBeenCalledWith(
      {
        documentId: DOCUMENT_A,
        revision: 7,
        templateId: "ieee",
        format: "pdf",
      },
      expect.any(AbortSignal),
    );
  });

  it("never calls legacy /compile from the authenticated compile flow", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(job("succeeded")), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/compile-jobs");
    expect(fetchMock.mock.calls.some(([path]) => path === "/compile")).toBe(
      false,
    );
    vi.unstubAllGlobals();
  });

  it("displays accepted, queued, processing, and succeeded in order", async () => {
    const getCompileJob = vi
      .fn()
      .mockResolvedValueOnce(job("queued"))
      .mockResolvedValueOnce(job("processing"))
      .mockResolvedValueOnce(job("succeeded"));
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith({ getCompileJob })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    expect(screen.getByText("Compile status: accepted")).toBeVisible();

    await act(() => vi.advanceTimersByTimeAsync(750));
    expect(screen.getByText("Compile status: queued")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(750));
    expect(screen.getByText("Compile status: processing")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(750));
    expect(screen.getByText("Compile status: succeeded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
    expect(getCompileJob).toHaveBeenCalledTimes(3);
  });

  it("shows a safe terminal failure and permits the next compile", async () => {
    const client = clientWith({
      getCompileJob: vi.fn().mockResolvedValue(job("failed")),
    });
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={client}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    await act(() => vi.advanceTimersByTimeAsync(750));

    expect(screen.getByText("Compile status: failed")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "PDF compilation failed",
    );
    expect(screen.getByRole("button", { name: "Compile" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(client.getCompileDownload).not.toHaveBeenCalled();
  });

  it("blocks duplicate submission and snapshots a template for only that job", async () => {
    const pollA = deferred<PersistedCompileJobResource>();
    const createCompileJob = vi
      .fn()
      .mockResolvedValueOnce(job("accepted"))
      .mockResolvedValueOnce(
        job("succeeded", {
          jobId: JOB_B,
          templateId: "elsevier",
        }),
      );
    const client = clientWith({
      createCompileJob,
      getCompileJob: vi.fn(() => pollA.promise),
    });
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={client}
      />,
    );
    const compile = screen.getByRole("button", { name: "Compile" });
    act(() => {
      compile.click();
      compile.click();
    });
    await flush();
    expect(createCompileJob).toHaveBeenCalledTimes(1);
    expect(
      (createCompileJob.mock.calls[0]?.[0] as CompileJobCreateRequest)
        .templateId,
    ).toBe("ieee");

    fireEvent.change(screen.getByLabelText("PDF template"), {
      target: { value: "elsevier" },
    });
    await act(() => vi.advanceTimersByTimeAsync(750));
    await act(async () => {
      pollA.resolve(job("succeeded"));
      await pollA.promise;
    });
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    expect(createCompileJob).toHaveBeenCalledTimes(2);
    expect(
      (createCompileJob.mock.calls[1]?.[0] as CompileJobCreateRequest)
        .templateId,
    ).toBe("elsevier");
  });

  it("ignores an old poll after a document switch and clears old download UI", async () => {
    const oldPoll = deferred<PersistedCompileJobResource>();
    const client = clientWith({
      getCompileJob: vi.fn(() => oldPoll.promise),
    });
    const view = render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={client}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    await act(() => vi.advanceTimersByTimeAsync(750));
    view.rerender(
      <CompileControls
        activeDocumentId={DOCUMENT_B}
        activeRevision={2}
        saveState="saved"
        client={client}
      />,
    );
    await flush();
    await act(async () => {
      oldPoll.resolve(job("succeeded"));
      await oldPoll.promise;
    });

    expect(screen.queryByText(/Compile status:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
  });

  it("ignores a stale failure after a newer document starts a job", async () => {
    const oldCreate = deferred<PersistedCompileJobResource>();
    const createCompileJob = vi
      .fn()
      .mockImplementationOnce(() => oldCreate.promise)
      .mockResolvedValueOnce(
        job("succeeded", {
          jobId: JOB_B,
          documentId: DOCUMENT_B,
          revision: 2,
        }),
      );
    const client = clientWith({ createCompileJob });
    const view = render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={client}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    view.rerender(
      <CompileControls
        activeDocumentId={DOCUMENT_B}
        activeRevision={2}
        saveState="saved"
        client={client}
      />,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    expect(screen.getByText("Compile status: succeeded")).toBeVisible();

    await act(async () => {
      oldCreate.reject(new Error("internal artifact key"));
      await expect(oldCreate.promise).rejects.toThrow();
    });
    expect(screen.getByText("Compile status: succeeded")).toBeVisible();
    expect(screen.queryByText(/artifact key/)).toBeNull();
  });

  it("aborts and ignores polling on logout and unmount", async () => {
    const requests: AbortSignal[] = [];
    const getCompileJob = vi.fn(
      (_jobId: string, signal?: AbortSignal) =>
        new Promise<PersistedCompileJobResource>((resolve) => {
          if (signal) requests.push(signal);
          void resolve;
        }),
    );
    const client = clientWith({ getCompileJob });
    const first = render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={client}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    await act(() => vi.advanceTimersByTimeAsync(750));
    window.dispatchEvent(new Event(COMPILE_POLLING_INVALIDATE_EVENT));
    await flush();
    expect(requests[0]?.aborted).toBe(true);
    expect(screen.queryByText(/Compile status:/)).toBeNull();
    first.unmount();

    const second = render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={client}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    await act(() => vi.advanceTimersByTimeAsync(750));
    second.unmount();
    expect(requests[1]?.aborted).toBe(true);
  });

  it("stops after three consecutive transport failures with bounded backoff", async () => {
    const getCompileJob = vi
      .fn()
      .mockRejectedValue(new CompileJobRequestError());
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith({ getCompileJob })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    await act(() => vi.advanceTimersByTimeAsync(750));
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    await act(() => vi.advanceTimersByTimeAsync(3_000));

    expect(getCompileJob).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Compile status is temporarily unavailable",
    );
  });

  it("uses a signed URL immediately without storing it and retries download failure", async () => {
    const signedUrl = "https://download.example.test/one-time-signed";
    const openDownload = vi.fn();
    const getCompileDownload = vi
      .fn()
      .mockRejectedValueOnce(new CompileJobRequestError())
      .mockResolvedValueOnce(signedUrl);
    const client = clientWith({
      createCompileJob: vi.fn().mockResolvedValue(job("succeeded")),
      getCompileDownload,
    });
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={client}
        openDownload={openDownload}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    const download = screen.getByRole("button", { name: "Download PDF" });

    fireEvent.click(download);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "compile service is unavailable",
    );
    expect(download).toBeEnabled();
    expect(openDownload).not.toHaveBeenCalled();

    fireEvent.click(download);
    await flush();
    expect(openDownload).toHaveBeenCalledWith(signedUrl);
    expect(screen.queryByText(signedUrl)).toBeNull();
    expect(localStorage.getItem("downloadUrl")).toBeNull();
    expect(sessionStorage.getItem("downloadUrl")).toBeNull();
    expect(getCompileDownload).toHaveBeenCalledTimes(2);
  });

  it("never requests a download for pending or failed jobs", async () => {
    const pendingClient = clientWith();
    const pending = render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={pendingClient}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(pendingClient.getCompileDownload).not.toHaveBeenCalled();
    pending.unmount();

    const failedClient = clientWith({
      createCompileJob: vi.fn().mockResolvedValue(job("failed")),
    });
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={failedClient}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(failedClient.getCompileDownload).not.toHaveBeenCalled();
  });
});
