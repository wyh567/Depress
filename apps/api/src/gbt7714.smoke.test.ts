import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JobResponseSchema } from "@depress/ast";
import { renderGbt7714TypstProject } from "@depress/transformers";
import { buildApp } from "./app";
import { CompileResponseSchema } from "./contracts";
import { createBullmqCompileQueue } from "./queue/compile-queue";
import { createBullmqJobReader } from "./services/job-reader";
import { startCompileWorker } from "./workers/compile-worker";
import { parseRuntimeEnv, redisConnection } from "./env";

const ARTIFACT_PATH = resolve(
  process.cwd(),
  "../../output/pdf/phase3-gbt7714-smoke.pdf",
);

describe.skipIf(process.env["DEPRESS_PHASE3_GBT7714_SMOKE"] !== "1")(
  "Phase 3 GB/T 7714 numeric round trip",
  () => {
    it("POST /compile → shared GB/T project → Docker Typst → MinIO → signed PDF", async () => {
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
        metadata: {
          title: "GB/T 7714 中文期刊真实链路验证",
          authors: [
            { name: "张三", affiliationIds: ["aff-1"] },
            { name: "Alice Brown", affiliationIds: ["aff-1", "aff-2"] },
          ],
          affiliations: [
            { id: "aff-1", name: "某大学心理学院" },
            { id: "aff-2", name: "Digital Health Laboratory" },
          ],
          abstract: "验证中文元数据、中英文作者、数字引用与完整日期。",
          keywords: ["抑郁症", "数字干预", "GB/T 7714"],
        },
        content: [
          {
            type: "paragraph" as const,
            content: [
              { type: "text" as const, text: "中文期刊 " },
              { type: "citation" as const, citeKey: "a" },
              { type: "text" as const, text: "，英文期刊 " },
              { type: "citation" as const, citeKey: "b" },
              { type: "text" as const, text: "，再次中文期刊 " },
              { type: "citation" as const, citeKey: "a" },
              { type: "text" as const, text: "，专著 " },
              { type: "citation" as const, citeKey: "c" },
              { type: "text" as const, text: "，会议论文 " },
              { type: "citation" as const, citeKey: "d" },
              { type: "text" as const, text: "，学位论文 " },
              { type: "citation" as const, citeKey: "e" },
              { type: "text" as const, text: "，网页 " },
              { type: "citation" as const, citeKey: "f" },
              { type: "text" as const, text: "。" },
            ],
          },
        ],
      };
      const references = [
        { id: "unused", type: "document" as const, title: "Unused Reference" },
        {
          id: "b",
          type: "article-journal" as const,
          title: "Digital Interventions for Depression",
          author: [{ family: "Smith", given: "Jane" }],
          issued: { "date-parts": [[2023]] },
          "container-title": "Journal of Mental Health Technology",
          volume: "12",
          issue: "4",
          page: "55-70",
          DOI: "10.5678/example.2023.004",
        },
        {
          id: "a",
          type: "article-journal" as const,
          title: "抑郁症数字干预的随机对照研究",
          author: [{ literal: "张三" }, { literal: "李四" }],
          issued: { "date-parts": [[2024]] },
          "container-title": "中华心理卫生杂志",
          volume: "38",
          issue: "2",
          page: "101-108",
          DOI: "10.1234/zhjr.2024.001",
        },
        {
          id: "c",
          type: "book" as const,
          title: "心理健康研究方法",
          author: [{ literal: "王五" }],
          publisher: "科学出版社",
          issued: { "date-parts": [[2022]] },
        },
        {
          id: "d",
          type: "paper-conference" as const,
          title: "面向心理健康的可解释模型",
          author: [{ literal: "赵六" }, { family: "Brown", given: "Alice" }],
          "container-title": "Proceedings of Digital Health",
          issued: { "date-parts": [[2021]] },
          page: "210-218",
        },
        {
          id: "e",
          type: "thesis" as const,
          title: "在线干预对大学生抑郁症状的影响",
          author: [{ literal: "陈七" }],
          publisher: "北京大学",
          issued: { "date-parts": [[2020]] },
        },
        {
          id: "f",
          type: "webpage" as const,
          title: "抑郁症信息与支持",
          author: [{ literal: "世界卫生组织" }],
          URL: "https://example.org/depression",
          issued: { "date-parts": [[2025, 6, 15]] },
        },
      ];

      const project = renderGbt7714TypstProject({ ast, references });
      expect(project.main).toContain('style: "gb-7714-2015-numeric"');
      expect(project.main).toContain("张三#super[1]");
      expect(project.main.match(/#cite\(label\("[^"]+"\)\)/g)).toEqual([
        '#cite(label("a"))',
        '#cite(label("b"))',
        '#cite(label("a"))',
        '#cite(label("c"))',
        '#cite(label("d"))',
        '#cite(label("e"))',
        '#cite(label("f"))',
      ]);
      const bibliography = project.bibliography ?? "";
      expect(bibliography).toContain("date: 2025-06-15");
      expect(bibliography.indexOf('"a":')).toBeLessThan(bibliography.indexOf('"b":'));
      expect(bibliography).not.toContain("unused");

      try {
        const post = await app.inject({
          method: "POST",
          url: "/compile",
          payload: { ast, references, templateId: "gbt7714", format: "pdf" },
        });
        expect(post.statusCode).toBe(202);
        const { jobId } = CompileResponseSchema.parse(post.json());

        let downloadUrl: string | undefined;
        const deadline = Date.now() + 110_000;
        while (Date.now() < deadline) {
          const response = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
          expect(response.statusCode).toBe(200);
          const job = JobResponseSchema.parse(response.json());
          if (job.status === "failed") throw new Error(`job failed: ${job.error}`);
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
