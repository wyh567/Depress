import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

// Fail-fast env contract: this module throws at import time if the S3
// configuration is incomplete, so a misconfigured worker/server dies on boot
// instead of failing mid-job. Nothing on the pure request path (buildApp,
// unit tests) imports this module — only production wiring does.
const S3EnvSchema = z.object({
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  // Optional: S3-compatible endpoints (MinIO, R2) for local dev.
  S3_ENDPOINT: z.string().url().optional(),
});
export type S3Env = z.infer<typeof S3EnvSchema>;

// Exported for direct unit testing of the validation rules.
export function parseS3Env(source: unknown): S3Env {
  const parsed = S3EnvSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`S3 configuration invalid or missing: ${missing}`);
  }
  return parsed.data;
}

const env = parseS3Env(process.env);

// Fixed by decision (no env knob): signed URLs live 15 minutes.
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

export const ARTIFACT_KEY_PREFIX = "artifacts/";

export interface S3ArtifactService {
  uploadArtifact(key: string, pdf: Buffer): Promise<void>;
  getSignedDownloadUrl(key: string): Promise<string>;
}

// Client and presigner are injectable so tests never touch AWS.
export function createS3ArtifactService(
  deps: { client?: S3Client; presign?: typeof getSignedUrl } = {},
): S3ArtifactService {
  const client =
    deps.client ??
    new S3Client({
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      ...(env.S3_ENDPOINT
        ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true }
        : {}),
    });
  const presign = deps.presign ?? getSignedUrl;

  return {
    async uploadArtifact(key, pdf) {
      await client.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: pdf,
          ContentType: "application/pdf",
        }),
      );
    },
    async getSignedDownloadUrl(key) {
      return presign(
        client,
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
        { expiresIn: SIGNED_URL_TTL_SECONDS },
      );
    },
  };
}
