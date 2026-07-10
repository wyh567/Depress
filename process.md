# PROCESS.md — MVP Roadmap & State

## Status
- Current Phase: **3**
- Phase 2: **COMPLETE**
- Last Updated: 2026-07-10（Phase 3 TODO #3 IEEE citation & bibliography engine 完成；Phase 3 仍进行中）

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
- **Goal:** 同一 AST + 同一 CSL library → Elsevier PDF（确定性）。
- **Scope:** `@depress/templates` 新增 Elsevier immutable 资产；`templateId` 扩展为 `"ieee" | "elsevier"`；processor 按 templateId 分支；citation/bibliography 样式按 Elsevier 约定（APA-like，以实现时模板内配置为准）。
- **Files likely affected:** `packages/templates/`；`packages/ast` compile `templateId`；transformers render 入口；api/web 允许新 id；tests/snapshots。
- **Data contract change:** `templateId` union 扩展。
- **Test requirements:** 文本/PDF 级确定性测试；拒绝未知 templateId；与 IEEE 对照同一 fixture。
- **Acceptance criteria:** 相同 Doc+references，仅改 templateId 得到不同版式 PDF；无用户样式参数。
- **Explicit non-goals:** 完整 Elsevier 商业模板像素级还原；GB/T；UI switcher（#7）。
- **Dependencies:** #2 + #3。
- **Risks:** 样式复杂度；与 IEEE 共享 bibliography 管道时的分支爆炸。

### TODO #6 — GB/T 7714-2015
- **Goal:** 中文期刊模板 + GB/T 7714-2015 参考文献（中英作者、中文标点；覆盖 journal/book/conference/thesis/webpage）。
- **Scope:** immutable GB/T 模板；书目样式（Typst 原生或 Pandoc+CSL——**实现前必须 spike 并写入本 TODO 决策**）；`templateId: "gbt7714"`；中文标点与作者 `literal` 路径测试。
- **Files likely affected:** `packages/templates/gbt7714`；transformers；可能引入 `.csl` 资产或 Pandoc 路径（若 spike 证明 Typst 不足）；api/worker；大量 snapshot。
- **Data contract change:** `templateId` 再扩展；若走 Pandoc，worker 沙箱镜像/工具链变更须单独评审（默认尽量不改 Docker 架构）。
- **Test requirements:** 各文献类型 fixture；中英作者；确定性；禁止网络。
- **Acceptance criteria:** 同一 Doc+references → GB/T PDF，参考文献符合 7714 关键抽样规则（实现 PR 附对照表）。
- **Explicit non-goals:** 所有 GB/T 子类型穷尽；DOCX 导出（Phase 4）。
- **Dependencies:** #2 + #3；#5 可并行但建议 IEEE 管道稳定后再做。
- **Risks:** **本阶段最大技术风险**——GB/T 对 citeproc/CSL 依赖强，可能倒逼 Pandoc 路径，冲击 Invariant #5 沙箱设计。

### TODO #7 — Template switcher + Phase 3 exit smoke
- **Goal:** 同一文档一键导出 IEEE / Elsevier / GB/T 三份 PDF；满足 Phase 3 退出标准。
- **Scope:** web template 选择 UI（最小：下拉/按钮组）；`compile-export` 传所选 `templateId`；按钮文案不再写死 IEEE；exit smoke：同一 fixture 三角导出 + 引用抽检。
- **Files likely affected:** `apps/web/components/editor/*`；`compile-export.ts`；api 已支持三 id；`process.md` 关闭 Phase 3。
- **Data contract change:** 无（消费既有 union）。
- **Test requirements:** UI/hook 单测；契约；可选 `DEPRESS_ROUNDTRIP_SMOKE` 扩展或独立 `DEPRESS_PHASE3_SMOKE`。
- **Acceptance criteria:** 不改正文 AST，仅切换模板，得到三份版式不同、引用正确的 PDF。
- **Explicit non-goals:** 模板市场上传；逐页视觉回归平台。
- **Dependencies:** #2–#6 全部完成。
- **Risks:** 三角导出超时；UI 误引入样式控件（违反 Invariant #1）。

### Phase 3 推荐实施顺序
1. **先做 TODO #2**（bibliography contract + CSL 扩展）——当前最大阻塞。
2. TODO #1（metadata）可与 #2 并行。
3. TODO #3（IEEE bib engine）——第一个可见“正确引用”里程碑。
4. TODO #4（DOI）——不阻塞 #3，可与 #3 尾部并行。
5. TODO #5 → #6 → #7。

### Phase 3 Exit Criteria
同一篇结构化文档（不改正文 AST）导出 IEEE + Elsevier + GB/T 三份 PDF，正文引用与参考文献列表正确。完成前 Phase 保持为 **3**。

## Backlog
(Out-of-phase ideas go here — do not implement early.)
- Figure / Table 节点实体化（caption、src/data）——非 Phase 3 退出标准
- Zustand doc dirty/autosave 持久化（Phase 1 曾规划，代码仅有 reference-library）
- Pandoc DOCX 路径（Phase 4）
- Postgres document versioning / Auth（Phase 4）
- 完整 CSL-JSON 全字段 / citeproc 浏览器预览
