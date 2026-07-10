import type { FastifyInstance } from "fastify";
import {
  DoiLookupRequestSchema,
  type DoiLookupErrorCode,
  type DoiLookupResponse,
  normalizeDoi,
} from "@depress/ast";
import {
  createCrossrefClient,
  type CrossrefClient,
} from "../services/crossref/crossref-client";
import { crossrefWorkToCslItem } from "../services/crossref/crossref-work-to-csl";

const ERROR_STATUS: Record<DoiLookupErrorCode, number> = {
  INVALID_DOI: 400,
  DOI_NOT_FOUND: 404,
  CROSSREF_TIMEOUT: 504,
  CROSSREF_RATE_LIMITED: 429,
  CROSSREF_UNAVAILABLE: 502,
  INVALID_CROSSREF_METADATA: 422,
};

function fail(error: DoiLookupErrorCode): DoiLookupResponse {
  return { ok: false, error };
}

export function registerReferencesDoiRoute(
  app: FastifyInstance,
  options: {
    crossref?: CrossrefClient;
    mailto?: string;
    fetchFn?: typeof fetch;
  } = {},
): void {
  const crossref =
    options.crossref ??
    createCrossrefClient({
      ...(options.mailto ? { mailto: options.mailto } : {}),
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    });

  app.post("/references/doi/lookup", async (request, reply) => {
    const parsed = DoiLookupRequestSchema.safeParse(request.body as unknown);
    if (!parsed.success) {
      const body = fail("INVALID_DOI");
      return reply.status(ERROR_STATUS.INVALID_DOI).send(body);
    }

    const normalized = normalizeDoi(parsed.data.doi);
    if (!normalized.ok) {
      const body = fail("INVALID_DOI");
      return reply.status(ERROR_STATUS.INVALID_DOI).send(body);
    }

    const lookup = await crossref.lookupWork(normalized.doi);
    if (!lookup.ok) {
      const body = fail(lookup.error);
      return reply.status(ERROR_STATUS[lookup.error]).send(body);
    }

    const mapped = crossrefWorkToCslItem(lookup.work, normalized.doi);
    if (!mapped.ok) {
      const body = fail(mapped.error);
      return reply.status(ERROR_STATUS[mapped.error]).send(body);
    }

    const body: DoiLookupResponse = { ok: true, item: mapped.item };
    return reply.status(200).send(body);
  });
}
