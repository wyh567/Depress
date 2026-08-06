import {
  expect,
  request,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";

import {
  createCompileStatusObservation,
  observeCompileUiStatus,
  parseCompileUiStatus,
  validateSuccessfulCompileObservation,
  type CompileStatusObservation,
} from "./compile-status-observation";

const EXACT_COMMIT = requiredEnv("DAY10_CANDIDATE_SHA");
const externalRoot = "D:\\depress-day10-wsl";
const artifactDir = join(externalRoot, "artifacts");
const testMode = process.env.DAY10_MODE ?? "full";
const runsCoreAcceptance = [
  "diagnose",
  "focused",
  "d10-010",
  "remaining",
  "smoke",
  "full",
].includes(testMode);
const resultFile = join(
  externalRoot,
  testMode === "preflight"
    ? "preflight-results.json"
    : testMode === "single-insertion"
      ? "single-insertion-results.json"
      : testMode === "stability"
        ? "stability-results.json"
        : testMode === "d10-010"
          ? "d10-010-results.json"
          : testMode === "remaining"
            ? "remaining-results.json"
            : testMode === "smoke"
              ? "smoke-results.json"
              : "acceptance-results.json"
);
const controlScript = "/mnt/d/depress/e2e/day10/staging-control.sh";
const IEEE_HEADING_PREFIX = "I)";

function normalizeSemanticHeading(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function extractIeeeSectionHeading(pdfText: string): string {
  const headingLine = pdfText.split(/\r?\n/u).find((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith(`${IEEE_HEADING_PREFIX} `);
  });
  if (!headingLine) {
    throw new Error(
      `PDF text did not contain an IEEE section line beginning with ${IEEE_HEADING_PREFIX}`
    );
  }
  return headingLine.trimStart().slice(IEEE_HEADING_PREFIX.length).trimStart();
}

function expectIeeeSectionHeading(pdfText: string, expectedHeading: string): void {
  expect(normalizeSemanticHeading(extractIeeeSectionHeading(pdfText))).toBe(
    normalizeSemanticHeading(expectedHeading)
  );
}

const mentorA = {
  email: requiredEnv("DAY10_MENTOR_A_EMAIL"),
  password: requiredEnv("DAY10_MENTOR_A_PASSWORD"),
};
const mentorB = {
  email: requiredEnv("DAY10_MENTOR_B_EMAIL"),
  password: requiredEnv("DAY10_MENTOR_B_PASSWORD"),
};
const stabilityUser =
  testMode === "stability"
    ? {
        email: requiredEnv("DAY10_STABILITY_USER_EMAIL"),
        password: requiredEnv("DAY10_STABILITY_USER_PASSWORD"),
      }
    : undefined;

type CapturedStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

let stabilityStorageState: CapturedStorageState | undefined;
let mentorAStorageState: CapturedStorageState | undefined;
let mentorBStorageState: CapturedStorageState | undefined;

interface CaseResult {
  id: string;
  name: string;
  status: "PASS" | "FAIL";
  detail?: string;
}

interface PdfEvidence {
  template: string;
  jobId: string;
  bytes: number;
  sha256: string;
  pages: number;
  uiObservedStatuses: string[];
}

interface CitationEvidence {
  intended: string[];
  editorAfterInsertions: string[][];
  editorBeforeSave?: string[];
  saveRequest?: string[];
  saveResponse?: string[];
  postgres?: string[];
  getResponse?: string[];
  reopenedEditor?: string[];
  visibleAfterReopen?: string[];
  firstDivergence?: string;
  classification?: string;
}

interface StabilityIterationEvidence {
  iteration: number;
  status: "PASS" | "FAIL";
  boundaries: Record<string, string[]>;
  saveRequests?: number;
  firstDivergence?: string;
  detail?: string;
}

interface RequestCounts {
  signIn: number;
  signUp: number;
  documentSave: number;
}

const evidence: {
  exactCommit: string;
  cases: CaseResult[];
  pdfs: PdfEvidence[];
  compileStatusObservations: CompileStatusObservation[];
  topology?: string;
  separation?: string;
  workerPostJob?: string;
  workerRestart?: string;
  legacyCompileCalls: number;
  citation: CitationEvidence;
  stabilityIterations: StabilityIterationEvidence[];
  requestCounts: RequestCounts;
  observations: Record<string, unknown>;
  retries: number;
} = {
  exactCommit: EXACT_COMMIT,
  cases: [],
  pdfs: [],
  compileStatusObservations: [],
  legacyCompileCalls: 0,
  citation: {
    intended: ["A", "B", "A"],
    editorAfterInsertions: [],
  },
  stabilityIterations: [],
  requestCounts: {
    signIn: 0,
    signUp: 0,
    documentSave: 0,
  },
  observations: {},
  retries: 0,
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function safeDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  let redacted = message
    .replaceAll(mentorA.password, "[redacted]")
    .replaceAll(mentorB.password, "[redacted]")
    .replace(/https?:\/\/\S+/gu, "[redacted-url]")
    .replace(/\u001b\[[0-9;]*m/gu, "");
  if (stabilityUser) redacted = redacted.replaceAll(stabilityUser.password, "[redacted]");
  return redacted.slice(0, 500);
}

function persistEvidence(): void {
  mkdirSync(externalRoot, { recursive: true });
  writeFileSync(resultFile, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function acceptanceCase(id: string, name: string, body: () => Promise<void>): Promise<void> {
  try {
    await test.step(`${id} ${name}`, body);
    evidence.cases.push({ id, name, status: "PASS" });
  } catch (error) {
    evidence.cases.push({ id, name, status: "FAIL", detail: safeDetail(error) });
    persistEvidence();
    throw error;
  }
  persistEvidence();
}

function recordCheck(id: string, name: string, passed: boolean, detail?: string): void {
  evidence.cases.push({
    id,
    name,
    status: passed ? "PASS" : "FAIL",
    ...(detail ? { detail } : {}),
  });
  persistEvidence();
}

interface JsonNode {
  type?: unknown;
  attrs?: { citeKey?: unknown };
  content?: unknown;
}

function citationKeysFromDocument(value: unknown): string[] {
  const keys: string[] = [];
  const walk = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const node = candidate as JsonNode;
    if (node.type === "citation" && typeof node.attrs?.citeKey === "string") {
      keys.push(node.attrs.citeKey);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };
  walk(value);
  return keys;
}

function citationKeysFromEnvelope(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return citationKeysFromDocument((value as { editor?: unknown }).editor);
}

async function editorCitationKeys(page: Page): Promise<string[]> {
  const documentJson = await page
    .getByRole("main")
    .locator(".ProseMirror")
    .evaluate((element) => {
      const root = element as HTMLElement & {
        pmViewDesc?: { node?: { toJSON?: () => unknown } };
      };
      const toJSON = root.pmViewDesc?.node?.toJSON;
      if (!toJSON) throw new Error("ProseMirror document JSON is unavailable");
      return toJSON.call(root.pmViewDesc?.node);
    });
  return citationKeysFromDocument(documentJson);
}

function assertCitationBoundary(
  name: string,
  actual: string[],
  expected: string[],
  classification: string
): void {
  if (
    evidence.citation.firstDivergence === undefined &&
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    evidence.citation.firstDivergence = name;
    evidence.citation.classification = classification;
  }
  persistEvidence();
  expect(actual).toEqual(expected);
}

function control(command: string, ...args: string[]): string {
  const result = spawnSync(
    "wsl.exe",
    ["-d", "DePress-Day10", "--exec", "bash", controlScript, command, ...args],
    { encoding: "utf8", timeout: 120_000, windowsHide: true }
  );
  if (result.status !== 0) {
    throw new Error(`staging-control ${command} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function instrumentRequests(context: BrowserContext): void {
  context.on("request", (requestValue) => {
    const path = new URL(requestValue.url()).pathname;
    if (requestValue.method() === "POST" && path === "/api/auth/sign-in/email") {
      evidence.requestCounts.signIn += 1;
    }
    if (requestValue.method() === "POST" && path === "/api/auth/sign-up/email") {
      evidence.requestCounts.signUp += 1;
    }
    if (requestValue.method() === "PUT" && /^\/api\/documents\/[0-9a-f-]+$/u.test(path)) {
      evidence.requestCounts.documentSave += 1;
    }
    persistEvidence();
  });
}

async function newDay10Context(
  browser: Browser,
  storageState?: CapturedStorageState
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: process.env.DAY10_BASE_URL,
    ignoreHTTPSErrors: true,
    ...(storageState ? { storageState } : {}),
  });
  instrumentRequests(context);
  return context;
}

async function login(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  const signIn = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auth/sign-in/email") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  const signInResponse = await signIn;
  expect(
    signInResponse.status(),
    "real email/password sign-in must return HTTP success"
  ).toBeGreaterThanOrEqual(200);
  expect(
    signInResponse.status(),
    "real email/password sign-in must return HTTP success"
  ).toBeLessThan(300);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function assertActiveSession(context: BrowserContext): Promise<void> {
  const response = await context.request.get("/api/protected-probe");
  expect(response.status(), "authenticated session unexpectedly expired").toBe(200);
  const body = (await response.json()) as { userId?: unknown };
  expect(typeof body.userId, "authenticated safe endpoint must return a user id").toBe("string");
  expect((body.userId as string).length).toBeGreaterThan(0);
}

async function captureAuthenticatedState(
  browser: Browser,
  user: { email: string; password: string }
): Promise<CapturedStorageState> {
  const context = await newDay10Context(browser);
  try {
    const page = await context.newPage();
    await login(page, user);
    await assertActiveSession(context);
    const cookies = await context.cookies();
    const authCookies = cookies.filter((cookie) => cookie.name.includes("session"));
    expect(authCookies.length).toBeGreaterThan(0);
    expect(authCookies.every((cookie) => cookie.httpOnly && cookie.secure)).toBe(true);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

function requireCapturedState(
  state: CapturedStorageState | undefined,
  name: string
): CapturedStorageState {
  if (!state) throw new Error(`${name} authenticated storageState was not captured`);
  return state;
}

async function addReference(
  page: Page,
  id: string,
  title: string,
  author: string,
  year: string
): Promise<void> {
  await page.getByLabel("citeKey").fill(id);
  await page.getByLabel("Reference title").fill(title);
  await page.getByLabel("Reference author").fill(author);
  await page.getByLabel("Reference year").fill(year);
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === "/api/references" &&
      candidate.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Add reference" }).click();
  expect((await response).status()).toBe(201);
  await expect(page.getByText(`@${id}`, { exact: true })).toBeVisible();
}

async function createDocument(page: Page): Promise<{ id: string; revision: number }> {
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/documents" &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "New", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const resource = (await response.json()) as { id: string; revision: number };
  await expect(
    page.getByRole("main").getByText(`Revision ${resource.revision}`, { exact: true })
  ).toBeVisible();
  return resource;
}

function metadataControls(page: Page) {
  return {
    title: page.getByPlaceholder("论文标题", { exact: true }),
    abstract: page.getByPlaceholder("摘要（纯文本）", { exact: true }),
    keywords: page.getByPlaceholder("学术出版, 结构化编辑", { exact: true }),
    authors: page.getByPlaceholder("Ada Lovelace | aff-1\n王伟 / WANG Wei | aff-1,aff-2", {
      exact: true,
    }),
    affiliations: page.getByPlaceholder(
      "aff-1 | Analytical Engines Lab\naff-2 | 计算机学院 / School of CS",
      { exact: true },
    ),
  };
}

async function saveDocument(
  page: Page
): Promise<{ id: string; revision: number; envelope: unknown; requestEnvelope: unknown }> {
  const responsePromise = page.waitForResponse(
    (response) =>
      /^\/api\/documents\/[0-9a-f-]+$/u.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT"
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const requestBody = response.request().postDataJSON() as { envelope?: unknown };
  expect(requestBody.envelope).toBeDefined();
  const resource = (await response.json()) as {
    id: string;
    revision: number;
    envelope: unknown;
  };
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  return { ...resource, requestEnvelope: requestBody.envelope };
}

async function createSavedDocument(
  page: Page,
  title: string,
  body: string
): Promise<{ id: string; revision: number }> {
  const created = await createDocument(page);
  await metadataControls(page).title.fill(title);
  await page.getByRole("main").locator(".ProseMirror").fill(body);
  const saved = await saveDocument(page);
  return { id: created.id, revision: saved.revision };
}

function compileAlert(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

async function expectOnlyCompileAlert(page: Page, message: string): Promise<void> {
  const alert = compileAlert(page);
  await expect(alert, "the editor landmark must contain exactly one application alert").toHaveCount(
    1
  );
  await expect(
    alert,
    "the application alert must prove the exact safe compile invariant"
  ).toHaveText(message);
}

async function insertCitation(
  page: Page,
  citeKey: string,
  expectedKeys: string[]
): Promise<string[]> {
  const editor = page.getByRole("main").locator(".ProseMirror");
  await editor.press("Control+Shift+c");
  const query = page.getByPlaceholder("按 citeKey / 标题 / 作者搜索", { exact: true });
  await expect(query).toBeVisible();
  await query.fill(citeKey);
  const picker = query.locator("..");
  const option = picker.getByRole("button").filter({
    has: page.getByText(`@${citeKey}`, { exact: true }),
  });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(query).toBeHidden();
  const keys = await editorCitationKeys(page);
  evidence.citation.editorAfterInsertions.push(keys);
  assertCitationBoundary(
    `editor-after-insertion-${expectedKeys.length}`,
    keys,
    expectedKeys,
    "HARNESS_INSERTION_DEFECT"
  );
  return keys;
}

function assertStabilityBoundary(
  iterationEvidence: StabilityIterationEvidence,
  name: string,
  actual: string[],
  expected: string[]
): void {
  iterationEvidence.boundaries[name] = actual;
  if (
    iterationEvidence.firstDivergence === undefined &&
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    iterationEvidence.firstDivergence = name;
  }
  persistEvidence();
  expect(actual, `citation stability iteration ${iterationEvidence.iteration}: ${name}`).toEqual(
    expected
  );
}

async function insertStabilityCitation(
  page: Page,
  citeKey: string,
  expectedKeys: string[],
  iterationEvidence: StabilityIterationEvidence
): Promise<void> {
  const editor = page.getByRole("main").locator(".ProseMirror");
  const beforeKeys = await editorCitationKeys(page);
  await editor.press("Control+Shift+c");
  const query = page.getByPlaceholder("按 citeKey / 标题 / 作者搜索", { exact: true });
  await expect(query).toBeVisible();
  await query.fill(citeKey);
  const picker = query.locator("..");
  const option = picker.getByRole("button").filter({
    has: page.getByText(`@${citeKey}`, { exact: true }),
  });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(query).toBeHidden();
  const keys = await editorCitationKeys(page);
  expect(
    keys.length - beforeKeys.length,
    `citation stability iteration ${iterationEvidence.iteration}: node delta for ${citeKey}`
  ).toBe(1);
  assertStabilityBoundary(
    iterationEvidence,
    `editor-after-insertion-${expectedKeys.length}`,
    keys,
    expectedKeys
  );
}

async function insertCitationWithSingleActionProof(
  page: Page,
  citeKey: string,
  expectedKeys: string[]
): Promise<void> {
  const editor = page.getByRole("main").locator(".ProseMirror");
  const beforeKeys = await editorCitationKeys(page);
  await editor.press("Control+Shift+c");
  const query = page.getByPlaceholder("按 citeKey / 标题 / 作者搜索", { exact: true });
  await expect(query).toBeVisible();
  await query.fill(citeKey);
  const picker = query.locator("..");
  const option = picker.getByRole("button").filter({
    has: page.getByText(`@${citeKey}`, { exact: true }),
  });
  await expect(option).toHaveCount(1);

  await option.evaluate((element) => {
    const scope = window as Window & { __day10CitationOptionClicks?: number };
    scope.__day10CitationOptionClicks = 0;
    element.addEventListener(
      "click",
      () => {
        scope.__day10CitationOptionClicks = (scope.__day10CitationOptionClicks ?? 0) + 1;
      },
      { capture: true }
    );
  });
  const selectionRequests: string[] = [];
  const requestListener = (requestValue: import("@playwright/test").Request) => {
    selectionRequests.push(`${requestValue.method()} ${new URL(requestValue.url()).pathname}`);
  };
  page.on("request", requestListener);
  try {
    await option.click();
    await expect(query).toBeHidden();
  } finally {
    page.off("request", requestListener);
  }

  const keys = await editorCitationKeys(page);
  expect(keys, `editor citations after selecting ${citeKey}`).toEqual(expectedKeys);
  expect(keys.length - beforeKeys.length, `citation node delta after selecting ${citeKey}`).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __day10CitationOptionClicks?: number }).__day10CitationOptionClicks
    ),
    `option click count for ${citeKey}`
  ).toBe(1);
  expect(selectionRequests, `requests issued while selecting ${citeKey}`).toEqual([]);
}

async function waitForCompileStatus(page: Page, status: string): Promise<void> {
  await expect(
    page.getByRole("status").filter({ hasText: `Compile status: ${status}` })
  ).toBeVisible({ timeout: 90_000 });
}

async function waitForSuccessfulCompileTerminal(
  page: Page,
  observation: CompileStatusObservation
): Promise<void> {
  const compileStatus = page.getByRole("status").filter({ hasText: "Compile status:" });
  await expect
    .poll(
      async () => {
        const status = parseCompileUiStatus(await compileStatus.textContent());
        if (!status) return undefined;
        observeCompileUiStatus(observation, status);
        if (status === "failed") {
          throw new Error("compile UI reached failed while success was required");
        }
        return status;
      },
      {
        message: "compile UI must reach succeeded; processing may be shorter than one UI poll",
        timeout: 90_000,
      }
    )
    .toBe("succeeded");
}

interface CompileOptions {
  duplicateClick?: boolean;
  openPdfInBrowser?: boolean;
  pauseWorker?: boolean;
  expectSuccess?: boolean;
  savePdf?: boolean;
}

async function compileRevision(
  page: Page,
  template: "ieee" | "elsevier" | "gbt7714",
  options: CompileOptions = {}
): Promise<{
  jobId: string;
  resource: Record<string, unknown>;
  pdfPath?: string;
  pdfText?: string;
  viewerOpened?: boolean;
}> {
  const pauseWorker = options.pauseWorker ?? true;
  const expectSuccess = options.expectSuccess ?? true;
  const savePdf = options.savePdf ?? expectSuccess;
  if (pauseWorker) {
    control("pause-worker");
  }

  await page.getByLabel("PDF template").selectOption(template);
  const createResponses: string[] = [];
  const responseListener = (response: import("@playwright/test").Response) => {
    if (
      new URL(response.url()).pathname === "/api/compile-jobs" &&
      response.request().method() === "POST"
    ) {
      createResponses.push(response.url());
    }
  };
  page.on("response", responseListener);
  const createdPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/compile-jobs" &&
      response.request().method() === "POST"
  );
  const button = page.getByRole("button", { name: "Compile", exact: true });
  if (options.duplicateClick) {
    await button.evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
  } else {
    await button.click();
  }
  const createdResponse = await createdPromise;
  expect(createdResponse.status()).toBe(202);
  const resource = (await createdResponse.json()) as Record<string, unknown>;
  const jobId = String(resource.jobId);
  expect(jobId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
  const statusObservation = createCompileStatusObservation(jobId, template);
  expect(resource.status).toBe("accepted");
  await waitForCompileStatus(page, "accepted");
  observeCompileUiStatus(statusObservation, "accepted");

  if (options.duplicateClick) {
    await waitForCompileStatus(page, "queued");
  }

  if (pauseWorker) {
    if (!options.duplicateClick) {
      await waitForCompileStatus(page, "queued");
    }
    observeCompileUiStatus(statusObservation, "queued");
    if (options.duplicateClick) {
      expect(createResponses).toHaveLength(1);
      expect(control("duplicate-near-count", jobId)).toBe("1");
    }
    control("resume-worker");
  }

  if (!expectSuccess) {
    await waitForCompileStatus(page, "failed");
    observeCompileUiStatus(statusObservation, "failed");
    const failedJobResponse = await page.request.get(`/api/compile-jobs/${jobId}`);
    expect(failedJobResponse.status()).toBe(200);
    const failedJob = (await failedJobResponse.json()) as Record<string, unknown>;
    expect(failedJob.jobId).toBe(jobId);
    expect(failedJob.documentId).toBe(resource.documentId);
    expect(failedJob.revision).toBe(resource.revision);
    expect(failedJob.status).toBe("failed");
    statusObservation.apiTerminalStatus = "failed";
    evidence.compileStatusObservations.push(statusObservation);
    persistEvidence();
    await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
    page.off("response", responseListener);
    return { jobId, resource };
  }

  try {
    await waitForSuccessfulCompileTerminal(page, statusObservation);
  } catch (error) {
    evidence.compileStatusObservations.push(statusObservation);
    persistEvidence();
    page.off("response", responseListener);
    throw error;
  }
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
  page.off("response", responseListener);

  const jobResponse = await page.request.get(`/api/compile-jobs/${jobId}`);
  expect(jobResponse.status()).toBe(200);
  const jobJson = (await jobResponse.json()) as Record<string, unknown>;
  expect(Object.keys(jobJson).sort()).toEqual(Object.keys(resource).sort());
  expect(jobJson.jobId).toBe(jobId);
  expect(jobJson.documentId).toBe(resource.documentId);
  expect(jobJson.revision).toBe(resource.revision);
  expect(jobJson.status).toBe("succeeded");
  expect(JSON.stringify(jobJson)).not.toContain("artifactKey");
  expect(JSON.stringify(jobJson)).not.toContain("artifacts/");

  const downloadResponse = await page.request.get(`/api/compile-jobs/${jobId}/download`);
  expect(downloadResponse.status()).toBe(200);
  const downloadJson = (await downloadResponse.json()) as Record<string, unknown>;
  expect(Object.keys(downloadJson)).toEqual(["downloadUrl"]);
  const signedUrl = String(downloadJson.downloadUrl);
  const parsedUrl = new URL(signedUrl);
  expect(Number(parsedUrl.searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(900);
  validateSuccessfulCompileObservation(statusObservation, {
    expectedJobId: jobId,
    apiJobId: String(jobJson.jobId),
    expectedDocumentId: resource.documentId,
    apiDocumentId: jobJson.documentId,
    expectedRevision: resource.revision,
    apiRevision: jobJson.revision,
    apiTerminalStatus: jobJson.status,
    downloadAvailable: true,
    timedOut: false,
  });
  evidence.compileStatusObservations.push(statusObservation);
  persistEvidence();

  recordCheck(
    `D10-ARTIFACT-${template.toUpperCase()}`,
    `${template} artifact metadata is absent from the ordinary Job response`,
    !JSON.stringify(jobJson).includes("artifactKey") &&
      !JSON.stringify(jobJson).includes("artifacts/")
  );

  if (!savePdf) return { jobId, resource };
  let viewerOpened = false;
  let body: Buffer;
  if (options.openPdfInBrowser) {
    const pdfResponse = await page.request.get(signedUrl);
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
    body = await pdfResponse.body();
    const pdfViewer = await page.context().newPage();
    try {
      await pdfViewer.setContent(`
        <!doctype html>
        <html>
          <head><title>Day 10 PDF Viewer</title></head>
          <body style="margin: 0">
            <embed id="pdf-viewer" type="application/pdf" style="width: 100vw; height: 100vh">
          </body>
        </html>
      `);
      await pdfViewer.evaluate((base64Pdf) => {
        const binary = atob(base64Pdf);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const pdfUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        const viewer = document.querySelector<HTMLEmbedElement>("#pdf-viewer");
        if (!viewer) throw new Error("PDF viewer element was not created");
        viewer.src = pdfUrl;
      }, body.toString("base64"));
      await expect(pdfViewer.locator("#pdf-viewer")).toBeVisible();
      await expect(pdfViewer.locator("#pdf-viewer")).toHaveAttribute("src", /^blob:/u);
      expect(await pdfViewer.title()).toBe("Day 10 PDF Viewer");
      viewerOpened = true;
      evidence.observations.pdfViewer = {
        opened: true,
        title: await pdfViewer.title(),
        contentType: pdfResponse.headers()["content-type"],
      };
    } finally {
      await pdfViewer.close();
    }
  } else {
    const pdfResponse = await page.request.get(signedUrl);
    expect(pdfResponse.status()).toBe(200);
    body = await pdfResponse.body();
  }
  expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(body.byteLength).toBeGreaterThan(1_500);
  mkdirSync(artifactDir, { recursive: true });
  const pdfPath = join(artifactDir, `${template}-${jobId}.pdf`);
  writeFileSync(pdfPath, body, { mode: 0o600 });
  const info = control("pdf-info", basename(pdfPath));
  const pagesMatch = /^Pages:\s+(\d+)$/mu.exec(info);
  expect(pagesMatch).not.toBeNull();
  const pages = Number(pagesMatch?.[1]);
  expect(pages).toBeGreaterThan(0);
  const pdfText = control("pdf-text", basename(pdfPath));
  evidence.pdfs.push({
    template,
    jobId,
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
    pages,
    uiObservedStatuses: [...statusObservation.uiObservedStatuses],
  });
  persistEvidence();
  return { jobId, resource, pdfPath, pdfText, viewerOpened };
}

async function waitForDbTerminal(jobId: string): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = control("job-status", jobId);
    if (status === "succeeded" || status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Job ${jobId} did not reach a terminal database state`);
}

test.afterEach(() => {
  try {
    control("resume-worker");
  } catch {
    // The worker may be stopped or already cleaned up after the one bounded run.
  }
  persistEvidence();
});

test("Day 10 IEEE heading semantic normalization is exact", () => {
  const expectedHeading = "Acceptance Findings";

  expectIeeeSectionHeading("I) ACCEPTANCE FINDINGS", expectedHeading);
  expect(normalizeSemanticHeading("  Acceptance\u00a0Findings  ")).toBe(
    normalizeSemanticHeading("ACCEPTANCE FINDINGS")
  );
  expect(() => expectIeeeSectionHeading("I) Unrelated Findings", expectedHeading)).toThrow();
  expect(() => expectIeeeSectionHeading("ACCEPTANCE FINDINGS", expectedHeading)).toThrow();
});

test.describe("Day 10 signup/auth preflight", () => {
  test.skip(
    !["preflight", "full"].includes(testMode),
    "Signup preflight runs once in preflight or full mode."
  );

  test("public signup disabled and controlled mentor seeds usable", async ({ browser }) => {
    await acceptanceCase("D10-PREFLIGHT-001", "exact release and process topology", async () => {
      evidence.topology = control("topology");
      expect(evidence.topology).toContain(`release=${EXACT_COMMIT}`);
      if (process.env.DAY10_VALIDATION_TYPE === "NON_CANDIDATE_DIRTY_TREE_VALIDATION") {
        expect(evidence.topology).toContain(
          "validation_type=NON_CANDIDATE_DIRTY_TREE_VALIDATION"
        );
        expect(evidence.topology).toContain(
          "release_source=NON_CANDIDATE_DIRTY_TREE_BUNDLE"
        );
      }
      expect(evidence.topology).toContain("depress-web-day10.service");
      expect(evidence.topology).toContain("depress-day10-web");
      expect(evidence.topology).toContain("depress-api.service");
      expect(evidence.topology).toContain("depress-outbox.service");
      expect(evidence.topology).toContain("depress-pointer-worker.service");
    });

    await acceptanceCase(
      "D10-PREFLIGHT-002",
      "public signup returns 400 and creates no user",
      async () => {
        expect(control("signup-probe-user-count")).toBe("0");
        const signupProbe = await request.newContext({
          baseURL: process.env.DAY10_BASE_URL,
          ignoreHTTPSErrors: true,
        });
        try {
          evidence.requestCounts.signUp += 1;
          persistEvidence();
          const signupResponse = await signupProbe.post("/api/auth/sign-up/email", {
            data: {
              name: "day10-signup-probe",
              email: "day10-signup-probe@invalid.test",
              password: "not-a-real-credential",
            },
          });
          expect(signupResponse.status()).toBe(400);
        } finally {
          await signupProbe.dispose();
        }
        expect(control("signup-probe-user-count")).toBe("0");
      }
    );

    await acceptanceCase(
      "D10-PREFLIGHT-003",
      "controlled mentor-a and mentor-b seed paths authenticate",
      async () => {
        mentorAStorageState = await captureAuthenticatedState(browser, mentorA);
        mentorBStorageState = await captureAuthenticatedState(browser, mentorB);
        expect(evidence.requestCounts.signUp).toBe(1);
        expect(evidence.requestCounts.signIn).toBe(2);
      }
    );
  });
});

test.describe("Day 10 single citation insertion proof", () => {
  test.skip(
    testMode !== "single-insertion",
    "The single-insertion proof runs only in single-insertion mode."
  );

  test("selects A, B, A by exact citeKey with one action per insertion", async ({ page }) => {
    await login(page, mentorA);
    await addReference(page, "A", "Stability Reference A", "Author A", "2024");
    await addReference(page, "B", "Stability Reference B", "Author B", "2025");
    await createDocument(page);

    const editor = page.getByRole("main").locator(".ProseMirror");
    await editor.click();
    await insertCitationWithSingleActionProof(page, "A", ["A"]);
    await insertCitationWithSingleActionProof(page, "B", ["A", "B"]);
    await insertCitationWithSingleActionProof(page, "A", ["A", "B", "A"]);
  });
});

test.describe.serial("Day 10 citation stability gate", () => {
  test.skip(testMode !== "stability", "The bounded stability gate runs only in stability mode.");

  test.beforeAll(async ({ browser }) => {
    if (!stabilityUser) throw new Error("Missing controlled stability mentor");
    expect(control("seed-stability-user")).toBe("stability-user-seeded");
    stabilityStorageState = await captureAuthenticatedState(browser, stabilityUser);
    expect(evidence.requestCounts.signIn).toBe(1);
    expect(evidence.requestCounts.signUp).toBe(0);
  });

  for (let iteration = 1; iteration <= 5; iteration += 1) {
    test(`citation stability iteration ${iteration}`, async ({ browser }) => {
      const iterationEvidence: StabilityIterationEvidence = {
        iteration,
        status: "FAIL",
        boundaries: {},
      };
      evidence.stabilityIterations.push(iterationEvidence);
      evidence.retries += test.info().retry;
      persistEvidence();
      let currentBoundary = "active-session";
      const context = await newDay10Context(
        browser,
        requireCapturedState(stabilityStorageState, "stability mentor")
      );
      const page = await context.newPage();
      const savesBefore = evidence.requestCounts.documentSave;

      try {
        expect(test.info().retry, "citation stability retries must remain disabled").toBe(0);
        await assertActiveSession(context);
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

        currentBoundary = "create-document";
        const citeKeyA = `A${iteration}`;
        const citeKeyB = `B${iteration}`;
        const expectedKeys = [citeKeyA, citeKeyB, citeKeyA];
        const created = await createDocument(page);
        const title = `Citation Stability Iteration ${iteration}`;
        await metadataControls(page).title.fill(title);

        currentBoundary = "create-references";
        await addReference(
          page,
          citeKeyA,
          `Stability Reference A ${iteration}`,
          "Author A",
          "2024"
        );
        await addReference(
          page,
          citeKeyB,
          `Stability Reference B ${iteration}`,
          "Author B",
          "2025"
        );

        const editor = page.getByRole("main").locator(".ProseMirror");
        await editor.click();
        await editor.type(`Iteration ${iteration} first `);
        currentBoundary = "editor-after-insertion-1";
        await insertStabilityCitation(page, citeKeyA, [citeKeyA], iterationEvidence);
        await editor.type(" then ");
        currentBoundary = "editor-after-insertion-2";
        await insertStabilityCitation(page, citeKeyB, [citeKeyA, citeKeyB], iterationEvidence);
        await editor.type(" and repeated ");
        currentBoundary = "editor-after-insertion-3";
        await insertStabilityCitation(page, citeKeyA, expectedKeys, iterationEvidence);
        await editor.type(` completes stability iteration ${iteration}.`);

        currentBoundary = "editor-before-save";
        assertStabilityBoundary(
          iterationEvidence,
          currentBoundary,
          await editorCitationKeys(page),
          expectedKeys
        );

        currentBoundary = "save-request";
        const saved = await saveDocument(page);
        assertStabilityBoundary(
          iterationEvidence,
          currentBoundary,
          citationKeysFromEnvelope(saved.requestEnvelope),
          expectedKeys
        );
        currentBoundary = "save-response";
        assertStabilityBoundary(
          iterationEvidence,
          currentBoundary,
          citationKeysFromEnvelope(saved.envelope),
          expectedKeys
        );
        currentBoundary = "postgres";
        assertStabilityBoundary(
          iterationEvidence,
          currentBoundary,
          JSON.parse(control("document-cite-order", created.id)) as string[],
          expectedKeys
        );

        currentBoundary = "get-response";
        const persisted = await page.request.get(`/api/documents/${created.id}`);
        expect(persisted.status()).toBe(200);
        const persistedResource = (await persisted.json()) as { envelope?: unknown };
        assertStabilityBoundary(
          iterationEvidence,
          currentBoundary,
          citationKeysFromEnvelope(persistedResource.envelope),
          expectedKeys
        );

        currentBoundary = "reopen-readiness";
        await page.reload();
        await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
        await page
          .getByRole("button", {
            name: `${title} Revision ${saved.revision}`,
            exact: true,
          })
          .click();
        await expect(metadataControls(page).title).toHaveValue(title);
        await expect(editor).toContainText(`completes stability iteration ${iteration}.`);

        currentBoundary = "reopened-editor";
        assertStabilityBoundary(
          iterationEvidence,
          currentBoundary,
          await editorCitationKeys(page),
          expectedKeys
        );
        currentBoundary = "visible-after-reopen";
        const visibleKeys = (
          await editor
            .locator("[data-cite-key]")
            .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-cite-key")))
        ).filter((key): key is string => key !== null);
        assertStabilityBoundary(iterationEvidence, currentBoundary, visibleKeys, expectedKeys);

        iterationEvidence.saveRequests = evidence.requestCounts.documentSave - savesBefore;
        expect(
          iterationEvidence.saveRequests,
          `citation stability iteration ${iteration}: exactly one save transaction`
        ).toBe(1);
        if (iteration === 5) {
          expect(evidence.requestCounts.signIn, "one sign-in for the complete stability gate").toBe(
            1
          );
          expect(evidence.requestCounts.signUp, "no signup in the stability gate").toBe(0);
          expect(
            evidence.requestCounts.documentSave,
            "one citation-bearing save transaction per stability iteration"
          ).toBe(5);
          expect(evidence.retries, "no Playwright retries in the stability gate").toBe(0);
        }

        iterationEvidence.firstDivergence = "NONE_OBSERVED";
        iterationEvidence.status = "PASS";
        evidence.cases.push({
          id: `D10-STABILITY-${iteration}`,
          name: `citation stability iteration ${iteration}`,
          status: "PASS",
        });
      } catch (error) {
        iterationEvidence.firstDivergence ??= currentBoundary;
        iterationEvidence.detail = safeDetail(error);
        evidence.cases.push({
          id: `D10-STABILITY-${iteration}`,
          name: `citation stability iteration ${iteration}`,
          status: "FAIL",
          detail: iterationEvidence.detail,
        });
        throw error;
      } finally {
        await context.close();
        persistEvidence();
      }
    });
  }
});

test.describe("Day 10 full technical acceptance", () => {
  test.skip(
    !runsCoreAcceptance,
    "Core acceptance runs only in diagnose, focused, D10-010, remaining, smoke, or full mode."
  );

  test("authenticated browser-to-PDF technical acceptance", async ({ browser }) => {
    if (!mentorAStorageState) {
      mentorAStorageState = await captureAuthenticatedState(browser, mentorA);
    }
    if (!["d10-010", "smoke"].includes(testMode) && !mentorBStorageState) {
      mentorBStorageState = await captureAuthenticatedState(browser, mentorB);
    }
    const mentorAContext = await newDay10Context(
      browser,
      requireCapturedState(mentorAStorageState, "mentor-a")
    );
    const page = await mentorAContext.newPage();

    try {
      mkdirSync(artifactDir, { recursive: true });
      const legacyCalls: string[] = [];
      page.on("request", (requestValue) => {
        if (new URL(requestValue.url()).pathname === "/compile") {
          legacyCalls.push(requestValue.url());
        }
      });

      let primaryDocumentId = "";
      let primaryRevision = 0;
      let ieeeJobId = "";

      if (testMode === "d10-010" || testMode === "remaining") {
        await assertActiveSession(mentorAContext);
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

        if (testMode === "remaining") {
          await addReference(page, "A", "Day 10 Reference Alpha", "Ada Alpha", "2024");
        }

        const primary = await createSavedDocument(
          page,
          "Day 10 Mentor Acceptance Manuscript",
          "A minimal saved document for bounded resumed acceptance."
        );
        primaryDocumentId = primary.id;
        primaryRevision = primary.revision;

        if (testMode === "d10-010") {
          await createSavedDocument(
            page,
            "Day 10 Citation Free",
            "A second saved document for stale compile-state isolation."
          );
        } else {
          const compiled = await compileRevision(page, "ieee", { savePdf: false });
          ieeeJobId = compiled.jobId;
        }
      }

      if (testMode !== "d10-010" && testMode !== "remaining") {
        await acceptanceCase("D10-001", "exact release and process topology", async () => {
          evidence.topology = control("topology");
          expect(evidence.topology).toContain(`release=${EXACT_COMMIT}`);
          if (process.env.DAY10_VALIDATION_TYPE === "NON_CANDIDATE_DIRTY_TREE_VALIDATION") {
            expect(evidence.topology).toContain(
              "validation_type=NON_CANDIDATE_DIRTY_TREE_VALIDATION"
            );
            expect(evidence.topology).toContain(
              "release_source=NON_CANDIDATE_DIRTY_TREE_BUNDLE"
            );
          }
          expect(evidence.topology).toContain("depress-web-day10.service");
          expect(evidence.topology).toContain("depress-day10-web");
          expect(evidence.topology).toContain("depress-api.service");
          expect(evidence.topology).toContain("depress-outbox.service");
          expect(evidence.topology).toContain("depress-pointer-worker.service");
          if (testMode === "smoke") {
            expect(evidence.topology).toMatch(/depress-outbox\.service .* active running/u);
            expect(evidence.topology).toMatch(/depress-pointer-worker\.service .* active running/u);
          }
        });

        await acceptanceCase(
          "D10-002",
          "mentor-a reused session and secure forwarded cookie",
          async () => {
            await assertActiveSession(mentorAContext);
            await page.goto("/");
            await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
            const cookies = await mentorAContext.cookies();
            const authCookies = cookies.filter((cookie) => cookie.name.includes("session"));
            expect(authCookies.length).toBeGreaterThan(0);
            expect(authCookies.every((cookie) => cookie.httpOnly && cookie.secure)).toBe(true);
          }
        );

        await acceptanceCase(
          "D10-003",
          "create, save, refresh, reopen, metadata/reference/citation persistence",
          async () => {
            await addReference(page, "A", "Day 10 Reference Alpha", "Ada Alpha", "2024");
            await addReference(page, "B", "Day 10 Reference Beta", "Blaise Beta", "2025");
            await addReference(page, "UNUSED", "Day 10 Unused Reference", "Una Unused", "2023");

            const created = await createDocument(page);
            primaryDocumentId = created.id;
            const metadata = metadataControls(page);
            await metadata.title.fill("Day 10 Mentor Acceptance Manuscript");
            await metadata.abstract.fill("A bounded non-public technical acceptance abstract.");
            await metadata.keywords.fill("acceptance, persistence, citations");
            await metadata.authors.fill("Mentor Alpha | aff-1\nMentor Collaborator | aff-1");
            await metadata.affiliations.fill("aff-1 | Day 10 Test Laboratory");

            const editor = page.locator(".ProseMirror");
            await editor.click();
            await editor.press("Control+Alt+1");
            await editor.type("Acceptance Findings");
            await editor.press("Enter");
            await editor.type("First use ");
            await insertCitation(page, "A", ["A"]);
            await editor.type(" then second use ");
            await insertCitation(page, "B", ["A", "B"]);
            await editor.type(" and repeated first use ");
            await insertCitation(page, "A", ["A", "B", "A"]);
            await editor.type(" completes the structured paragraph.");
            await editor.press("Enter");
            await editor.type("A second persisted body paragraph.");

            evidence.citation.editorBeforeSave = await editorCitationKeys(page);
            assertCitationBoundary(
              "editor-before-save",
              evidence.citation.editorBeforeSave,
              evidence.citation.intended,
              "EDITOR_TRANSACTION_DEFECT"
            );
            const saved = await saveDocument(page);
            primaryRevision = saved.revision;
            evidence.citation.saveRequest = citationKeysFromEnvelope(saved.requestEnvelope);
            assertCitationBoundary(
              "save-request",
              evidence.citation.saveRequest,
              evidence.citation.intended,
              "SAVE_SERIALIZATION_DEFECT"
            );
            evidence.citation.saveResponse = citationKeysFromEnvelope(saved.envelope);
            assertCitationBoundary(
              "save-response",
              evidence.citation.saveResponse,
              evidence.citation.intended,
              "API_PERSISTENCE_DEFECT"
            );
            evidence.citation.postgres = JSON.parse(
              control("document-cite-order", primaryDocumentId)
            ) as string[];
            assertCitationBoundary(
              "postgres",
              evidence.citation.postgres,
              evidence.citation.intended,
              "DATABASE_STORAGE_DEFECT"
            );
            const persisted = await page.request.get(`/api/documents/${primaryDocumentId}`);
            expect(persisted.status()).toBe(200);
            const persistedResource = (await persisted.json()) as { envelope?: unknown };
            evidence.citation.getResponse = citationKeysFromEnvelope(persistedResource.envelope);
            assertCitationBoundary(
              "get-response",
              evidence.citation.getResponse,
              evidence.citation.intended,
              "API_READ_DEFECT"
            );

            await page.reload();
            await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
            await page
              .getByRole("button", {
                name: `Day 10 Mentor Acceptance Manuscript Revision ${primaryRevision}`,
                exact: true,
              })
              .click();
            const reopened = metadataControls(page);
            await expect(reopened.title).toHaveValue("Day 10 Mentor Acceptance Manuscript");
            await expect(reopened.abstract).toHaveValue(
              "A bounded non-public technical acceptance abstract."
            );
            await expect(reopened.keywords).toHaveValue("acceptance, persistence, citations");
            await expect(reopened.authors).toHaveValue(
              "Mentor Alpha | aff-1\nMentor Collaborator | aff-1"
            );
            await expect(page.locator(".ProseMirror")).toContainText(
              "A second persisted body paragraph."
            );
            await expect(page.getByText("@A", { exact: true })).toBeVisible();
            await expect(page.getByText("@B", { exact: true })).toBeVisible();
            await expect(page.getByText("@UNUSED", { exact: true })).toBeVisible();
            evidence.citation.reopenedEditor = await editorCitationKeys(page);
            assertCitationBoundary(
              "reopened-editor",
              evidence.citation.reopenedEditor,
              evidence.citation.intended,
              "EDITOR_HYDRATION_DEFECT"
            );
            evidence.citation.visibleAfterReopen = (
              await page
                .locator(".ProseMirror [data-cite-key]")
                .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-cite-key")))
            ).filter((key): key is string => key !== null);
            assertCitationBoundary(
              "visible-after-reopen",
              evidence.citation.visibleAfterReopen,
              evidence.citation.intended,
              "UNRESOLVED"
            );
            if (evidence.citation.firstDivergence === undefined) {
              evidence.citation.firstDivergence = "NONE_OBSERVED";
              evidence.citation.classification = "UNRESOLVED";
              persistEvidence();
            }
          }
        );

        if (!["diagnose", "focused", "smoke", "full"].includes(testMode)) return;

        if (testMode !== "smoke") {
          await acceptanceCase("D10-004", "dirty save gate and duplicate-click guard", async () => {
            const editor = page.locator(".ProseMirror");
            await editor.click();
            await editor.press("End");
            await editor.type(" Dirty gate edit.");
            await expect(page.getByText("Save the document before compiling")).toBeVisible();
            await expect(page.getByRole("button", { name: "Compile", exact: true })).toBeDisabled();
            const saved = await saveDocument(page);
            primaryRevision = saved.revision;
            await expect(page.getByRole("button", { name: "Compile", exact: true })).toBeEnabled();
          });
        }

        let ieeeText = "";
        await acceptanceCase("D10-005", "IEEE compile and authenticated PDF download", async () => {
          const compiled = await compileRevision(
            page,
            "ieee",
            testMode === "smoke" ? { openPdfInBrowser: true } : { duplicateClick: true }
          );
          ieeeJobId = compiled.jobId;
          ieeeText = compiled.pdfText ?? "";
          if (testMode === "smoke") {
            const normalized = ieeeText.replace(/\s+/gu, " ");
            expect(compiled.viewerOpened).toBe(true);
            expect(normalized).toContain("Day 10 Mentor Acceptance Manuscript");
            expectIeeeSectionHeading(ieeeText, "Acceptance Findings");
            expect(normalized).toContain("A second persisted body paragraph.");
            expect(/\[1\].*?\[2\].*?\[1\]/u.test(normalized)).toBe(true);
            expect(normalized).toMatch(/References/iu);
            expect(normalized.match(/Day 10 Reference Alpha/gu) ?? []).toHaveLength(1);
            expect(normalized.match(/Day 10 Reference Beta/gu) ?? []).toHaveLength(1);
            expect(normalized).not.toContain("Day 10 Unused Reference");
          }
        });

        if (testMode === "smoke") {
          await acceptanceCase(
            "D10-SMOKE-LOGOUT",
            "logout clears the disposable session",
            async () => {
              await page.getByRole("button", { name: "Sign out" }).click();
              await expect(page.getByRole("heading", { name: "Mentor sign in" })).toBeVisible();
              await expect(page.getByText(/Compile status:/u)).toHaveCount(0);
              await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
              const clientState = await page.evaluate(() =>
                JSON.stringify({
                  localStorage: { ...window.localStorage },
                  sessionStorage: { ...window.sessionStorage },
                })
              );
              expect(clientState).not.toContain(ieeeJobId);
              const sessionCookies = (await mentorAContext.cookies()).filter((cookie) =>
                cookie.name.includes("session")
              );
              evidence.observations.logout = {
                compileStatusCount: await page.getByText(/Compile status:/u).count(),
                downloadButtonCount: await page
                  .getByRole("button", { name: "Download PDF" })
                  .count(),
                sessionCookieCount: sessionCookies.length,
              };
              expect(evidence.observations.logout).toEqual({
                compileStatusCount: 0,
                downloadButtonCount: 0,
                sessionCookieCount: 0,
              });
              expect(sessionCookies).toHaveLength(0);
              expect(evidence.requestCounts).toEqual({
                signIn: 1,
                signUp: 0,
                documentSave: 1,
              });
              expect(evidence.retries).toBe(0);
            }
          );
          return;
        }

        if (testMode === "diagnose") return;

        if (testMode === "focused") {
          await acceptanceCase(
            "D10-FOCUSED-001",
            "post-Job Worker state, uniqueness, exact cleanup, and one restart",
            async () => {
              evidence.workerPostJob = control("worker-state");
              expect(evidence.workerPostJob).toContain("ActiveState=active");
              expect(evidence.workerPostJob).toContain("SubState=running");
              expect(evidence.workerPostJob).toContain("ExecMainStatus=0");
              expect(control("artifact-count", ieeeJobId)).toBe("1");
              expect(control("duplicate-near-count", ieeeJobId)).toBe("1");
              expect(control("managed-container-count")).toBe("0");
              expect(control("signed-url-count")).toBe("0");

              control("restart-worker");
              evidence.workerRestart = control("worker-state");
              expect(evidence.workerRestart).toContain("ActiveState=active");
              expect(evidence.workerRestart).toContain("SubState=running");
              expect(control("job-status", ieeeJobId)).toBe("succeeded");
              expect(control("artifact-count", ieeeJobId)).toBe("1");
              expect(control("duplicate-near-count", ieeeJobId)).toBe("1");
              expect(control("managed-container-count")).toBe("0");
            }
          );
          return;
        }

        await acceptanceCase(
          "D10-006",
          "Elsevier compile and authenticated PDF download",
          async () => {
            await compileRevision(page, "elsevier");
          }
        );

        await acceptanceCase(
          "D10-007",
          "GB/T 7714 compile and authenticated PDF download",
          async () => {
            await compileRevision(page, "gbt7714");
          }
        );

        await acceptanceCase(
          "D10-008",
          "bounded PDF citation-order and bibliography assertions",
          async () => {
            const normalized = ieeeText.replace(/\s+/gu, " ");
            const citationOrder = /\[1\].*?\[2\].*?\[1\]/u.test(normalized);
            expect(citationOrder).toBe(true);
            expect(normalized.match(/Day 10 Reference Alpha/gu) ?? []).toHaveLength(1);
            expect(normalized.match(/Day 10 Reference Beta/gu) ?? []).toHaveLength(1);
            expect(normalized).not.toContain("Day 10 Unused Reference");
          }
        );

        await acceptanceCase(
          "D10-009",
          "citation-free document has no bibliography heading",
          async () => {
            const created = await createDocument(page);
            expect(created.id).not.toBe("");
            const metadata = metadataControls(page);
            await metadata.title.fill("Day 10 Citation Free");
            await page
              .locator(".ProseMirror")
              .fill("This document intentionally contains no citations.");
            await saveDocument(page);
            const compiled = await compileRevision(page, "ieee");
            const text = (compiled.pdfText ?? "").replace(/\s+/gu, " ");
            expect(text).not.toMatch(/\b(?:References|Bibliography)\b/u);
          }
        );
      }

      if (testMode !== "remaining") {
        await acceptanceCase(
          "D10-010",
          "switch clears compile UI, stale polling is isolated, and download retry stays available",
          async () => {
            let workerPaused = false;
            let oldJobPollsAfterSwitch = 0;
            const pollListener = (requestValue: import("@playwright/test").Request) => {
              if (
                requestValue.method() === "GET" &&
                requestValue.url().includes(String(evidence.observations.d10010StaleJobId))
              ) {
                oldJobPollsAfterSwitch += 1;
              }
            };
            let downloadPattern: string | undefined;
            const controlledDownloadFailure = (route: import("@playwright/test").Route) =>
              route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ error: "controlled" }),
              });

            try {
              await page
                .getByRole("button", { name: /Day 10 Mentor Acceptance Manuscript/u })
                .click();
              await expect(page.getByText("Saved", { exact: true })).toBeVisible();
              control("pause-worker");
              workerPaused = true;
              const createdPromise = page.waitForResponse(
                (response) =>
                  new URL(response.url()).pathname === "/api/compile-jobs" &&
                  response.request().method() === "POST"
              );
              await page.getByLabel("PDF template").selectOption("ieee");
              await page.getByRole("button", { name: "Compile", exact: true }).click();
              const staleResource = (await (await createdPromise).json()) as { jobId: string };
              evidence.observations.d10010StaleJobId = staleResource.jobId;
              await waitForCompileStatus(page, "queued");

              page.on("request", pollListener);
              await page.getByRole("button", { name: /Day 10 Citation Free/u }).click();
              const pollsAtSwitch = oldJobPollsAfterSwitch;
              await expect(page.getByText(/Compile status:/u)).toHaveCount(0);
              await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);

              control("resume-worker");
              workerPaused = false;
              expect(await waitForDbTerminal(staleResource.jobId)).toBe("succeeded");
              await page.getByRole("main").evaluate(() => document.readyState);
              expect(
                oldJobPollsAfterSwitch,
                "switching documents must abort all further polling for the stale Job"
              ).toBe(pollsAtSwitch);
              await expect(page.getByText(/Compile status:/u)).toHaveCount(0);
              await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
              page.off("request", pollListener);

              await page
                .getByRole("button", { name: /Day 10 Mentor Acceptance Manuscript/u })
                .click();
              const retryCompiled = await compileRevision(page, "ieee", { savePdf: false });
              downloadPattern = `**/api/compile-jobs/${retryCompiled.jobId}/download`;
              await page.route(downloadPattern, controlledDownloadFailure);
              await page.getByRole("button", { name: "Download PDF" }).click();

              await expectOnlyCompileAlert(page, "The compile service is unavailable. Try again.");
              const applicationAlertCount = await compileAlert(page).count();
              const pageAlertCount = await page.getByRole("alert").count();
              evidence.observations.d10010Locator = {
                intended: "visible safe compile download-retry alert",
                correctedLocator: "main landmark -> alert role",
                correctedMatchCount: applicationAlertCount,
                pageAlertCount,
              };
              persistEvidence();
              await expect(page.getByRole("button", { name: "Download PDF" })).toBeEnabled();
            } finally {
              page.off("request", pollListener);
              if (downloadPattern) {
                await page.unroute(downloadPattern, controlledDownloadFailure);
              }
              if (workerPaused) control("resume-worker");
            }
          }
        );
      }

      if (testMode === "d10-010") return;

      await acceptanceCase(
        "D10-011",
        "mentor-b authorization isolation and private object denial",
        async () => {
          const bContext = await newDay10Context(
            browser,
            requireCapturedState(mentorBStorageState, "mentor-b")
          );
          try {
            await assertActiveSession(bContext);
            const bPage = await bContext.newPage();
            const documentStatus = (
              await bPage.request.get(`/api/documents/${primaryDocumentId}`)
            ).status();
            const referenceMutationStatus = (
              await bPage.request.put("/api/references/A", {
                data: {
                  item: {
                    id: "A",
                    type: "article-journal",
                    title: "Unauthorized mutation",
                  },
                },
              })
            ).status();
            const jobStatus = (await bPage.request.get(`/api/compile-jobs/${ieeeJobId}`)).status();
            const downloadStatus = (
              await bPage.request.get(`/api/compile-jobs/${ieeeJobId}/download`)
            ).status();
            const unsigned = await request.newContext({ ignoreHTTPSErrors: true });
            try {
              const unsignedResponse = await unsigned.get(
                `http://127.0.0.1:19000/depress-day10-artifacts/artifacts/${ieeeJobId}.pdf`
              );
              const unsignedStatus = unsignedResponse.status();
              evidence.observations.authorization = {
                mentorBDocument: documentStatus,
                mentorBReferenceMutation: referenceMutationStatus,
                mentorBJob: jobStatus,
                mentorBDownload: downloadStatus,
                unsignedPrivateObject: unsignedStatus,
              };
              persistEvidence();
              expect(documentStatus).toBe(404);
              expect(referenceMutationStatus).toBe(404);
              expect(jobStatus).toBe(404);
              expect(downloadStatus).toBe(404);
              expect(unsignedStatus).toBe(403);
            } finally {
              await unsigned.dispose();
            }
          } finally {
            await bContext.close();
          }
        }
      );

      await acceptanceCase(
        "D10-012",
        "unauthenticated protected routes are safely rejected",
        async () => {
          const unauth = await request.newContext({
            baseURL: process.env.DAY10_BASE_URL,
            ignoreHTTPSErrors: true,
          });
          const responses = [
            await unauth.get(`/api/documents/${primaryDocumentId}`),
            await unauth.get("/api/references"),
            await unauth.post("/api/compile-jobs", {
              data: {
                documentId: primaryDocumentId,
                revision: primaryRevision,
                templateId: "ieee",
                format: "pdf",
              },
            }),
            await unauth.get(`/api/compile-jobs/${ieeeJobId}`),
            await unauth.get(`/api/compile-jobs/${ieeeJobId}/download`),
          ];
          try {
            const statuses = responses.map((response) => response.status());
            evidence.observations.unauthenticatedStatuses = statuses;
            persistEvidence();
            for (const status of statuses) expect([401, 403]).toContain(status);
          } finally {
            await unauth.dispose();
          }
        }
      );

      await acceptanceCase(
        "D10-013",
        "reverse proxy health, blocks, and legacy-route non-use",
        async () => {
          const paths = [
            "/health/live",
            "/health/ready",
            "/compile",
            "/jobs/probe",
            "/api/internal/probe",
            "/internal/worker",
            "/internal/outbox",
          ] as const;
          const statuses = Object.fromEntries(
            await Promise.all(
              paths.map(async (path) => [path, (await page.request.get(path)).status()])
            )
          );
          evidence.observations.proxyStatuses = statuses;
          evidence.legacyCompileCalls = legacyCalls.length;
          persistEvidence();
          expect(statuses["/health/live"]).toBe(200);
          expect(statuses["/health/ready"]).toBe(200);
          expect(statuses["/compile"]).toBe(404);
          expect(statuses["/jobs/probe"]).toBe(404);
          expect(statuses["/api/internal/probe"]).toBe(404);
          expect(statuses["/internal/worker"]).toBe(404);
          expect(statuses["/internal/outbox"]).toBe(404);
          expect(legacyCalls).toHaveLength(0);
        }
      );

      await acceptanceCase("D10-014", "Docker and worker write-sandbox separation", async () => {
        evidence.separation = control("separation");
        evidence.observations.networkBoundaries = control("network-boundaries");
        persistEvidence();
        expect(evidence.separation).toContain("api-docker=denied");
        expect(evidence.separation).toContain("worker-docker=allowed");
        expect(evidence.separation).toContain(
          "worker-write=/run/depress-day10-worker-only"
        );
        expect(evidence.observations.networkBoundaries).toBe(
          "postgres=loopback redis=loopback s3=loopback docker-tcp=absent"
        );
      });

      await acceptanceCase(
        "D10-015",
        "worker restart reconciliation creates one logical artifact",
        async () => {
          await page.getByRole("button", { name: /Day 10 Mentor Acceptance Manuscript/u }).click();
          control("pause-worker");
          const createdPromise = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/compile-jobs" &&
              response.request().method() === "POST"
          );
          await page.getByLabel("PDF template").selectOption("elsevier");
          await page.getByRole("button", { name: "Compile", exact: true }).click();
          const created = (await (await createdPromise).json()) as { jobId: string };
          await waitForCompileStatus(page, "queued");
          control("stop-worker");
          control("start-worker");
          const terminalStatus = await waitForDbTerminal(created.jobId);
          const artifactCount = control("artifact-count", created.jobId);
          evidence.observations.workerRecovery = {
            jobId: created.jobId,
            terminalStatus,
            artifactCount,
          };
          persistEvidence();
          expect(terminalStatus).toBe("succeeded");
          expect(artifactCount).toBe("1");
        }
      );

      await acceptanceCase(
        "D10-016",
        "controlled compile/upload failures are safe and retryable",
        async () => {
          let compilerFailureJobId = "";
          let compilerFailureStatus = "";
          let compilerFailureDownloadStatus = 0;
          control("enable-compiler-failure");
          try {
            const compilerFailure = await compileRevision(page, "ieee", {
              pauseWorker: false,
              expectSuccess: false,
              savePdf: false,
            });
            compilerFailureJobId = compilerFailure.jobId;
            await expectOnlyCompileAlert(page, "PDF compilation failed. Try compiling again.");
            const text = await compileAlert(page).textContent();
            expect(text).not.toMatch(/(?:\/opt\/|\/run\/|S3_|SECRET|PASSWORD|credential|stack)/iu);
            await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
            const failedJobResponse = await page.request.get(
              `/api/compile-jobs/${compilerFailure.jobId}`
            );
            expect(failedJobResponse.status()).toBe(200);
            const failedJob = (await failedJobResponse.json()) as Record<string, unknown>;
            compilerFailureStatus = String(failedJob.status);
            expect(failedJob.status).toBe("failed");
            expect(JSON.stringify(failedJob)).not.toMatch(
              /(?:\/opt\/|\/run\/|S3_|SECRET|PASSWORD|credential|stack)/iu
            );
            compilerFailureDownloadStatus = (
              await page.request.get(`/api/compile-jobs/${compilerFailure.jobId}/download`)
            ).status();
            expect(compilerFailureDownloadStatus).toBe(409);
          } finally {
            control("disable-compiler-failure");
          }

          let uploadFailureJobId = "";
          let uploadFailureStatus = "";
          let uploadFailureDownloadStatus = 0;
          control("detach-upload");
          try {
            const uploadFailure = await compileRevision(page, "gbt7714", {
              pauseWorker: false,
              expectSuccess: false,
              savePdf: false,
            });
            uploadFailureJobId = uploadFailure.jobId;
            await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
            await expectOnlyCompileAlert(page, "PDF compilation failed. Try compiling again.");
            const failedJobResponse = await page.request.get(
              `/api/compile-jobs/${uploadFailure.jobId}`
            );
            expect(failedJobResponse.status()).toBe(200);
            const failedJob = (await failedJobResponse.json()) as Record<string, unknown>;
            uploadFailureStatus = String(failedJob.status);
            expect(failedJob.status).toBe("failed");
            uploadFailureDownloadStatus = (
              await page.request.get(`/api/compile-jobs/${uploadFailure.jobId}/download`)
            ).status();
            expect(uploadFailureDownloadStatus).toBe(409);
          } finally {
            control("attach-upload");
          }
          const retry = await compileRevision(page, "ieee", { savePdf: false });
          evidence.observations.failureRecovery = {
            compiler: {
              jobId: compilerFailureJobId,
              status: compilerFailureStatus,
              downloadStatus: compilerFailureDownloadStatus,
            },
            upload: {
              jobId: uploadFailureJobId,
              status: uploadFailureStatus,
              downloadStatus: uploadFailureDownloadStatus,
            },
            retry: {
              jobId: retry.jobId,
              status: "succeeded",
            },
          };
          persistEvidence();
        }
      );

      await acceptanceCase(
        "D10-017",
        "no signed URL persists in browser or database state",
        async () => {
          expect(control("signed-url-count")).toBe("0");
          const browserState = await page.evaluate(() =>
            JSON.stringify({
              localStorage: { ...window.localStorage },
              sessionStorage: { ...window.sessionStorage },
            })
          );
          expect(browserState).not.toContain("X-Amz-");
          expect(browserState).not.toContain("19000");
        }
      );

      await acceptanceCase(
        "D10-018",
        "logout clears authenticated UI and client state",
        async () => {
          await page.getByRole("button", { name: "Sign out" }).click();
          await expect(page.getByRole("heading", { name: "Mentor sign in" })).toBeVisible();
          await expect(page.getByText(/Compile status:/u)).toHaveCount(0);
          const clientState = await page.evaluate(() =>
            JSON.stringify({
              localStorage: { ...window.localStorage },
              sessionStorage: { ...window.sessionStorage },
            })
          );
          expect(clientState).not.toContain(ieeeJobId);
          const sessionCookies = (await mentorAContext.cookies()).filter((cookie) =>
            cookie.name.includes("session")
          );
          evidence.observations.logout = {
            compileStatusCount: await page.getByText(/Compile status:/u).count(),
            downloadButtonCount: await page.getByRole("button", { name: "Download PDF" }).count(),
            sessionCookieCount: sessionCookies.length,
          };
          persistEvidence();
          expect(evidence.observations.logout).toEqual({
            compileStatusCount: 0,
            downloadButtonCount: 0,
            sessionCookieCount: 0,
          });
          expect(sessionCookies).toHaveLength(0);
        }
      );

      await acceptanceCase("D10-019", "bounded full-run authentication requests", async () => {
        expect(
          evidence.requestCounts.signUp,
          testMode === "full"
            ? "one disabled-signup preflight request"
            : "resumed acceptance must not repeat signup"
        ).toBe(testMode === "full" ? 1 : 0);
        expect(evidence.requestCounts.signIn, "one real login for each controlled mentor").toBe(2);
        expect(evidence.retries, "Playwright retries remain disabled").toBe(0);
      });

      const failedChecks = evidence.cases.filter((result) => result.status === "FAIL");
      expect(failedChecks, "all Day 10 acceptance checks").toEqual([]);
    } finally {
      await mentorAContext.close();
    }
  });
});
