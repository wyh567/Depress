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
  } = {}
): FastifyInstance {
  const app = Fastify({
    logger: options.logLevel ? { level: options.logLevel } : false,
    routerOptions: { maxParamLength: 1024 },
  });
  registerReferencesDoiRoute(app, {
    ...(options.crossref ? { crossref: options.crossref } : {}),
    ...(options.crossrefMailto ? { mailto: options.crossrefMailto } : {}),
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
  });
  if (options.auth) {
    if (!options.authOrigin) throw new Error("authOrigin is required when auth is configured");
    registerAuthRoutes(app, options.auth, options.authOrigin);
    if (options.database) {
      registerDocumentRoutes(app, options.auth, options.database);
      registerReferenceRoutes(app, options.auth, options.database);
      registerCompileJobRoutes(app, options.auth, options.database, options.signArtifactUrl);
    }
  }
  return app;
}
