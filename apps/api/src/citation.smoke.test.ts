import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JobResponseSchema } from "@depress/ast";
import { renderIeeeTypstProject } from "@depress/transformers";
import { buildApp } from "./app";
import { CompileResponseSchema } from "./contracts";
import { createBullmqCompileQueue } from "./queue/compile-queue";
import { createBullmqJobReader } from "./services/job-reader";
import { startCompileWorker } from "./workers/compile-worker";
import { parseRuntimeEnv, redisConnection } from "./env";

const ARTIFACT_PATH = resolve(
  process.cwd(),
  "../../output/pdf/phase3-ieee-citation-smoke.pdf",
);

describe.skipIf(process.env["DEPRESS_PHASE3_CITATION_SMOKE"] !== "1")(
  "Phase 3 IEEE citation round trip",
  () => {
    it("POST /compile → A B A IEEE project → Docker Typst → MinIO → signed PDF", async () => {
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

      const ast = {
        type: "doc" as const,
        metadata: { title: "Phase 3 IEEE Citation Smoke" },
        content: [
          {
            type: "paragraph" as const,
            content: [
              { type: "text" as const, text: "First source " },
              { type: "citation" as const, citeKey: "alpha2024" },
              { type: "text" as const, text: ", second source " },
              { type: "citation" as const, citeKey: "beta2025" },
              { type: "text" as const, text: ", first source again " },
              { type: "citation" as const, citeKey: "alpha2024" },
              { type: "text" as const, text: "." },
            ],
          },
        ],
      };
      const references = [
        {
          id: "beta2025",
          type: "book" as const,
          title: "Deterministic Book",
          author: [{ family: "Beta", given: "Bob" }],
          issued: { "date-parts": [[2025]] },
          publisher: "DePress Press",
        },
        {
          id: "unused",
          type: "document" as const,
          title: "Unused Reference",
        },
        {
          id: "alpha2024",
          type: "article-journal" as const,
          title: "Deterministic Article",
          author: [{ family: "Alpha", given: "Ada" }],
          issued: { "date-parts": [[2024]] },
          "container-title": "Journal of Compiler Systems",
          volume: "1",
          issue: "2",
          page: "1-9",
          DOI: "10.1000/depress.alpha",
        },
      ];

      // Source-level evidence: canonical citation sequence and cited-only YAML
      // order are deterministic before the real worker chain starts.
      const project = renderIeeeTypstProject({ ast, references });
      expect(project.main.match(/#cite\(label\("[^"]+"\)\)/g)).toEqual([
        '#cite(label("alpha2024"))',
        '#cite(label("beta2025"))',
        '#cite(label("alpha2024"))',
      ]);
      expect(project.main).toContain(
        '#bibliography("references.yml", title: [References], style: "ieee")',
      );
      const bibliography = project.bibliography ?? "";
      expect(bibliography.indexOf('"alpha2024":')).toBeLessThan(
        bibliography.indexOf('"beta2025":'),
      );
      expect(bibliography).not.toContain("unused");

      try {
        const post = await app.inject({
          method: "POST",
          url: "/compile",
          payload: { ast, references, templateId: "ieee", format: "pdf" },
        });
        expect(post.statusCode).toBe(202);
        const { jobId } = CompileResponseSchema.parse(post.json());

        let downloadUrl: string | undefined;
        const deadline = Date.now() + 110_000;
        while (Date.now() < deadline) {
          const response = await app.inject({
            method: "GET",
            url: `/jobs/${jobId}`,
          });
          expect(response.statusCode).toBe(200);
          const job = JobResponseSchema.parse(response.json());
          if (job.status === "failed") {
            throw new Error(`job failed: ${job.error}`);
          }
          if (job.status === "succeeded") {
            downloadUrl = job.downloadUrl;
            break;
          }
          await new Promise((resolvePoll) => setTimeout(resolvePoll, 1000));
        }
        expect(downloadUrl).toBeDefined();

        const pdfResponse = await fetch(downloadUrl as string);
        expect(pdfResponse.ok).toBe(true);
        const bytes = Buffer.from(await pdfResponse.arrayBuffer());
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
        await writeFile(ARTIFACT_PATH, bytes);
      } finally {
        await worker.close();
        await app.close();
      }
    }, 120_000);
  },
);
