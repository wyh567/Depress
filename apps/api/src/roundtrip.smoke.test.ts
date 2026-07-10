import { describe, expect, it } from "vitest";
import { JobResponseSchema } from "@depress/ast";
import { renderIeeeTypstDocument } from "@depress/transformers";
import { buildApp } from "./app";
import { CompileResponseSchema } from "./contracts";
import { createBullmqCompileQueue } from "./queue/compile-queue";
import { createBullmqJobReader } from "./services/job-reader";
import { startCompileWorker } from "./workers/compile-worker";
import { parseRuntimeEnv, redisConnection } from "./env";

// Full-stack smoke test — opt in with DEPRESS_ROUNDTRIP_SMOKE=1.
// Requires real infra: `docker compose up -d` (Redis + MinIO with the bucket
// initialized) plus S3_*/REDIS_* env (see .env.example) and Docker for the
// Typst sandbox. Everything else in the suite stays fully mocked.
describe.skipIf(process.env["DEPRESS_ROUNDTRIP_SMOKE"] !== "1")(
  "compile round trip (redis + minio + docker smoke)",
  () => {
    it("POST /compile → worker compiles → GET /jobs/:id serves a signed URL that downloads a PDF", async () => {
      const env = parseRuntimeEnv(process.env);
      const connection = redisConnection(env);
      const { createS3ArtifactService } = await import("./services/s3");
      const s3 = createS3ArtifactService();

      const app = buildApp({
        queue: createBullmqCompileQueue(connection),
        jobs: createBullmqJobReader(connection),
        signArtifactUrl: (key) => s3.getSignedDownloadUrl(key),
      });
      const worker = await startCompileWorker({ connection });

      // Phase 3 TODO #1: metadata must survive Web→API→Queue→Worker and
      // drive the IEEE title (not the "DePress Draft" fallback). PDF glyph
      // streams are not plain-text searchable, so title injection is asserted
      // on the Typst source; the Docker path asserts a real PDF still builds.
      const ast = {
        type: "doc" as const,
        metadata: {
          title: "Metadata Aware Round Trip",
          authors: [{ name: "Ada Lovelace", affiliationIds: ["aff-1"] }],
          affiliations: [{ id: "aff-1", name: "Analytical Engines Lab" }],
          abstract: "Smoke test with document metadata.",
          keywords: ["AST", "Typst", "smoke"],
        },
        content: [
          {
            type: "heading" as const,
            level: 1 as const,
            content: [{ type: "text" as const, text: "Round Trip" }],
          },
          {
            type: "paragraph" as const,
            content: [{ type: "text" as const, text: "Hello from the smoke test." }],
          },
        ],
      };
      const typstSource = renderIeeeTypstDocument(ast);
      expect(typstSource).toContain("Metadata Aware Round Trip");
      expect(typstSource).not.toContain("DePress Draft");

      try {
        const post = await app.inject({
          method: "POST",
          url: "/compile",
          payload: {
            ast,
            templateId: "ieee",
            format: "pdf",
            references: [],
          },
        });
        expect(post.statusCode).toBe(202);
        const { jobId } = CompileResponseSchema.parse(post.json());

        // Poll like the web client does, against real BullMQ state.
        let downloadUrl: string | undefined;
        const deadline = Date.now() + 110_000;
        while (Date.now() < deadline) {
          const res = await app.inject({
            method: "GET",
            url: `/jobs/${jobId}`,
          });
          expect(res.statusCode).toBe(200);
          const job = JobResponseSchema.parse(res.json());
          if (job.status === "failed") {
            throw new Error(`job failed: ${job.error}`);
          }
          if (job.status === "succeeded") {
            downloadUrl = job.downloadUrl;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        expect(downloadUrl).toBeDefined();

        const pdfRes = await fetch(downloadUrl as string);
        expect(pdfRes.ok).toBe(true);
        const bytes = Buffer.from(await pdfRes.arrayBuffer());
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      } finally {
        await worker.close();
        await app.close();
      }
    }, 120_000);
  },
);
