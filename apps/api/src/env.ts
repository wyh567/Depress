import { z } from "zod";

// Runtime env for the server/worker entrypoints — Zod-validated at boot so
// misconfiguration fails fast, mirroring services/s3. Not imported by
// buildApp or unit tests.
const RuntimeEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  REDIS_HOST: z.string().min(1).default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  // Browser origin allowed by CORS (the Next.js dev server by default).
  CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
  // Optional Crossref polite-pool contact (not a secret). Recommended in
  // production so Crossref can reach operators; local boot works without it.
  CROSSREF_MAILTO: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().email().optional(),
  ),
});
export type RuntimeEnv = z.infer<typeof RuntimeEnvSchema>;

export function parseRuntimeEnv(source: unknown): RuntimeEnv {
  const parsed = RuntimeEnvSchema.safeParse(source);
  if (!parsed.success) {
    const bad = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Runtime configuration invalid: ${bad}`);
  }
  return parsed.data;
}

export function redisConnection(env: RuntimeEnv): {
  host: string;
  port: number;
} {
  return { host: env.REDIS_HOST, port: env.REDIS_PORT };
}
