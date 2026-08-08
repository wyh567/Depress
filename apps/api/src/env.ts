import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const nodeEnv = z.enum(["development", "test", "production"]).default("development");
const logLevel = z.enum(["fatal", "error", "warn", "info", "debug"]).default("info");
export const PINNED_TYPST_IMAGE =
  "ghcr.io/typst/typst@sha256:b23ba03da5c085a2c8780bc9f2296db937abe1d0c75348cf2f8a9273199c3a14";
const redisUrl = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (!["redis:", "rediss:"].includes(url.protocol)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must use redis:// or rediss://",
      });
    }
    const database = url.pathname.slice(1);
    if (database && !/^\d+$/.test(database)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "database path must be a non-negative integer",
      });
    }
  });

const sharedInfrastructureShape = {
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.preprocess(emptyToUndefined, redisUrl.optional()),
  // Compatibility defaults keep local development unchanged. Production
  // entrypoints require REDIS_URL so credentials/TLS are not split across vars.
  REDIS_HOST: z.string().min(1).default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().max(65_535).default(6379),
};

function requireProductionRedisUrl(
  value: { NODE_ENV: string; REDIS_URL?: string | undefined },
  context: z.RefinementCtx
): void {
  if (value.NODE_ENV === "production" && !value.REDIS_URL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["REDIS_URL"],
      message: "is required in production",
    });
  }
}

const ApiEnvSchema = z
  .object({
    ...sharedInfrastructureShape,
    API_BIND_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().positive().max(65_535).default(3001),
    PUBLIC_ORIGIN: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    AUTH_ORIGIN: z.string().url(),
    CROSSREF_MAILTO: z.preprocess(emptyToUndefined, z.string().email().optional()),
  })
  .superRefine(requireProductionRedisUrl);

const OutboxEnvSchema = z
  .object({
    ...sharedInfrastructureShape,
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  })
  .superRefine(requireProductionRedisUrl);

const PointerWorkerEnvSchema = z
  .object({
    ...sharedInfrastructureShape,
    POINTER_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
    TYPST_IMAGE: z.literal(PINNED_TYPST_IMAGE).default(PINNED_TYPST_IMAGE),
    TYPST_FONT_PATH: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  })
  .superRefine(requireProductionRedisUrl);

export type ApiEnv = z.output<typeof ApiEnvSchema>;
export type OutboxEnv = z.output<typeof OutboxEnvSchema>;
export type PointerWorkerEnv = z.output<typeof PointerWorkerEnvSchema>;
export type RedisConnection = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
};

function parse<Schema extends z.ZodTypeAny>(schema: Schema, source: unknown): z.output<Schema> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Runtime configuration invalid: ${bad}`);
  }
  return parsed.data;
}

export function parseApiEnv(source: unknown): ApiEnv {
  const record =
    source && typeof source === "object" ? { ...(source as Record<string, unknown>) } : {};
  if (record["NODE_ENV"] !== "production") {
    record["PUBLIC_ORIGIN"] ??= "http://localhost:3000";
    record["AUTH_ORIGIN"] ??= "http://localhost:3000";
  }
  return parse(ApiEnvSchema, record);
}

export function parseOutboxEnv(source: unknown): OutboxEnv {
  return parse(OutboxEnvSchema, source);
}

export function parsePointerWorkerEnv(source: unknown): PointerWorkerEnv {
  return parse(PointerWorkerEnvSchema, source);
}

export function redisConnection(
  env: Pick<ApiEnv, "REDIS_URL" | "REDIS_HOST" | "REDIS_PORT">
): RedisConnection {
  if (env.REDIS_URL) {
    const url = new URL(env.REDIS_URL);
    const database = url.pathname.slice(1);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      ...(database ? { db: Number(database) } : {}),
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    };
  }
  return { host: env.REDIS_HOST, port: env.REDIS_PORT };
}
