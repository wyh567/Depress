import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { registerReferencesDoiRoute } from "./routes/references-doi";
import type { CrossrefClient } from "./services/crossref/crossref-client";
import type { MentorAuth } from "./auth/auth";
import { registerAuthRoutes } from "./auth/fastify-auth";
import type { Pool } from "pg";
import { registerDocumentRoutes } from "./routes/documents";
import { registerReferenceRoutes } from "./routes/references";
import { registerCompileJobRoutes } from "./routes/compile-jobs";
import type { ArtifactUrlSigner } from "./services/artifact-contracts";
import {
  DEFAULT_API_BODY_LIMIT_BYTES,
  DEFAULT_API_RATE_LIMIT_MAX,
  DEFAULT_API_RATE_LIMIT_WINDOW_MS,
  DEFAULT_COMPILE_RATE_LIMIT_MAX,
  DEFAULT_DOI_RATE_LIMIT_MAX,
  LOOPBACK_TRUST_PROXY,
  rateLimitError,
  type ApiSafetyOptions,
} from "./http-safety";
import {
  DEFAULT_COMPILE_ACTIVE_JOB_LIMIT,
  DEFAULT_COMPILE_SNAPSHOT_MAX_BYTES,
  type CompileSafetyOptions,
} from "./compile-safety";

// buildApp never listens on a port — callers (tests via app.inject, a future
// server entrypoint via app.listen) decide that.
// signArtifactUrl is injectable: production passes
// createS3ArtifactService().getSignedDownloadUrl (services/s3 — imported by
// the server entrypoint so its fail-fast env check runs at boot); tests
// inject a fake. Without it, succeeded jobs answer 500 ARTIFACT_UNAVAILABLE.
// crossref is injectable for DOI lookup tests; production uses the default
// fixed-origin client (optional CROSSREF_MAILTO via server entrypoint).
export function buildApp(
  options: {
    signArtifactUrl?: ArtifactUrlSigner;
    crossref?: CrossrefClient;
    crossrefMailto?: string;
    fetchFn?: typeof fetch;
    auth?: MentorAuth;
    authOrigin?: string;
    database?: Pool;
    logLevel?: "fatal" | "error" | "warn" | "info" | "debug";
  } & ApiSafetyOptions & CompileSafetyOptions = {}
): FastifyInstance {
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_API_BODY_LIMIT_BYTES;
  const rateLimitMax = options.rateLimitMax ?? DEFAULT_API_RATE_LIMIT_MAX;
  const rateLimitWindowMs =
    options.rateLimitWindowMs ?? DEFAULT_API_RATE_LIMIT_WINDOW_MS;
  const doiRateLimitMax = options.doiRateLimitMax ?? DEFAULT_DOI_RATE_LIMIT_MAX;
  const compileRateLimitMax =
    options.compileRateLimitMax ?? DEFAULT_COMPILE_RATE_LIMIT_MAX;
  const compileActiveJobLimit =
    options.compileActiveJobLimit ?? DEFAULT_COMPILE_ACTIVE_JOB_LIMIT;
  const compileSnapshotMaxBytes =
    options.compileSnapshotMaxBytes ?? DEFAULT_COMPILE_SNAPSHOT_MAX_BYTES;
  const app = Fastify({
    logger: options.logLevel ? { level: options.logLevel } : false,
    bodyLimit: bodyLimitBytes,
    trustProxy: options.trustProxy ?? LOOPBACK_TRUST_PROXY,
    routerOptions: { maxParamLength: 1024 },
  });
  app.setErrorHandler((error, request, reply) => {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send({ error: "REQUEST_BODY_TOO_LARGE" });
    }
    if (code === "RATE_LIMITED") {
      return reply.code(429).send({ error: "RATE_LIMITED" });
    }
    if (code === "CROSSREF_RATE_LIMITED") {
      return reply
        .code(429)
        .send({ ok: false, error: "CROSSREF_RATE_LIMITED" });
    }
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : undefined;
    if (
      typeof statusCode === "number" &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      return reply.code(statusCode).send(error);
    }
    request.log.error(
      { errorCode: typeof code === "string" ? code : "UNKNOWN" },
      "Unexpected request failure",
    );
    return reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });
  void app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: rateLimitWindowMs,
    skipOnError: false,
    errorResponseBuilder: () => rateLimitError("RATE_LIMITED"),
    ...(options.rateLimitRedis ? { redis: options.rateLimitRedis } : {}),
    ...(options.rateLimitNameSpace
      ? { nameSpace: options.rateLimitNameSpace }
      : {}),
  });
  void app.register(async (routes) => {
    registerReferencesDoiRoute(routes, {
      ...(options.crossref ? { crossref: options.crossref } : {}),
      ...(options.crossrefMailto ? { mailto: options.crossrefMailto } : {}),
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      rateLimitMax: doiRateLimitMax,
      rateLimitWindowMs,
    });
    if (options.auth) {
      if (!options.authOrigin) {
        throw new Error("authOrigin is required when auth is configured");
      }
      registerAuthRoutes(routes, options.auth, options.authOrigin);
      if (options.database) {
        registerDocumentRoutes(routes, options.auth, options.database);
        registerReferenceRoutes(routes, options.auth, options.database);
        registerCompileJobRoutes(
          routes,
          options.auth,
          options.database,
          options.signArtifactUrl,
          { max: compileRateLimitMax, timeWindowMs: rateLimitWindowMs },
          {
            activeJobLimit: compileActiveJobLimit,
            snapshotMaxBytes: compileSnapshotMaxBytes,
          },
        );
      }
    }
  });
  return app;
}
