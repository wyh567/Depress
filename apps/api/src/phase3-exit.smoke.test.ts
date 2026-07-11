import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JobResponseSchema,
  type CompileTemplateId,
} from "@depress/ast";
import { renderTypstProject } from "@depress/transformers";
import { buildApp } from "./app";
import { CompileResponseSchema } from "./contracts";
import { parseRuntimeEnv, redisConnection } from "./env";
import { createBullmqCompileQueue } from "./queue/compile-queue";
import { createBullmqJobReader } from "./services/job-reader";
import { startCompileWorker } from "./workers/compile-worker";

const TEMPLATE_IDS = ["ieee", "elsevier", "gbt7714"] as const satisfies readonly CompileTemplateId[];

const STYLE_BY_TEMPLATE = {
  ieee: 'style: "ieee"',
  elsevier: 'style: "elsevier-harvard"',
  gbt7714: 'style: "gb-7714-2015-numeric"',
} as const satisfies Record<CompileTemplateId, string>;

const ARTIFACT_PATHS = {
  ieee: resolve(process.cwd(), "../../output/pdf/phase3-exit-ieee.pdf"),
  elsevier: resolve(process.cwd(), "../../output/pdf/phase3-exit-elsevier.pdf"),
  gbt7714: resolve(process.cwd(), "../../output/pdf/phase3-exit-gbt7714.pdf"),
} as const satisfies Record<CompileTemplateId, string>;

const ast = {
  type: "doc" as const,
  metadata: {
    title: "Phase 3 Three-Template Exit Smoke",
    authors: [
      { name: "Ada Lovelace", affiliationIds: ["aff-en"] },
      { name: "张伟", affiliationIds: ["aff-zh"] },
    ],
    affiliations: [
      { id: "aff-en", name: "Computational Publishing Lab" },
      { id: "aff-zh", name: "数字出版研究中心" },
    ],
    abstract: "One semantic document is exported through all immutable Phase 3 templates.",
    keywords: ["citations", "templates", "smoke"],
  },
  content: [{
    type: "paragraph" as const,
    content: [
      { type: "text" as const, text: "Source A " },
      { type: "citation" as const, citeKey: "a" },
      { type: "text" as const, text: ", source B " },
      { type: "citation" as const, citeKey: "b" },
      { type: "text" as const, text: ", source A again " },
      { type: "citation" as const, citeKey: "a" },
      { type: "text" as const, text: ", and source C " },
      { type: "citation" as const, citeKey: "c" },
      { type: "text" as const, text: "." },
    ],
  }],
};

const references = [
  {
    id: "b",
    type: "article-journal" as const,
    title: "中文引用条目",
    author: [{ literal: "李华" }],
    issued: { "date-parts": [[2024]] },
    "container-title": "数字出版研究",
  },
  {
    id: "unused",
    type: "document" as const,
    title: "Unused reference must not be exported",
  },
  {
    id: "a",
    type: "article-journal" as const,
    title: "A Deterministic Citation",
    author: [{ family: "Lovelace", given: "Ada" }],
    issued: { "date-parts": [[2023]] },
    "container-title": "Journal of Reproducible Publishing",
  },
  {
    id: "c",
    type: "book" as const,
    title: "A Third Matching Reference",
    author: [{ family: "Turing", given: "Alan" }],
    issued: { "date-parts": [[2022]] },
    publisher: "DePress Press",
  },
];

async function waitForDownloadUrl(
  app: ReturnType<typeof buildApp>,
  jobId: string,
): Promise<string> {
  const deadline = Date.now() + 110_000;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
    expect(response.statusCode).toBe(200);
    const job = JobResponseSchema.parse(response.json());
    if (job.status === "failed") throw new Error(`job failed: ${job.error}`);
    if (job.status === "succeeded") return job.downloadUrl;
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 1000));
  }
  throw new Error("timed out waiting for compile job");
}

describe.skipIf(process.env["DEPRESS_PHASE3_EXIT_SMOKE"] !== "1")(
  "Phase 3 exit smoke (three immutable templates)",
  () => {
    it("exports the same AST and references through IEEE, Elsevier, and GB/T", async () => {
      const astSnapshot = structuredClone(ast);
      const referencesSnapshot = structuredClone(references);
      const payloads = TEMPLATE_IDS.map((templateId) => ({
        ast,
        references,
        templateId,
        format: "pdf" as const,
      }));

      for (const payload of payloads) {
        expect(payload.ast).toBe(ast);
        expect(payload.references).toBe(references);
        expect(payload.ast).toEqual(payloads[0]?.ast);
        expect(payload.references).toEqual(payloads[0]?.references);
        expect(payload.format).toBe("pdf");
      }
      expect(payloads.map((payload) => payload.templateId)).toEqual(TEMPLATE_IDS);

      const projects = payloads.map((payload) => ({
        templateId: payload.templateId,
        project: renderTypstProject(payload),
      }));
      for (const { templateId, project } of projects) {
        expect(project.main).toContain(STYLE_BY_TEMPLATE[templateId]);
        expect(project.main.match(/#cite\(label\("[^"]+"\)\)/g)).toEqual([
          '#cite(label("a"))',
          '#cite(label("b"))',
          '#cite(label("a"))',
          '#cite(label("c"))',
        ]);
        const bibliography = project.bibliography ?? "";
        const aIndex = bibliography.indexOf('"a":');
        const bIndex = bibliography.indexOf('"b":');
        const cIndex = bibliography.indexOf('"c":');
        expect(aIndex).toBeGreaterThanOrEqual(0);
        expect(bIndex).toBeGreaterThan(aIndex);
        expect(cIndex).toBeGreaterThan(bIndex);
        expect(bibliography).not.toContain("unused");
      }
      expect(new Set(projects.map(({ project }) => project.main)).size).toBe(3);

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

      try {
        const pdfHashes: string[] = [];
        for (const payload of payloads) {
          const post = await app.inject({ method: "POST", url: "/compile", payload });
          expect(post.statusCode).toBe(202);
          const { jobId } = CompileResponseSchema.parse(post.json());
          const downloadUrl = await waitForDownloadUrl(app, jobId);
          const pdfResponse = await fetch(downloadUrl);
          expect(pdfResponse.ok).toBe(true);
          const bytes = Buffer.from(await pdfResponse.arrayBuffer());
          expect(bytes.byteLength).toBeGreaterThan(0);
          expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
          const artifactPath = ARTIFACT_PATHS[payload.templateId];
          await mkdir(dirname(artifactPath), { recursive: true });
          await writeFile(artifactPath, bytes);
          pdfHashes.push(createHash("sha256").update(bytes).digest("hex"));
        }
        expect(new Set(pdfHashes).size).toBe(3);
      } finally {
        await worker.close();
        await app.close();
      }

      expect(ast).toEqual(astSnapshot);
      expect(references).toEqual(referencesSnapshot);
    }, 360_000);
  },
);
