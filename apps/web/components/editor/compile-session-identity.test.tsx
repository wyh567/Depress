// @vitest-environment jsdom
import type {
  CompileJobCreateRequest,
  PersistedCompileJobResource,
  PersistedCompileJobStatus,
} from "@depress/ast";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompileJobApiClient } from "@/lib/compile-job-client";
import { CompileControls } from "./compile-controls";
import {
  compileSessionStorageKey,
  writeCompileSessionJobId,
  type CompileSessionIdentity,
} from "./compile-session-storage";

const DOCUMENT_A = "39e35789-2e60-4d40-840a-ef10cf05fab7";
const DOCUMENT_B = "e58dc609-e84d-4f0d-aa61-8c014edecf40";
const JOB_IEEE = "33dcf023-2a4f-4d3a-9b27-00e907f34b83";
const JOB_GBT = "1c046c5c-eeac-4c6c-bda4-793158001848";
const IEEE_AT_7: CompileSessionIdentity = {
  documentId: DOCUMENT_A,
  revision: 7,
  templateId: "ieee",
  format: "pdf",
};

function job(
  status: PersistedCompileJobStatus,
  overrides: Partial<PersistedCompileJobResource> = {},
): PersistedCompileJobResource {
  return {
    jobId: JOB_IEEE,
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

// A faithful fake: the server always answers with a job for the template that
// was actually requested.
function echoingCreate() {
  return vi.fn((request: CompileJobCreateRequest) =>
    Promise.resolve(
      job("succeeded", {
        jobId: request.templateId === "ieee" ? JOB_IEEE : JOB_GBT,
        documentId: request.documentId,
        revision: request.revision,
        templateId: request.templateId,
      }),
    ),
  );
}

function clientWith(
  overrides: Partial<CompileJobApiClient> = {},
): CompileJobApiClient {
  return {
    createCompileJob: echoingCreate(),
    getCompileJob: vi.fn().mockResolvedValue(job("succeeded")),
    getCompileDownload: vi
      .fn()
      .mockResolvedValue("https://download.example.test/signed"),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function selectTemplate(templateId: string): void {
  fireEvent.change(screen.getByLabelText("PDF template"), {
    target: { value: templateId },
  });
}

describe("compile session identity", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops a succeeded GB/T result the moment the template changes", async () => {
    const getCompileDownload = vi
      .fn()
      .mockResolvedValue("https://download.example.test/gbt");
    const client = clientWith({ getCompileDownload });
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={client}
      />,
    );

    selectTemplate("gbt7714");
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    expect(screen.getByText("Compile status: succeeded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeVisible();

    selectTemplate("ieee");
    await flush();

    expect(screen.getByLabelText("PDF template")).toHaveValue("ieee");
    expect(screen.queryByText(/Compile status:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(getCompileDownload).not.toHaveBeenCalled();
  });

  it("compiles the newly selected template and reports that job as the result", async () => {
    const createCompileJob = echoingCreate();
    const getCompileDownload = vi
      .fn()
      .mockResolvedValue("https://download.example.test/ieee");
    const openDownload = vi.fn();
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith({ createCompileJob, getCompileDownload })}
        openDownload={openDownload}
      />,
    );

    selectTemplate("gbt7714");
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    selectTemplate("ieee");
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();

    expect(createCompileJob).toHaveBeenLastCalledWith(
      {
        documentId: DOCUMENT_A,
        revision: 7,
        templateId: "ieee",
        format: "pdf",
      },
      expect.any(AbortSignal),
    );

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await flush();
    expect(getCompileDownload).toHaveBeenCalledWith(
      JOB_IEEE,
      expect.any(AbortSignal),
    );
    expect(openDownload).toHaveBeenCalledWith(
      "https://download.example.test/ieee",
    );
  });

  it("restores a succeeded result for the same paper, revision and template", async () => {
    writeCompileSessionJobId(IEEE_AT_7, JOB_IEEE);
    const getCompileJob = vi.fn().mockResolvedValue(job("succeeded"));
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith({ getCompileJob })}
      />,
    );
    await flush();

    expect(getCompileJob).toHaveBeenCalledWith(
      JOB_IEEE,
      expect.any(AbortSignal),
    );
    expect(screen.getByText("Compile status: succeeded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeVisible();
  });

  it("refuses a restored job whose template does not match, and forgets it", async () => {
    writeCompileSessionJobId(IEEE_AT_7, JOB_GBT);
    const getCompileJob = vi
      .fn()
      .mockResolvedValue(
        job("succeeded", { jobId: JOB_GBT, templateId: "gbt7714" }),
      );
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith({ getCompileJob })}
      />,
    );
    await flush();

    expect(getCompileJob).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(
      sessionStorage.getItem(compileSessionStorageKey(IEEE_AT_7)),
    ).toBeNull();
  });

  it("refuses a restored job whose format does not match, and forgets it", async () => {
    writeCompileSessionJobId(IEEE_AT_7, JOB_IEEE);
    const getCompileJob = vi
      .fn()
      .mockResolvedValue(
        job("succeeded", {
          format: "docx" as unknown as PersistedCompileJobResource["format"],
        }),
      );
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith({ getCompileJob })}
      />,
    );
    await flush();

    expect(getCompileJob).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(
      sessionStorage.getItem(compileSessionStorageKey(IEEE_AT_7)),
    ).toBeNull();
  });

  it("refuses a restored job whose revision does not match, and forgets it", async () => {
    writeCompileSessionJobId(IEEE_AT_7, JOB_IEEE);
    const getCompileJob = vi
      .fn()
      .mockResolvedValue(job("succeeded", { revision: 8 }));
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith({ getCompileJob })}
      />,
    );
    await flush();

    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(
      sessionStorage.getItem(compileSessionStorageKey(IEEE_AT_7)),
    ).toBeNull();
  });

  it("refuses a restored job that belongs to another paper, and forgets it", async () => {
    writeCompileSessionJobId(IEEE_AT_7, JOB_IEEE);
    const getCompileJob = vi
      .fn()
      .mockResolvedValue(job("succeeded", { documentId: DOCUMENT_B }));
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith({ getCompileJob })}
      />,
    );
    await flush();

    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(
      sessionStorage.getItem(compileSessionStorageKey(IEEE_AT_7)),
    ).toBeNull();
  });

  it("never even looks up an entry filed under a different identity", async () => {
    writeCompileSessionJobId({ ...IEEE_AT_7, revision: 8 }, JOB_IEEE);
    writeCompileSessionJobId({ ...IEEE_AT_7, templateId: "gbt7714" }, JOB_GBT);
    writeCompileSessionJobId({ ...IEEE_AT_7, documentId: DOCUMENT_B }, JOB_IEEE);
    const getCompileJob = vi.fn();
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith({ getCompileJob })}
      />,
    );
    await flush();

    expect(getCompileJob).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
  });

  it("remembers only the job id, never the signed download URL", async () => {
    const openDownload = vi.fn();
    render(
      <CompileControls
        activeDocumentId={DOCUMENT_A}
        activeRevision={7}
        saveState="saved"
        client={clientWith()}
        openDownload={openDownload}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compile" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await flush();

    expect(openDownload).toHaveBeenCalledWith(
      "https://download.example.test/signed",
    );
    expect(sessionStorage.getItem(compileSessionStorageKey(IEEE_AT_7))).toBe(
      JOB_IEEE,
    );
    const persisted = Object.keys(sessionStorage).map((key) =>
      sessionStorage.getItem(key),
    );
    expect(persisted).toEqual([JOB_IEEE]);
    expect(localStorage.length).toBe(0);
  });
});
