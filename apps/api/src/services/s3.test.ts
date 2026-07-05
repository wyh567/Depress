import { afterEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  S3_BUCKET: "depress-artifacts",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "AKIATEST",
  S3_SECRET_ACCESS_KEY: "secret",
};

function stubEnv(env: Record<string, string>) {
  for (const key of Object.keys(validEnv)) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

async function importS3() {
  vi.resetModules();
  return import("./s3");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("s3 module init (fail-fast env validation)", () => {
  it("throws at import time when required env vars are missing", async () => {
    stubEnv({ S3_BUCKET: "only-bucket" });
    await expect(importS3()).rejects.toThrow(
      /S3 configuration invalid or missing/,
    );
  });

  it("names the offending variables, not their values", async () => {
    stubEnv({ ...validEnv, S3_SECRET_ACCESS_KEY: "" });
    const error = await importS3().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain("S3_SECRET_ACCESS_KEY");
    expect(error?.message).not.toContain("AKIATEST");
  });

  it("imports cleanly with a complete environment", async () => {
    stubEnv(validEnv);
    const mod = await importS3();
    expect(mod.SIGNED_URL_TTL_SECONDS).toBe(900);
  });
});

describe("parseS3Env", () => {
  it("rejects a malformed optional endpoint", async () => {
    stubEnv(validEnv);
    const { parseS3Env } = await importS3();
    expect(() =>
      parseS3Env({ ...validEnv, S3_ENDPOINT: "not a url" }),
    ).toThrow(/S3_ENDPOINT/);
  });
});

describe("createS3ArtifactService", () => {
  it("uploads a PDF with the bucket/key/content-type contract", async () => {
    stubEnv(validEnv);
    const { createS3ArtifactService } = await importS3();
    const send = vi.fn<
      (command: { input: Record<string, unknown> }) => Promise<object>
    >(async () => ({}));
    const service = createS3ArtifactService({
      client: { send } as never,
    });

    await service.uploadArtifact("artifacts/j1.pdf", Buffer.from("%PDF"));

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0];
    expect(command?.input).toMatchObject({
      Bucket: "depress-artifacts",
      Key: "artifacts/j1.pdf",
      ContentType: "application/pdf",
    });
  });

  it("presigns GET urls with the fixed 15-minute TTL", async () => {
    stubEnv(validEnv);
    const { createS3ArtifactService, SIGNED_URL_TTL_SECONDS } =
      await importS3();
    const presign = vi.fn(async () => "https://signed.example.com/j1.pdf");
    const service = createS3ArtifactService({
      client: { send: vi.fn() } as never,
      presign: presign as never,
    });

    const url = await service.getSignedDownloadUrl("artifacts/j1.pdf");

    expect(url).toBe("https://signed.example.com/j1.pdf");
    const [, command, options] = presign.mock.calls[0] as unknown as [
      unknown,
      { input: Record<string, unknown> },
      { expiresIn: number },
    ];
    expect(command.input).toMatchObject({
      Bucket: "depress-artifacts",
      Key: "artifacts/j1.pdf",
    });
    expect(options.expiresIn).toBe(SIGNED_URL_TTL_SECONDS);
    expect(SIGNED_URL_TTL_SECONDS).toBe(15 * 60);
  });
});
