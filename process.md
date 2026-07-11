# PROCESS.md — MVP Roadmap & State

## Status
- Current Phase: **4**
- Phase 1: **COMPLETE**
- Phase 2: **COMPLETE**
- Phase 3: **COMPLETE**
- Phase 4: **IN PROGRESS**
- P4-00: **COMPLETE**
- P4-01: **NOT STARTED**
- Last Updated: 2026-07-11（P4-00 Architecture / Process / ADR documentation 完成；仅冻结 Phase 4 架构与范围，尚未实现 Phase 4 产品功能）

## Phase 1 — Editor Core & AST Contract
Goal: A working structured editor that emits validated AST JSON. No backend yet.
- Define `packages/ast`: Zod schemas for Doc, Heading(1-3), Paragraph, Citation, Figure, Table (stub)
- Scaffold monorepo (pnpm workspaces + turborepo)
- Next.js app shell + Tiptap editor with restricted schema
- Custom Citation node (inline, atom, stores `citeKey`)
- Zustand store: doc metadata, dirty state, autosave debounce (local only for now)
- Reference library panel (CRUD on local CSL-JSON, BibTeX import parser)
- **Exit criteria:** Export button dumps valid AST JSON matching Zod schema. ✅

## Phase 2 — Compilation Engine
Goal: AST in → PDF out, one hardcoded template (IEEE).
- `ast-to-typst` transformer with snapshot tests
- IEEE template in Typst; parameterized injection points
- Fastify API: POST /compile, GET /jobs/:id
- BullMQ worker + Dockerized Typst sandbox
- S3 artifact storage + signed URLs
- **Exit criteria:** Round-trip demo — type in editor, download IEEE PDF. ✅ **COMPLETE**

### Phase 2 Exit Criteria — 真实验收记录（2026-07-09）
开发机环境：WSL 2 + Docker Desktop（Client/Server 通信正常；`docker run --rm hello-world` 成功；`docker compose up -d` 成功；Redis healthy；MinIO healthy）。

验收命令：

```bash
DEPRESS_ROUNDTRIP_SMOKE=1 pnpm --filter @depress/api test
```

验收结果：

- Test Files: **7 passed**
- Tests: **47 passed**
- Skipped: **1**
- Round-trip smoke：**passed**

已验证真实链路：

AST → POST `/compile` → Fastify API → BullMQ → Redis → Compile Worker → AST→Typst → Docker Typst sandbox → real PDF → MinIO upload → GET `/jobs/:id` → signed download URL → PDF download → valid `%PDF-` verification

覆盖组件：Redis、MinIO、BullMQ、Docker Typst sandbox、PDF compilation、S3-compatible artifact upload、signed URL、valid PDF download。

已知边界（不阻断 Phase 2 关闭，转入 Phase 3）：

- smoke AST **未含 citation 节点**；bibliography 数据未进入 compile 边界（Phase 3）
- PDF title 仍为内部占位 `"DePress Draft"`（待 AST metadata）
- `.env.example` 曾在 TODO 中声明，仓库此前缺失；已补齐最小示例

## Phase 3 — Citation Engine & Multi-Template
Goal: Correct bibliographies in multiple strict styles.
- CSL processing: GB/T 7714-2015, IEEE numeric, Elsevier (APA-like) via citeproc/Typst
- DOI lookup (Crossref) → auto CSL-JSON
- Template #2 (Elsevier) + #3 (GB/T Chinese journal)
- Template switcher: same doc → different PDFs (the core demo moment)
- **Exit criteria:** One document exports to 3 journals with correct citations.

## Phase 4 — Public Persistence, Auth & Authorized Export

### Phase 4 Core

Goal: deliver one public, authenticated product path: **Public URL → signup/login → write → save → reload → cite → authenticated PDF export → authorized download**.

Core includes:

- persisted ProseMirror document envelope as the only editable canonical representation;
- deterministic semantic Doc AST as a derived compile projection;
- Project ownership boundary and one server-created default Project per user;
- Project-owned References and Project-owned Documents;
- Postgres business truth for Documents, References, Compile Jobs, artifact metadata, and outbox events;
- Better Auth with Postgres database sessions and first-party cookies;
- current document content/revision/hash plus sparse immutable checkpoints;
- target compile request `{ documentId, revision, templateId, format: "pdf" }`;
- immutable compile input snapshots and snapshot hashes;
- transactional outbox, idempotent BullMQ job IDs, and idempotent Workers;
- authenticated and owner-scoped Jobs, Artifacts, and signed download URLs;
- early CI baseline, production sandbox feasibility spike, later CD/deployment, security controls, and public exit smoke.

### Phase 4 Stretch

The following do not block Phase 4 COMPLETE:

- DOCX/Pandoc export;
- full version-history, comparison, restore, or recycle-bin UI;
- full multi-project workspace UI;
- complex marketing landing, SEO, blog, or analytics;
- collaboration, team sharing/RBAC, and advanced per-job VM isolation.

### Phase 4 scope note

P4-00 freezes architecture and scope only. It does not implement persistence, Auth, Postgres, the target compile path, CI, deployment, or any other Phase 4 product capability.

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
- [x] **Exit criteria 验收**: 编辑器打字 → 下载 IEEE PDF 全链路跑通。真实证据见上方「Phase 2 Exit Criteria — 真实验收记录（2026-07-09）」：`DEPRESS_ROUNDTRIP_SMOKE=1 pnpm --filter @depress/api test` → 7 files / 47 passed / 1 skipped；PDF `%PDF-` 验证通过。

## Phase 3 TODO

> 原则：schema-first；每个边界重新 Zod 校验；citation 只存 citeKey（Invariant #2）；模板不可变（Invariant #4）；DOI/网络不得进入 Typst sandbox（Invariant #5）。Figure/Table 实体化、Auth、Postgres **不在本阶段**。

### TODO #1 — Document metadata in AST
- [x] **COMPLETE (2026-07-10):** `DocMetadataSchema`（title/authors/affiliations/abstract/keywords，`.strict()`；affiliation id 唯一；author→affiliation 引用校验；keywords trim + 首次出现去重）；`DocSchema.metadata` **optional**（无 metadata 旧文档仍合法，IEEE title 回退 `"DePress Draft"`）；web `DocumentMetadataPanel` + Zustand draft → export/compile 合并进 AST；`renderIeeeTypstDocument` 使用 `metadata.title`。**未做** 完整 IEEE 作者/单位排版、bibliography（TODO #3）。
- **Goal:** Doc 携带 title / authors / affiliations / abstract / keywords；IEEE PDF 标题不再使用 `"DePress Draft"`。
- **Scope:** `DocSchema` 扩展 metadata（Zod + `z.infer`）；editor 最小 metadata 编辑/导出；`renderIeeeTypstDocument` 从 AST 读 title；更新 snapshot。
- **Files likely affected:** `packages/ast/src/schema.ts` (+tests)；`apps/web` editor export / 可选 metadata UI；`packages/transformers/src/render-ieee-typst-document.ts` (+snapshots)；`apps/api` 若依赖 Doc 形状的测试。
- **Data contract change:** `DocSchema` 增加 metadata 块。**Backward compat 决策：** `metadata` optional；title 缺省时 renderer 使用安全占位 `"DePress Draft"`（禁止静默丢字段）。
- **Test requirements:** AST 正/负例；export 含 metadata；IEEE render snapshot 断言真实 title；旧无-metadata fixture 行为符合决策。
- **Acceptance criteria:** 合法 Doc 可携带 metadata；IEEE 渲染输出含 AST title；无 font/color 等表现字段进入 schema。
- **Explicit non-goals:** 多作者复杂排版 UI；affiliations 脚注视觉微调；Postgres 持久化。
- **Dependencies:** 无（可与 #2 并行，但 #3 需要稳定 title 注入）。
- **Risks:** 破坏现有仅 `{type,content}` 的 Doc fixture；web/api/transformer 需同 PR 更新（Invariant #3）。

### TODO #2 — CSL schema expansion + bibliography compile contract
- [x] **COMPLETE (2026-07-09):** `CslItemSchema` 扩展 volume/issue/page/publisher/URL；`CompileRequestSchema` + `CompileJobPayloadSchema` 迁入 `@depress/ast` 并含必填 `references: CslItem[]`（`.strict()` + 拒绝重复 `id`）；Web `selectCitedReferences` 按文档 citeKey 首次出现序发送子集（重复折叠、无引用→`[]`、缺失→POST 前 validation_error）；`CitationNodeSchema`/`CslItem.id` 均 trim 保大小写；BibTeX 映射 volume/number→issue/pages→page/publisher/url→URL；API/Queue/Worker 每边界重校验。**未做** bibliography 渲染（TODO #3）。
- **Goal:** 足够支撑期刊参考文献的 CSL-JSON 子集；`references` 进入 Web→API→Queue→Worker 全链路；每边界 Zod 重校验；citeKey 可匹配 `CslItem.id`。
- **Scope:**
  1. 扩展 `CslItemSchema`（至少：volume、issue、page、publisher、URL；按需 language）；更新 BibTeX mapper。
  2. 将 `CompileRequestSchema` / `CompileJobPayloadSchema` **迁入 `@depress/ast`**（纠正当前契约住在 `apps/api` 的 Invariant #3 漂移）。
  3. payload 增加 `references: CslItem[]`（或 `z.array(CslItemSchema)`）；web `compile-export` 发送**文档实际引用到的** references 子集；worker 重 parse。
- **Files likely affected:** `packages/ast/src/csl.ts`、`job`/`compile` 新契约文件；`apps/api/src/contracts.ts`、`queue/compile-queue.ts`、routes、worker tests；`apps/web/components/editor/compile-export.ts`、`stores/reference-library.ts`、`bibtex-to-csl.ts`。
- **Data contract change:** 破坏性扩展 compile body（旧客户端无 references → 400）；**`references` 必填**（无引用发 `[]`）；存在 citeKey 而无匹配 reference 时 **Web 本地失败不发 POST**。
- **Test requirements:** CSL 新字段正/负例；compile 契约单测；queue payload round-trip；web POST body 含 references；**禁止**把渲染后的 “[1]” 写入 AST。
- **Acceptance criteria:** 同一 `CslItem[]` 从 web 到 worker 无损；worker `safeParse` 失败 → `INVALID_AST`；未知 template 仍 400。
- **Explicit non-goals:** 实际 bibliography 排版（#3）；DOI 网络（#4）；多模板（#5–#7）。
- **Dependencies:** 无硬依赖 #1；**阻塞 #3–#7**。
- **Risks:** payload 变大；citeKey 大小写/trim 一致性；只发子集时漏引。

### TODO #3 — IEEE citation & bibliography engine
- [x] **COMPLETE (2026-07-10):** Shared compile schemas enforce citation/reference integrity; the pure transformer selects the cited subset in first-occurrence order and serializes deterministic Hayagriva YAML; the immutable IEEE Typst project emits `main.typ` plus optional fixed `references.yml`; the hardened Docker sandbox compiles the fixed entrypoint; worker upload/signing behavior is unchanged. Missing references are `400 VALIDATION_ERROR` at the API and existing `INVALID_AST` for corrupt queue data. Unused references are accepted but omitted. Repeated keys reuse the same IEEE number. Citation-free documents create neither a sidecar nor a References heading.
- **Goal:** IEEE numeric 正文引用 + 参考文献列表；确定性输出；真实 PDF 可抽检。
- **Technical spike decision (2026-07-10, implemented):** Choose one engine only: a generated, fixed-name Hayagriva YAML sidecar (`references.yml`) consumed by Typst's built-in `#bibliography(..., style: "ieee")`. The pinned and locally installed sandbox image is `ghcr.io/typst/typst:0.15.0` (reported `typst 0.15.0`; local digest `sha256:b23ba03da5c085a2c8780bc9f2296db937abe1d0c75348cf2f8a9273199c3a14`). Official Typst 0.15 documentation confirms `.yaml`/`.yml` and BibLaTeX inputs, built-in IEEE style, explicit `#cite(label(...))`, and cited-only bibliography output: https://typst.app/docs/reference/model/bibliography/ and https://typst.app/docs/reference/model/cite/. A real pinned-image probe proved first-occurrence numbering (`A B A` → `[1] [2] [1]`), cited-order bibliography output, Unicode-safe parsing, and direct canonical keys for `smith2024`, `Smith2024`, `zhang-2025`, `paper_01`, `中文文献`, `key.with.dots`, `key/with/slash`, and `key"quote`; therefore no internal citeKey mapping is required. Hayagriva was selected over BibLaTeX because it is Typst-native, has structured people/parent/DOI fields, and requires no TeX escaping; inline raw bibliography bytes were rejected because they remain Hayagriva with an extra Typst-string escaping layer; a hand-built Typst bibliography was rejected because it would duplicate CSL/IEEE numbering and formatting. Current image limitation: it contains no CJK font, so Chinese YAML is preserved and compiles, but visible Chinese glyph coverage is not claimed by this TODO.
- **Real smoke evidence (2026-07-10):** `docker compose up -d` reported Redis and MinIO healthy. Existing round trip: 1/1 passed in 1.668 s (Vitest duration 3.28 s). Citation-aware round trip with `DEPRESS_PHASE3_CITATION_SMOKE=1`: 1/1 passed in 1.625 s (Vitest duration 3.21 s), downloaded a 19,403-byte `%PDF-` artifact to `output/pdf/phase3-ieee-citation-smoke.pdf`. Manual PNG inspection visibly confirmed body `[1] [2] [1]`, bibliography `[1] A` then `[2] B`, and no unused entry. Gated Docker serializer smoke compiled all seven CSL types and every required citeKey in 0.544 s.
- **Final validation (2026-07-10):** `pnpm lint` 5/5 tasks passed (Turbo 1.925 s); `pnpm typecheck` 5/5 tasks passed (Turbo 2.792 s); `pnpm test` 24 test files passed and 2 gated files skipped, with 232 tests passed and 4 gated tests skipped (Turbo 3.462 s). Package counts: `@depress/ast` 68/68; `@depress/transformers` 34/34; `@depress/web` 71/71; `@depress/api` 59 passed / 4 gated skipped. `@depress/templates` has no test script.
- **Scope:** worker/transformer 将 `references` 转为 Typst 可消费书目（Hayagriva YAML / Typst bibliography 文件等——实现时选定一种并写死）；IEEE 模板增加 bibliography 挂载点；missing/duplicate citation 行为明确；snapshot + 可选 smoke（含 citation 节点）。
- **Files likely affected:** `packages/transformers`；`packages/templates/src/ieee.ts`；`apps/api/src/workers/compile-processor.ts`、`typst-sandbox.ts`（多文件写入工作目录）；tests/snapshots；可选扩展 `roundtrip.smoke.test.ts`。
- **Data contract change:** 无新 HTTP 字段（消费 #2）；模板仍不可用户编辑。
- **Test requirements:** transformer/bibliography **snapshot 必测**；missing citeKey、重复引用、顺序确定性；sandbox 多文件 compile；单测无网络。
- **Acceptance criteria:** 含 citation 的 Doc + matching references → IEEE PDF 中可见编号引用与参考文献条目；无 matching reference 的行为符合文档（失败码或明确省略，禁止崩溃泄露路径）。
- **Explicit non-goals:** Elsevier/GB/T 样式；DOI；模板切换 UI。
- **Dependencies:** **必须先完成 #2**；#1 强烈建议先完成（封面信息）。
- **Risks:** Typst 0.15 bibliography 能力边界；中文作者；与未来 citeproc 双栈（若 #6 需要 Pandoc）。

### TODO #4 — DOI lookup (Crossref → CSL-JSON)
- [x] **COMPLETE (2026-07-10):** Web → Fastify 薄 BFF → 固定源 Crossref；`POST /references/doi/lookup`；`normalizeDoi`（ASCII 小写规范形，DOI Handbook 大小写不敏感 + Crossref 可访问性建议）；`CslItem.id`/`DOI` = 规范化 DOI；同 id / 同 DOI 不覆盖（`tryAdd` + 请求前后双重检测）；provider Zod 仅校验消费字段；`crossrefWorkToCslItem` 纯映射；安全错误码；单测全 mock。**未做** 标题/作者搜索、批量 DOI、持久化。
- **Decision log:**
  - **BFF:** `apps/api` 代理 Crossref（浏览器不直连）；非 compile job；不进 worker/sandbox。
  - **Route:** `POST /references/doi/lookup` body `{ doi }`（`.strict()`）。
  - **Origin:** `https://api.crossref.org`（代码常量）；仅 `encodeURIComponent(doi)` 进 path。
  - **Case policy:** 去前缀后对 Basic Latin 做 ASCII lower；最大输入 512。
  - **Timeout / retry:** 8s/次 AbortController；最多 2 次；仅网络错误 / 429 / 5xx；Retry-After 封顶 2s。
  - **mailto:** 可选 `CROSSREF_MAILTO`（非密钥；生产建议设置 polite pool）。
  - **Type map:** journal-article→article-journal；book/monograph/reference-book→book；book-chapter→chapter；proceedings-article→paper-conference；dissertation→thesis；**posted-content→document**（预印本/eprint，不用 webpage，避免 Hayagriva Web 误导）；未知→document。
  - **Date precedence:** published-print → published-online → published → issued。
  - **Errors:** INVALID_DOI / DOI_NOT_FOUND / CROSSREF_TIMEOUT / CROSSREF_RATE_LIMITED / CROSSREF_UNAVAILABLE / INVALID_CROSSREF_METADATA（无上游原文泄露）。
  - **Tests:** ast/api/web 定向单测通过；`pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿；live smoke `DEPRESS_CROSSREF_SMOKE=1` 对 `10.1037/0003-066x.59.1.29` 通过。
- **Goal:** 用户输入 DOI → 规范化 → Crossref → 校验 → 映射为 `CslItem` → 写入 reference library。
- **Scope:** web（或薄 BFF）Crossref client；timeout/retry；可读错误；fixture 驱动单测（**单测禁止真实网络**）；不在 Typst sandbox 内发请求。
- **Files likely affected:** `apps/web/components/library/*`；可选 `apps/api` 代理路由（若需躲 CORS）；`packages/ast` 仅当映射需要新字段。
- **Data contract change:** 无 compile 契约变更；库内仍 `CslItemSchema`。
- **Test requirements:** DOI 规范化用例；Crossref fixture → CSL 映射；超时/4xx/5xx；schema 拒绝坏数据。
- **Acceptance criteria:** 合法 DOI 可一键入库且 `id` 稳定可作 citeKey；失败有用户可读原因。
- **Explicit non-goals:** 付费 Crossref Plus；批量抓取；sandbox 联网。
- **Dependencies:** #2 的 CSL 字段扩展（否则映射会再次丢字段）。
- **Risks:** Crossref 模式漂移；rate limit；DOI 与手工 id 冲突。

### TODO #5 — Elsevier template (immutable)
- [x] **COMPLETE (2026-07-10):** Shared `CompileTemplateIdSchema` now accepts only `"ieee" | "elsevier"`; `renderTypstProject` validates once, collects citeKeys once, selects cited references in first-occurrence order once, and serializes one deterministic Hayagriva sidecar before exhaustively dispatching to immutable IEEE or Elsevier renderers. `renderIeeeTypstProject` remains a compatibility wrapper.
  - **Elsevier:** immutable, single-column author-date manuscript asset; exact Typst style `elsevier-harvard`; title/authors/affiliations/abstract/keywords are semantic AST content only. Missing optional sections are omitted, legacy documents fall back to `"DePress Draft"`, missing cited references are rejected, citation-free documents mount no bibliography, and unused references are omitted.
  - **CJK support:** the pinned `ghcr.io/typst/typst:0.15.0` image is given a fixed read-only, code-owned `Noto Sans CJK SC` fallback font (SIL OFL 1.1); compile input cannot choose fonts or paths. This preserves Chinese semantic content in generated PDFs.
  - **Validation:** lint 5/5 packages; typecheck 5/5 packages; full test suite 36 files (32 passed, 4 skipped), 312 passed tests, and 6 opt-in tests skipped by default. One-time real-chain smokes passed for IEEE round trip (1.58s), IEEE citations (1.55s), and Elsevier (1.63s): Fastify → BullMQ/Redis → worker → Typst 0.15 → MinIO → signed download → `%PDF-`. Local validation only: this Windows host reserved Compose ports 9000/9001, so the smoke MinIO endpoint temporarily used port 9100; default Compose ports and production configuration were unchanged.
  - **Artifact + visual inspection:** `output/pdf/phase3-elsevier-smoke.pdf` (23,504 bytes) visually inspected after Poppler rendering: single-column layout, title, ordered authors/affiliations, Abstract, Keywords, author-date citations, cited-only References, Chinese glyphs, and no clipping, overlap, or unresolved placeholders.
  - **Limitations:** no user-controlled template/style/layout fields; web remains fixed at `templateId: "ieee"` with `Export PDF (IEEE)`; template-selection UI remains TODO #7.
### TODO #6 — GB/T 7714-2015
- [x] **COMPLETE (2026-07-11):** Native Typst route approved by a pinned `ghcr.io/typst/typst:0.15.0` technical spike and implemented as the third immutable shared-contract template: `CompileTemplateIdSchema` accepts only `"ieee" | "elsevier" | "gbt7714"`; `renderTypstProject` still validates once, collects citeKeys once, selects the first-occurrence cited subset once, serializes one deterministic Hayagriva sidecar once, then exhaustively dispatches to IEEE, Elsevier, or GB/T.
  - **GB/T renderer:** code-owned A4, single-column Chinese manuscript asset with fixed typography and the existing read-only `Noto Sans CJK SC` fallback. Semantic AST metadata supplies title, ordered authors and affiliations, affiliation markers, 摘要, 关键词, body, and only an optional bibliography. The exact fixed Typst style is `gb-7714-2015-numeric`; no user-controlled style, Typst, CSL, font, or layout was added. Citation-free documents mount no bibliography; missing cited references remain rejected; unused references are omitted; the shared order is first citation occurrence.
  - **Bibliography data:** the shared deterministic Hayagriva serializer now preserves the first valid `issued.date-parts` tuple as `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`, including zero-padded month/day. The sampled native path covers article-journal, book, paper-conference, thesis, and webpage references, including Chinese literal and mixed-script authors.
  - **Architecture:** no Pandoc, citeproc, vendored CSL, package dependency, Docker image, Compose default, sandbox policy, worker production branch, or Web template-selector work was introduced. API and queue use the shared schema; worker compilation remains generic.
  - **Validation:** lint 5/5 packages; typecheck 5/5 packages; full test suite 33 files passed, 324 tests passed, 7 opt-in tests skipped by default. Real-chain smokes passed: IEEE round trip (1.654s), IEEE citations (1.593s), Elsevier (1.574s), and GB/T (1.566s): Fastify → BullMQ/Redis → worker → pinned Typst 0.15 Docker sandbox → MinIO → signed URL → `%PDF-`. Local validation used `S3_ENDPOINT=http://localhost:9100` only because ports 9000/9001 were reserved; Compose defaults were unchanged.
  - **Artifact + visual inspection:** `output/pdf/phase3-gbt7714-smoke.pdf` (49,173 bytes) was rendered and opened. It shows the A4 one-column layout, Chinese title, Chinese and English authors, affiliations, 摘要, 关键词, stable numeric A-B-A-C citations, cited-only numbered 参考文献, all five sampled source categories, full webpage date `2025-06-15`, CJK glyphs, and no clipping, overlap, tofu, or unresolved placeholders.
  - **Limitation:** key-rule validation is sampled; complete normative GB/T punctuation conformance is not claimed.

### TODO #7 — Template switcher + Phase 3 exit smoke
- [x] **COMPLETE (2026-07-11):** Web 模板切换 + Phase 3 exit smoke。`ExportPdfButton` 使用**本地** `templateId` state（默认 `ieee`）；选项 `ieee` / `elsevier` / `gbt7714`；类型来自 `@depress/ast` 的 `CompileTemplateId`；DOM 值经 `CompileTemplateIdSchema.safeParse`，未知值不进入请求；`runCompileExport` 的 `templateId` **必填**；POST 前 `CompileRequestSchema` 最终重校验。模板选择**不进入** AST / metadata / references / Tiptap JSON / Zustand document state。
  - **Acceptance（仓库原文）:** 不改正文 AST，仅切换模板，得到三份版式不同、引用正确的 PDF。
  - **非目标 / 非 blocker:** IEEE 完整 authors / affiliations / abstract / keywords 排版属于 TODO #1 已知范围（当时仅要求 `metadata.title`），**不是** TODO #7 验收项，**不是** Phase 3 exit blocker，**不是**回归。
  - **Phase 3 exit smoke (`DEPRESS_PHASE3_EXIT_SMOKE=1`):** 同一 AST + 同一 references，仅 `templateId` 改变，顺序 ieee → elsevier → gbt7714。真实链路：Fastify → BullMQ → Redis → Worker → generic renderer → Typst 0.15 Docker sandbox → MinIO → signed URL → PDF。三份均 `%PDF-`；字节 IEEE 24,611 / Elsevier 24,643 / GB/T 26,477；三份 SHA-256 不同（字节/哈希差异 ≠ 视觉验证声明）。AST 与 references 未修改。
  - **视觉抽检（人工）:**
    - **IEEE:** title 可见；body 可见；数字 citation `[1] [2] [1] [3]`；编号 References 可见；中文 reference glyph 正常；unused reference 未出现；无 tofu / 裁切 / 重叠 / placeholder。**已知范围：** 完整 IEEE authors、affiliations、abstract、keywords 排版不在 TODO #7 / Phase 3 exit 范围内（TODO #1 仅注入 title）。
    - **Elsevier:** 单栏 author-date manuscript；authors / affiliations / Abstract / Keywords 可见；author-date citations 可见；References 可见；unused reference 未出现；无 tofu / 裁切 / 重叠 / placeholder。
    - **GB/T:** A4 单栏；authors / affiliations / 摘要 / 关键词可见；数字 citations 可见；参考文献可见；unused reference 未出现；无 tofu / 裁切 / 重叠 / placeholder。**限制：** 使用 Typst 0.15 内置 `gb-7714-2015-numeric`；已通过项目支持来源类型与关键规则抽样验证；**不宣称**完全符合 GB/T 7714-2015 全部规范或全部标点细节。
  - **最终验证（TODO #7 合入前）:** `pnpm lint` 5/5 tasks passed；`pnpm typecheck` 5/5 tasks passed；`pnpm test` 33 files passed / 6 skipped，330 tests passed / 8 skipped；真实 Phase 3 exit smoke 1 file passed / 1 test passed。
- **Goal:** 同一文档一键导出 IEEE / Elsevier / GB/T 三份 PDF；满足 Phase 3 退出标准。
- **Scope:** web template 选择 UI（最小：下拉/按钮组）；`compile-export` 传所选 `templateId`；按钮文案不再写死 IEEE；exit smoke：同一 fixture 三角导出 + 引用抽检。
- **Files likely affected:** `apps/web/components/editor/*`；`compile-export.ts`；api 已支持三 id；`process.md` 关闭 Phase 3。
- **Data contract change:** 无（消费既有 union）。
- **Test requirements:** UI/hook 单测；契约；可选 `DEPRESS_ROUNDTRIP_SMOKE` 扩展或独立 `DEPRESS_PHASE3_EXIT_SMOKE`。
- **Acceptance criteria:** 不改正文 AST，仅切换模板，得到三份版式不同、引用正确的 PDF。
- **Explicit non-goals:** 模板市场上传；逐页视觉回归平台；IEEE 完整 metadata 封面排版。
- **Dependencies:** #2–#6 全部完成。
- **Risks:** 三角导出超时；UI 误引入样式控件（违反 Invariant #1）。

### Phase 3 推荐实施顺序
1. **先做 TODO #2**（bibliography contract + CSL 扩展）——当前最大阻塞。
2. TODO #1（metadata）可与 #2 并行。
3. TODO #3（IEEE bib engine）——第一个可见“正确引用”里程碑。
4. TODO #4（DOI）——不阻塞 #3，可与 #3 尾部并行。
5. TODO #5 → #6 → #7。

### Phase 3 Exit Criteria
同一篇结构化文档（不改正文 AST）导出 IEEE + Elsevier + GB/T 三份 PDF，正文引用与参考文献列表正确。**已满足（2026-07-11）** — Phase 3 **COMPLETE**；Current Phase 已进入 **4**，Phase 4 当前为 **IN PROGRESS**（P4-00 文档冻结已完成；产品功能尚未实现）。

## Phase 4 TODO

### P4-00 — Architecture / Process / ADR documentation

- [x] **COMPLETE (2026-07-11)**
- **Goal:** Freeze Phase 4 Core/Stretch scope, canonical data boundaries, ownership, versioning, compile snapshot consistency, Auth direction, provisional sandbox topology, dependency graph, implementation order, and exit criteria.
- **Scope:** `architecture.md`, `process.md`, and ADR 0001–0007 only.
- **Explicit non-goals:** CI implementation; sandbox execution; production deployment; Auth; Postgres; migrations; API, Queue, Worker, or Web features.
- **Acceptance:** Phase 4 is `IN PROGRESS`; P4-00 is complete; all product tasks remain not started; the seven ADRs record six Accepted decisions and one Proposed topology.
- **Result:** Architecture and scope are frozen. No Phase 4 product capability is implemented by this TODO.

### P4-01 — CI baseline

- [ ] **NOT STARTED**
- **Goal:** Establish an early, repeatable pull-request quality baseline.
- **Scope:** GitHub Actions on Linux running frozen install, lint, typecheck, default tests, and build.
- **Explicit non-goals:** CD, production migrations, deployment, rollback, or default execution of real Docker/Crossref/infrastructure smoke tests.
- **Acceptance:** Every PR runs the four baseline gates; existing opt-in smoke tests remain skipped unless explicitly enabled.

### P4-02 — Production Docker sandbox technical spike

- [ ] **NOT STARTED**
- **Goal:** Prove or reject the provisional dedicated-Linux-VM sandbox topology before Auth implementation.
- **Scope:** Non-production Linux environment; current fixed Typst image; Docker isolation flags; CPU/memory/pids/time limits; concurrency; restart/retry; cleanup; fonts; object-storage connectivity; API/Worker privilege separation.
- **Explicit non-goals:** Production deployment, formal domain, production users/data, or accepted selection of any infrastructure provider.
- **Acceptance:** ADR 0007 becomes Accepted only with reproducible evidence; failure changes it to Superseded and requires a replacement topology decision.

### P4-03 — Shared persisted and API contracts

- [ ] **NOT STARTED**
- **Goal:** Add shared target schemas without interrupting the Phase 3 export path.
- **Scope:** Persisted PM document envelope, restricted PM nodes/marks, document/reference persistence contracts, target compile request, immutable compile snapshot, minimal Queue payload, Job and Artifact responses; organize new schemas inside `packages/ast` by domain.
- **Explicit non-goals:** Renaming `packages/ast`, splitting `@depress/contracts`, database implementation, or removing the existing raw AST compile contract.
- **Additive migration guardrail:** P4-03 adds target schemas only. It must not delete or disable the current Phase 3 raw AST Web/API/Queue/Worker contract. The current PDF export chain remains operational until the full replacement is complete and verified in P4-09.
- **Acceptance:** Shared schemas reject presentation fields and are consumable by both existing and target paths.

### P4-04 — Postgres and migration foundation

- [ ] **NOT STARTED**
- **Goal:** Implement the logical ownership, persistence, snapshot, Job, Artifact, and outbox model in Postgres.
- **Scope:** Physical schema decision, migrations, constraints, indexes, fresh-database migration validation, connection lifecycle.
- **Explicit non-goals:** Locking the ORM or database vendor in P4-00; production auto-migration on application boot; full history or multi-project UI.
- **Decision boundary:** P4-04 selects the physical representation while preserving the ADR ownership relationships, source-of-truth boundaries, invariants, and consistency model.
- **Acceptance:** A fresh database can apply all migrations; Postgres can represent current Documents, sparse checkpoints, Project References, compile snapshots, Jobs, Artifacts, and outbox events.

### P4-05 — Better Auth implementation spike and integration

- [ ] **NOT STARTED**
- **Goal:** Establish validated database sessions and the User ownership root after P4-02 succeeds.
- **Scope:** Better Auth, Postgres sessions, HttpOnly/Secure/SameSite cookie, same-origin proxy, session validation, owner derivation, idempotent default Project creation.
- **Implementation-spike decisions:** email/password versus OAuth, email verification policy, and any transactional email provider.
- **Explicit non-goals:** anonymous compile, organizations, team RBAC, or full multi-project UI.
- **Acceptance:** Protected routes reject anonymous requests; a valid session maps to exactly one ownership identity and one default Project.

### P4-06 — Document and Project Reference persistence

- [ ] **NOT STARTED**
- **Goal:** Persist and authorize editable Documents and Project References.
- **Scope:** create/list/load/save/soft-delete Documents; current content/revision/hash; optimistic concurrency; sparse creation/explicit/on-demand checkpoints; Reference CRUD and conflicts.
- **Explicit non-goals:** checkpoint per autosave, periodic checkpoint schedule, full history UI, complex restore UI, recycle bin, or recovery guarantee.
- **Acceptance:** An owner can save and reload the same PM envelope and References; cross-owner access fails; revision conflicts never silently overwrite data.

### P4-07 — Web save, load, reload, and autosave

- [ ] **NOT STARTED**
- **Goal:** Connect the current editor, metadata, document list, and reference library to the persistence APIs.
- **Scope:** create/select/load, debounced autosave, dirty/saving/saved/error states, revision conflict handling, and compile-time save flushing.
- **Explicit non-goals:** offline-first, collaboration, CRDT, or full workspace UI.
- **Acceptance:** Browser reload and re-login preserve PM content, metadata, References, and citation citeKeys; export never submits while a required save has failed.

### P4-08 — Compile snapshot and transactional outbox

- [ ] **NOT STARTED**
- **Goal:** Reliably turn an authenticated document-revision request into an immutable DB snapshot and an idempotently enqueued minimal BullMQ Job.
- **Scope:** target request `{ documentId, revision, templateId, format: "pdf" }`; authentication; owner and exact-revision checks; persisted-envelope validation; semantic Doc AST projection; cited Project Reference resolution; immutable `compile_jobs.input_snapshot`; `snapshot_hash`; initial Compile Job row; transactional enqueue outbox; dispatcher; `{ jobId, snapshotHash }` Queue payload; idempotent BullMQ Job ID; enqueue retry and reconciliation.
- **Dependencies:** P4-03 contracts and P4-06 persisted Document/Reference backend. P4-07 may proceed in parallel but is not required to prove reliable enqueue.
- **Consistency:** DB success plus BullMQ failure leaves a retryable outbox event. BullMQ success plus DB queued-update failure retries the same BullMQ Job ID and never moves a later DB state backwards.
- **Explicit non-goals:** Worker Postgres load or DB claim; Worker retry; terminal success/failure writes; Typst execution; Artifact persistence; signed URL authorization; Web final compile migration; raw AST public endpoint removal.
- **Additive migration:** The current Phase 3 raw AST export path remains operational. P4-08 must not delete or disable the old public raw compile contract.
- **Acceptance:** The new target Compile API can reliably create one validated immutable snapshot, initial Compile Job, and outbox event and can idempotently deliver `{ jobId, snapshotHash }` to BullMQ. Document/Reference changes after acceptance cannot mutate the stored snapshot.

### P4-09 — Worker, Job, Artifact persistence and final cutover

- [ ] **NOT STARTED**
- **Goal:** Complete and validate the Queue-to-authorized-download replacement chain, migrate the Web, and perform the final additive cutover.
- **Scope:** Queue payload validation; Worker load of the trusted Compile Job and `input_snapshot` from Postgres; snapshot-hash verification; atomic DB claim; idempotent Worker retry; Postgres terminal Job truth; Typst Docker compile; deterministic S3 object key; Artifact row and checksum/expiry metadata; idempotent success/failure writes; owner-scoped Job reads; owner-scoped short-lived Artifact download URLs; Web export migration to `{ documentId, revision, templateId, format: "pdf" }`; consumption of P4-07 export-before-save flush behavior; real replacement-chain PDF, cross-user authorization, and retry/idempotency validation.
- **Dependencies:** P4-07 Web save/load and export-flush capability plus P4-08 snapshot/outbox/Queue delivery.
- **Explicit non-goals:** permanent artifact retention or public bucket access.
- **Final cutover gate:** Only after the Web target request, API snapshot, outbox, BullMQ, Worker, DB Job lifecycle, Artifact persistence, and authorized PDF download replacement chain all pass may the old public raw AST compile contract be removed. An intermediate export outage is forbidden.
- **Acceptance:** The full replacement chain produces a real authorized PDF from the exact immutable snapshot; Postgres is terminal Job truth; retries and duplicate delivery create no second logical compile; cross-user Job and Artifact access fails; the Web no longer depends on the raw AST public contract before that contract is removed.

### P4-10 — Production security, health, and lifecycle controls

- [ ] **NOT STARTED**
- **Goal:** Add the minimum public-product safeguards.
- **Scope:** authenticated compile, rate and size limits, per-user active-job limits, Worker concurrency, request/sandbox timeouts, exact origin/CSRF policy, secret management, log redaction, safe error codes, liveness/readiness, artifact `expires_at`, scheduled cleanup, object-delete retry, and S3 lifecycle backstop.
- **Explicit non-goals:** enterprise WAF/compliance, 30-day recovery guarantee, recycle-bin UI, or a complex deletion workflow.
- **Acceptance:** Abuse controls and cleanup are testable; expired artifacts become unavailable and object deletion retries safely.

### P4-11 — CD, production migrations, deployment, and rollback

- [ ] **NOT STARTED**
- **Goal:** Deploy the verified product topology safely after Core services are ready.
- **Scope:** migration gate, versioned deployment, secrets, health gate, post-deploy smoke, rollback, and operational runbook.
- **Explicit non-goals:** changing the P4-02 spike into production without its go decision; auto-migration on application boot; multi-region HA.
- **Acceptance:** A failed migration or health check prevents traffic cutover; application rollback and forward-compatible migration strategy are rehearsed.

### P4-12 — Public exit E2E and minimal landing

- [ ] **NOT STARTED**
- **Goal:** Prove the complete public product path and close Phase 4.
- **Scope:** minimal public entry and Auth navigation; automated persistence/export/authorization checks; real signup smoke; artifact validation; manual PDF visual inspection; test-data cleanup.
- **Explicit non-goals:** complex marketing landing, SEO campaign, blog, or analytics.
- **Acceptance:** All Phase 4 exit criteria below pass against the public deployment.

### Phase 4 Dependency Graph

```text
P4-00 Architecture / Process / ADR freeze
   |
   +--> P4-01 CI baseline
   |
   +--> P4-02 sandbox technical spike
   |       |
   |       +------------------------------+
   |                                      |
   +--> P4-03 shared contracts            |
           |                              |
           +--> P4-04 Postgres/migrations |
                    |                     |
                    +--> P4-05 Auth <------+
                             |
                             +--> P4-06 Document/Reference persistence
                                      |
                                      +--> P4-07 Web save/load/flush -----+
                                      |                                  |
                                      +--> P4-08 snapshot/outbox/Queue ---+
                                                                         |
                                                                         v
                                                          P4-09 Worker/Jobs/Artifacts/cutover
                                                                         |
                                                                         v
                                                          P4-10 security/lifecycle
                                                                         |
P4-01 ------------------------------------------------------------------+
P4-02 ------------------------------------------------------------------+
                                                                         v
                                                          P4-11 CD/deployment
                                                                         |
                                                                         v
                                                          P4-12 public exit E2E
```

### Phase 4 Implementation Order

1. P4-00 — Architecture / Process / ADR documentation.
2. P4-01 — CI baseline.
3. P4-02 — Production Docker sandbox technical spike.
4. P4-03 — Shared persisted/API contracts.
5. P4-04 — Postgres and migration foundation.
6. P4-05 — Better Auth implementation spike and integration.
7. P4-06 — Document and Project Reference persistence.
8. P4-07 — Web save/load/reload/autosave.
9. P4-08 — Compile snapshot, transactional outbox, and Queue delivery.
10. P4-09 — Worker, Job, Artifact persistence and final cutover.
11. P4-10 — Production security, health, and lifecycle controls.
12. P4-11 — CD, production migrations, deployment, and rollback.
13. P4-12 — Public exit E2E and minimal landing.

P4-01 begins immediately after the documentation freeze. P4-02 must finish before P4-05 starts. P4-03 may overlap the tail of P4-02, but Auth implementation may not. P4-07 owns save/load and export flushing. P4-08 depends on the P4-06 persisted Document/Reference backend and may overlap P4-07. P4-09 depends on both P4-07 and P4-08 and exclusively owns the final Web/Worker/Job/Artifact cutover and raw-contract removal. P4-10 remains after P4-09. CD activation remains late even though CI is early.

### Phase 4 Exit Criteria

#### Product path

- [ ] A public HTTPS URL is reachable.
- [ ] A new user can complete the selected signup flow, log in, log out, and resume a valid session.
- [ ] Signup creates exactly one default Project.
- [ ] The user can create, write, save, close, reload, and reopen a Document without losing PM content or metadata.
- [ ] Project References persist; inserted citations retain their `citeKey` after reload.
- [ ] Export flushes pending saves and binds the request to an exact current revision.
- [ ] The user can select an immutable template, request an authenticated PDF compile, and download a valid authorized PDF.

#### Consistency and authorization

- [ ] A Job uses the immutable snapshot and hash created at request time; later Document/Reference edits cannot change it.
- [ ] DB-success/Queue-failure recovers through the outbox.
- [ ] Queue-success/DB-update-failure and Worker retries do not create a second logical compile.
- [ ] Postgres remains terminal Job truth even if Redis state is lost or evicted.
- [ ] Anonymous compile returns 401.
- [ ] One user cannot read or mutate another user's Projects, Documents, References, Jobs, or Artifacts, and cannot obtain their signed URLs.

#### Production readiness

- [ ] CI runs lint, typecheck, default tests, and build; opt-in infrastructure smoke remains skipped by default.
- [ ] The Linux Docker sandbox spike passes and ADR 0007 is Accepted before production deployment.
- [ ] Request/document/reference size limits, rate limits, active-job limits, Queue concurrency, and sandbox timeout are enforced.
- [ ] Artifact expiry, scheduled cleanup, object-delete retry, and S3 lifecycle backstop are verified.
- [ ] Secrets are absent from client bundles and logs; errors expose safe codes only.
- [ ] Liveness/readiness, migration gate, deployment gate, post-deploy smoke, and rollback rehearsal pass.

#### Public exit smoke

- [ ] Public URL -> signup -> login -> create document -> enter content -> add reference -> insert citation -> save -> reload -> verify persistence -> select template -> export -> authorized valid PDF download passes end-to-end.
- [ ] At least one production PDF is manually inspected for clipping, overlap, missing glyphs, unresolved citations, and placeholders.
- [ ] Test data and expired artifacts are cleaned up.

## Backlog
(Out-of-phase ideas go here — do not implement early.)
- Figure / Table 节点实体化（caption、src/data）——非 Phase 3 退出标准
- Pandoc DOCX 路径（Phase 4 Stretch；不阻塞 Phase 4 COMPLETE）
- 完整 version history / restore UI（Phase 4 Stretch；不阻塞 Phase 4 COMPLETE）
- 完整 multi-project workspace UI（Phase 4 Stretch；Project 数据边界与 default Project 属于 Core）
- 完整 CSL-JSON 全字段 / citeproc 浏览器预览
- IEEE 完整 authors / affiliations / abstract / keywords 排版（TODO #1 已知非目标；非 Phase 3 回归）
