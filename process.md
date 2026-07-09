# PROCESS.md — MVP Roadmap & State

## Status
- Current Phase: **2**
- Last Updated: 2026-07-05（Round-trip 接线完成；退出标准待真实链路 smoke 验收）

## Phase 1 — Editor Core & AST Contract
Goal: A working structured editor that emits validated AST JSON. No backend yet.
- Define `packages/ast`: Zod schemas for Doc, Heading(1-3), Paragraph, Citation, Figure, Table (stub)
- Scaffold monorepo (pnpm workspaces + turborepo)
- Next.js app shell + Tiptap editor with restricted schema
- Custom Citation node (inline, atom, stores `citeKey`)
- Zustand store: doc metadata, dirty state, autosave debounce (local only for now)
- Reference library panel (CRUD on local CSL-JSON, BibTeX import parser)
- **Exit criteria:** Export button dumps valid AST JSON matching Zod schema.

## Phase 2 — Compilation Engine
Goal: AST in → PDF out, one hardcoded template (IEEE).
- `ast-to-typst` transformer with snapshot tests
- IEEE template in Typst; parameterized injection points
- Fastify API: POST /compile, GET /jobs/:id
- BullMQ worker + Dockerized Typst sandbox
- S3 artifact storage + signed URLs
- **Exit criteria:** Round-trip demo — type in editor, download IEEE PDF.

## Phase 3 — Citation Engine & Multi-Template
Goal: Correct bibliographies in multiple strict styles.
- CSL processing: GB/T 7714-2015, IEEE numeric, Elsevier (APA-like) via citeproc/Typst
- DOI lookup (Crossref) → auto CSL-JSON
- Template #2 (Elsevier) + #3 (GB/T Chinese journal)
- Template switcher: same doc → different PDFs (the core demo moment)
- **Exit criteria:** One document exports to 3 journals with correct citations.

## Phase 4 — Persistence, Auth & Polish
Goal: Deployable portfolio product.
- Postgres persistence + document versioning
- Auth + multi-project workspace
- DOCX export path (Pandoc + reference.docx)
- Landing page, deploy (Vercel + Fly.io/Railway workers)
- **Exit criteria:** Public URL, signup → write → export works end-to-end.

## Phase 1 TODO
- [x] Init monorepo (pnpm, turbo, tsconfig strict, eslint, prettier)
- [x] `packages/ast`: node types + Zod schemas + unit tests
  - 硬性要求(Invariant #3 载体):① node type 区分必须用 `z.discriminatedUnion`,禁用 `z.union`;② TS 类型一律 `z.infer` 从 schema 导出,禁止手写 interface 双份维护;③ 测试必须含拒绝非法输入用例(heading level 4、citation 缺 citeKey 等)
- [x] Next.js app scaffold + layout shell
- [x] Tiptap setup with custom restricted schema (decided: keep semantic bold/italic, forbid font/size/color)
- [x] Citation inline node + insertion command (Cmd+Shift+C)
- [x] Reference library panel (in-memory) + BibTeX importer
- [x] "Export AST" debug button + Zod validation
- [x] Update process.md status when done

## Phase 2 TODO
- [x] `ast-to-typst` transformer with snapshot tests (`packages/transformers`; `astToTypst(unknown)` 内部 parseDoc 校验，citation → `#cite(<citeKey>)` 占位)
- [x] IEEE template in Typst; parameterized injection points (`@depress/templates` 内置 immutable IEEE_TEMPLATE，仅 {{TITLE}}/{{BODY}} 内容注入点；`renderIeeeTypstDocument(unknown)` 文本级 snapshot，无用户样式参数；title 暂用内部占位 "DePress Draft"，待 AST metadata)
- [x] Fastify API: POST /compile, GET /jobs/:id（`apps/api` `buildApp()` 不 listen、inject 可测；`createJobStore()` 每 app 实例内存 job，仅 `queued`；contract 全 Zod：ast=DocSchema、templateId=`"ieee"`、format=`"pdf"`，400 返回 issues，404 `JOB_NOT_FOUND`；无 transformer/Typst/artifact）
- [x] BullMQ worker + Dockerized Typst sandbox（`CompileQueue` 接口注入 `buildApp`，POST /compile 仅 enqueue（失败 503 QUEUE_UNAVAILABLE）；BullMQ producer/worker 懒加载 bullmq@^5.79，单测不碰 Redis；`processCompileJob(unknown)` 重新 Zod 校验 → `renderIeeeTypstDocument` → 注入式 sandbox，错误只回安全码 INVALID_AST/COMPILE_FAILED；Docker sandbox：`ghcr.io/typst/typst:0.15.0`、--network none/--read-only/--cap-drop ALL/mem/cpu/pids limit、mkdtemp 工作目录 finally 清理；真实 Docker smoke test 由 DEPRESS_DOCKER_SMOKE=1 门控；无 artifact/S3/signedUrl）
- [x] S3 artifact storage + signed URLs（Job contract 迁入 `@depress/ast`（Invariant #3）：`JobResponseSchema` 改 `z.discriminatedUnion`+`.strict()`，`downloadUrl` 仅 succeeded、`error` 仅 failed（安全码 INVALID_AST/COMPILE_FAILED/UPLOAD_FAILED/QUEUE_UNAVAILABLE），含负例测试；`apps/api/src/services/s3.ts`：AWS SDK v3，模块 init 时 Zod 校验 S3_BUCKET/REGION/KEYS fail-fast，client/presigner 可注入；worker 上传 `artifacts/{jobId}.pdf` 独立 try-catch → UPLOAD_FAILED，sandbox finally 清理不受影响（有测试证明）；GET /jobs/:id 读时现签 URL（固定 15min TTL，不持久化）；Vitest 全 mock S3，无真实 AWS）

- [x] Round-trip 接线（Phase 2 退出标准所需基建，非 Phase 4 部署）：job 状态回读**已决策为 API 直查 BullMQ state**（`services/job-reader.ts`：只读 Queue，state→JobResponseSchema 映射，corrupt returnvalue 降级 failed、failedReason 仅透传安全码；内存 store 降级为 dev/test seam）；`server.ts`（BullMQ producer + reader + S3 signer + @fastify/cors + listen :3001）与 `worker-main.ts` 入口（优雅关闭）；根目录 `docker-compose.yml`（Redis + MinIO，minio-init 双保险：service_healthy + mc 重试循环）+ `.env.example`；web 端 `ExportPdfButton` + `useCompileExport`（纯逻辑 `runCompileExport` 单测 mock fetch/clock：**发送前 pmDocToAst 清洗 + DocSchema 严格预检，失败不发请求**；2s 轮询 + **60s 硬超时**；响应全过 JobResponseSchema，成功自动触发下载）；全链路 smoke test 由 DEPRESS_ROUNDTRIP_SMOKE=1 门控（`roundtrip.smoke.test.ts`）
- **Exit criteria 验收**: 编辑器打字 → 下载 IEEE PDF 全链路跑通后，Phase 2 才算关闭。⚠️ 待办：开发机装 Docker 后执行 `docker compose up -d` + `DEPRESS_ROUNDTRIP_SMOKE=1 pnpm --filter @depress/api test` 完成真实链路验收（本机无 Docker，mock 测试全绿）

## Backlog
(Out-of-phase ideas go here — do not implement early.)
