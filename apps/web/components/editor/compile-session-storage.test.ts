// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCompileSessionJobId,
  compileSessionStorageKey,
  readCompileSessionJobId,
  writeCompileSessionJobId,
  type CompileSessionIdentity,
} from "./compile-session-storage";

const IDENTITY: CompileSessionIdentity = {
  documentId: "39e35789-2e60-4d40-840a-ef10cf05fab7",
  revision: 7,
  templateId: "ieee",
  format: "pdf",
};

const OTHER_DOCUMENT = "e58dc609-e84d-4f0d-aa61-8c014edecf40";

describe("compile session storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("keys an entry by paper, revision, template and format", () => {
    expect(compileSessionStorageKey(IDENTITY)).toBe(
      "depress:compile-session:v1:39e35789-2e60-4d40-840a-ef10cf05fab7:7:ieee:pdf",
    );
    expect(
      compileSessionStorageKey({ ...IDENTITY, templateId: "gbt7714" }),
    ).not.toBe(compileSessionStorageKey(IDENTITY));
    expect(compileSessionStorageKey({ ...IDENTITY, revision: 8 })).not.toBe(
      compileSessionStorageKey(IDENTITY),
    );
    expect(
      compileSessionStorageKey({ ...IDENTITY, documentId: OTHER_DOCUMENT }),
    ).not.toBe(compileSessionStorageKey(IDENTITY));
  });

  it("reads back only the exact identity it was written for", () => {
    writeCompileSessionJobId(IDENTITY, "job-a");

    expect(readCompileSessionJobId(IDENTITY)).toBe("job-a");
    expect(
      readCompileSessionJobId({ ...IDENTITY, templateId: "gbt7714" }),
    ).toBeUndefined();
    expect(
      readCompileSessionJobId({ ...IDENTITY, revision: 8 }),
    ).toBeUndefined();
    expect(
      readCompileSessionJobId({ ...IDENTITY, documentId: OTHER_DOCUMENT }),
    ).toBeUndefined();
  });

  it("forgets an entry when it is cleared", () => {
    writeCompileSessionJobId(IDENTITY, "job-a");
    clearCompileSessionJobId(IDENTITY);

    expect(readCompileSessionJobId(IDENTITY)).toBeUndefined();
  });

  it("persists the job id and nothing else, and never touches localStorage", () => {
    writeCompileSessionJobId(IDENTITY, "job-a");

    const stored = Object.keys(sessionStorage).map((key) =>
      sessionStorage.getItem(key),
    );
    expect(stored).toEqual(["job-a"]);
    expect(localStorage.length).toBe(0);
  });
});
