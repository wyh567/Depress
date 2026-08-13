import { afterEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  S3_BUCKET: "depress-artifacts",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "AKIATEST",
  S3_SECRET_ACCESS_KEY: "secret",
};
const optionalEnvKeys = ["S3_ENDPOINT", "S3_FORCE_PATH_STYLE"];

function stubEnv(env: Record<string, string>) {
  for (const key of Object.keys(validEnv)) vi.stubEnv(key, "");
  for (const key of optionalEnvKeys) vi.stubEnv(key, undefined);
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
  it("defaults custom endpoints to path-style addressing", async () => {
    stubEnv(validEnv);
    const { buildS3ClientConfig, parseS3Env } = await importS3();
    const parsed = parseS3Env({
      ...validEnv,
      S3_ENDPOINT: "http://localhost:9000",
    });

    expect(buildS3ClientConfig(parsed)).toMatchObject({
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
    });
  });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])(
    "maps S3_FORCE_PATH_STYLE=%s to %s",
    async (setting, expected) => {
      stubEnv(validEnv);
      const { buildS3ClientConfig, parseS3Env } = await importS3();
      const parsed = parseS3Env({
        ...validEnv,
        S3_ENDPOINT: "https://s3.example.com",
        S3_FORCE_PATH_STYLE: setting,
      });

      expect(buildS3ClientConfig(parsed).forcePathStyle).toBe(expected);
    },
  );

  it.each(["yes", "no", "abc", "2"])(
    "rejects invalid S3_FORCE_PATH_STYLE=%s",
    async (setting) => {
      stubEnv(validEnv);
      const { parseS3Env } = await importS3();

      expect(() =>
        parseS3Env({
          ...validEnv,
          S3_ENDPOINT: "https://s3.example.com",
          S3_FORCE_PATH_STYLE: setting,
        }),
      ).toThrow(/S3_FORCE_PATH_STYLE/);
    },
  );

  it("configures a custom endpoint for virtual-hosted-style addressing", async () => {
    stubEnv(validEnv);
    const { buildS3ClientConfig, parseS3Env } = await importS3();
    const parsed = parseS3Env({
      ...validEnv,
      S3_ENDPOINT: "https://s3.example.com",
      S3_FORCE_PATH_STYLE: "false",
    });

    expect(buildS3ClientConfig(parsed)).toMatchObject({
      endpoint: "https://s3.example.com",
      forcePathStyle: false,
    });
  });

  it("leaves AWS SDK addressing behavior unset without a custom endpoint", async () => {
    stubEnv(validEnv);
    const { buildS3ClientConfig, parseS3Env } = await importS3();
    const parsed = parseS3Env({
      ...validEnv,
      S3_FORCE_PATH_STYLE: "false",
    });
    const config = buildS3ClientConfig(parsed);

    expect(config).not.toHaveProperty("endpoint");
    expect(config).not.toHaveProperty("forcePathStyle");
  });

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

  it("deletes exactly one validated key from the configured private bucket", async () => {
    stubEnv(validEnv);
    const { createS3ArtifactCleanupService } = await importS3();
    const send = vi.fn<
      (command: { input: Record<string, unknown> }) => Promise<object>
    >(async () => ({}));
    const service = createS3ArtifactCleanupService({
      client: { send } as never,
    });

    await service.deleteArtifact("artifacts/j1.pdf");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: "depress-artifacts",
      Key: "artifacts/j1.pdf",
    });
  });

  it("does not swallow storage deletion failures", async () => {
    stubEnv(validEnv);
    const { createS3ArtifactCleanupService } = await importS3();
    const failure = new Error("controlled AccessDenied");
    const service = createS3ArtifactCleanupService({
      client: {
        send: vi.fn(async () => {
          throw failure;
        }),
      } as never,
    });

    await expect(service.deleteArtifact("artifacts/j1.pdf")).rejects.toBe(
      failure,
    );
  });

  it("closes its S3 client resource", async () => {
    stubEnv(validEnv);
    const { createS3ArtifactCleanupService } = await importS3();
    const destroy = vi.fn();
    const service = createS3ArtifactCleanupService({
      client: { send: vi.fn(), destroy } as never,
    });

    service.close();

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
