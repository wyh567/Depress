import {
  CompileJobCreateRequestSchema,
  CompileJobDownloadResponseSchema,
  PersistedCompileJobResourceSchema,
  type CompileJobCreateRequest,
  type PersistedCompileJobResource,
} from "@depress/ast";

export class CompileJobRequestError extends Error {
  constructor(message = "The compile service is unavailable. Try again.") {
    super(message);
    this.name = "CompileJobRequestError";
  }
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new CompileJobRequestError();
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CompileJobRequestError();
  }
}

function safeError(response: Response): CompileJobRequestError {
  if (response.status === 401 || response.status === 403) {
    return new CompileJobRequestError("Your session has ended. Sign in and try again.");
  }
  if (response.status === 404) {
    return new CompileJobRequestError("The compile job is no longer available.");
  }
  if (response.status === 409) {
    return new CompileJobRequestError(
      "The saved document revision changed. Save and compile again.",
    );
  }
  return new CompileJobRequestError();
}

export async function createCompileJob(
  value: CompileJobCreateRequest,
  signal?: AbortSignal,
): Promise<PersistedCompileJobResource> {
  const body = CompileJobCreateRequestSchema.safeParse(value);
  if (!body.success) throw new CompileJobRequestError("Unable to compile this document.");
  const response = await request("/api/compile-jobs", {
    method: "POST",
    body: JSON.stringify(body.data),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw safeError(response);
  const parsed = PersistedCompileJobResourceSchema.safeParse(
    await readJson(response),
  );
  if (!parsed.success) throw new CompileJobRequestError();
  return parsed.data;
}

export async function getCompileJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<PersistedCompileJobResource> {
  const parsedJobId = PersistedCompileJobResourceSchema.shape.jobId.safeParse(jobId);
  if (!parsedJobId.success) throw new CompileJobRequestError();
  const response = await request(
    `/api/compile-jobs/${encodeURIComponent(parsedJobId.data)}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) throw safeError(response);
  const parsed = PersistedCompileJobResourceSchema.safeParse(
    await readJson(response),
  );
  if (!parsed.success) throw new CompileJobRequestError();
  return parsed.data;
}

export async function getCompileDownload(
  jobId: string,
  signal?: AbortSignal,
): Promise<string> {
  const parsedJobId = PersistedCompileJobResourceSchema.shape.jobId.safeParse(jobId);
  if (!parsedJobId.success) throw new CompileJobRequestError();
  const response = await request(
    `/api/compile-jobs/${encodeURIComponent(parsedJobId.data)}/download`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) throw safeError(response);
  const parsed = CompileJobDownloadResponseSchema.safeParse(
    await readJson(response),
  );
  if (!parsed.success) throw new CompileJobRequestError();
  return parsed.data.downloadUrl;
}

export interface CompileJobApiClient {
  createCompileJob: typeof createCompileJob;
  getCompileJob: typeof getCompileJob;
  getCompileDownload: typeof getCompileDownload;
}

export const compileJobClient: CompileJobApiClient = {
  createCompileJob,
  getCompileJob,
  getCompileDownload,
};
