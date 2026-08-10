# 当前真实状态

> **活文档**。任务完成后由 agent 更新对应事实，并在 §7 追加变更记录。
> 初次快照日期：2026-08-04；最新更新：**2026-08-09（T-04 开始）**。
> 可信 master：`836cd103baf1bc3a71abf0fff84b73c71dedeb11`；PR #3–#7 均已合并，
> T-03 已完成；T-04 现为 `IN_PROGRESS`，尚未完成任何验收项。

---

## 0. ⚠️ 先读这一节：曾经会让你判断错误的陷阱（部分已解决）

### 陷阱 1（已解决，2026-08-09）：Phase 4 治理文档曾严重滞后

旧版 `process.md` 把 P4-02～P4-12 全标为 `NOT STARTED`，并且 `architecture.md` / ADR 0007
仍描述 Vercel + 专用后端 VM。T-03 已把它们同步到本文件 §1 的真实状态，并记录
Accepted single-VM Production MVP 与 invite-only Mentor MVP 决策。PR #6 已合并且 post-merge CI
为 `SUCCESS`；不要据此推断 T-04、部署或生产验收已完成。

### 陷阱 2（已解决，2026-08-07）：曾经的 58 个未提交产品改动

**T-01 已完成，本陷阱不再成立。** 原本 58 个未提交产品改动（`deploy/` 全部安全脚本、
`e2e/day10/`、IEEE/GB/T 渲染器与 snapshot、双语元数据）已按意图拆分为 6 个独立提交，
产品工作树现在是 **clean** 的。自检命令：

```bash
git status --porcelain -- apps packages deploy e2e docs process.md architecture.md docker-compose.yml playwright.day10.config.ts | wc -l
```

期望输出现在是 **0**。若不是 0，说明有新的未提交产品改动，需要按 `git status --short`
逐条核实来源，不要假设是这批历史遗留。

具体提交链、验证结果、ECS 隔离验证记录见
[`tasks/T-01-worktree-and-ci.md`](tasks/T-01-worktree-and-ci.md) 完成记录。
这些提交后来经 PR #4 合并到 master；上述“仅存在本地”的历史状态已不再成立。

### 陷阱 3：Day 10 "验收通过" 不等于"已上线"

`docs/mentor-mvp-acceptance.md` 的 `MENTOR_MVP_DAY10_TECHNICAL_ACCEPTANCE_PASS`
是在**一次性 staging 环境**上、针对 commit `8a83cfd` 取得的技术验收。
文档自己写明：人工 mentor sign-off **pending**，生产域名/供应商部署 **pending**，
完整 457 测试套件 **intentionally not run**。

→ 不要把它当成"产品已上线"。

### 已接受的 Production MVP 决策（2026-08-09）

- **拓扑：single-VM full-stack。** nginx、Web、API、PostgreSQL、Redis、Outbox Publisher、
  Pointer Worker 与 Typst Sandbox 位于生产 VM；private S3-compatible artifact storage 独立在 VM 外。
  这是 MVP 决策，不是永久扩展承诺。
- **账户：invite-only Mentor MVP。** 公共注册及其邮箱验证、密码恢复、滥用防护、账户生命周期、
  public onboarding 与 compile quotas 推迟到后续产品阶段。

---

## 1. Phase 完成度对照表

### Phase 1–3：真实完成，有可复现证据

| Phase | 状态 | 证据 |
|---|---|---|
| Phase 1 编辑器核心 + AST 契约 | ✅ COMPLETE | `process.md` Phase 1 TODO 全勾 |
| Phase 2 编译引擎 | ✅ COMPLETE | 2026-07-09 验收：7 files / 47 tests，真实 `%PDF-` |
| Phase 3 引用引擎 + 多模板 | ✅ COMPLETE | 2026-07-11 退出 smoke：同一 AST 三份 PDF，字节 24,611 / 24,643 / 26,477，SHA-256 互异 + 人工视觉抽检 |

### Phase 4：当前真实状态

| 任务 | 当前状态 | 证据 / 缺口 |
|---|---|---|
| P4-00 架构冻结 | ✅ COMPLETE | 7 份 ADR；ADR 0007 由 T-03 接受当前 MVP 拓扑 |
| P4-01 CI baseline | ✅ COMPLETE | `push`: `master` + `feature/**`；`pull_request`: `master` |
| P4-02 沙箱 spike | ✅ COMPLETE | Day 10 真实 Linux 历史验证；不等于当前 master 生产验收 |
| P4-03 共享契约 | ✅ COMPLETE | `persisted-document.ts` / `compile.ts` / document/reference API contracts |
| P4-04 Postgres foundation | ✅ COMPLETE | 5 个迁移与核心 CHECK/索引；artifact lifecycle 仍由 T-04 补充 |
| P4-05 Auth | ✅ COMPLETE | Better Auth + PG session；**刻意 invite-only** |
| P4-06 文档/引用持久化 | ⚠️ PARTIAL | CRUD + 乐观并发 + owner 隔离有；**checkpoints / soft delete 没有** |
| P4-07 Web 存取 | ⚠️ PARTIAL | save/load/reopen/冲突处理完整；**无 debounce 自动保存** |
| P4-08 快照 + outbox | ✅ COMPLETE | 不可变 snapshot/hash + outbox + 幂等 BullMQ job id |
| P4-09 Worker/Artifact/切换 | ✅ COMPLETE | authenticated pointer 链路全通；T-02 已删除 legacy contract/path |
| P4-10 安全/生命周期 | 🟠 IN PROGRESS | T-04 已开始；限流、配额、artifact 过期/清理仍未完成 |
| P4-11 CD/部署 | ⚠️ PARTIAL | 资产完成并有历史 staging 证据；**生产未部署** |
| P4-12 生产退出 | ❌ NOT STARTED | 当前 master 无生产部署/验收证据；mentor sign-off pending |

---

## 2. 已实现且可用的产品能力

| 能力 | 状态 | 证据 |
|---|---|---|
| 结构化编辑（heading 1–3 / 段落 / 语义粗斜体 / citation 原子节点） | 可用 | `apps/web/components/editor/*` + `editor-schema.test.ts` |
| 双语学术元数据（title/titleEn、abstract/abstractEn、keywords/keywordsEn、作者与单位 nameEn） | 可用（已合并） | `packages/ast/src/schema.ts` `DocMetadataSchema`；`document-metadata-panel.tsx` 有对应输入框 |
| 引用库 CRUD + BibTeX 导入 | 可用 | `components/library/bibtex-to-csl.ts` + tests |
| DOI → CSL-JSON | 可用 | `POST /references/doi/lookup` 薄 BFF，固定 Crossref origin，8s 超时 / 2 次重试 / 6 个安全错误码 |
| 三模板导出 IEEE / Elsevier / GB/T 7714 | 可用 | Phase 3 exit smoke + Day 10 复用证据（14,446 / 19,362 / 24,976 bytes，均单页） |
| 中文字形 | 可用 | 固定只读挂载 `Noto Sans CJK SC`，编译输入无法选字体/路径 |
| 邀请制登录 / 会话 / 登出 | 可用 | Better Auth + PG session，HttpOnly/SameSite=lax，生产 Secure；Day 10：登出后 cookie 数 0 |
| 文档持久化 + 重开 + 修订冲突 | 可用 | `PUT /api/documents/:id` 乐观并发；Day 10 验证 `A,B,A` 在六个边界一致 |
| Project 级引用库持久化 | 可用 | `project_references(project_id, cite_key)` + `/api/references` CRUD |
| 认证编译 + 授权下载 | 可用 | `/api/compile-jobs` 三路由全部 `requireAuthenticatedUser`；Day 10：跨用户 404 / 匿名 401 / 未签名对象 403 |
| 一致性与幂等 | 可用 | outbox + 幂等 job id + 原子 claim；Day 10：worker 重启后 job 仍 succeeded 且**恰好一个** artifact |
| 失败降级 | 可用 | 编译/上传失败均返回安全 `failed`，无内部细节，下载端点 409 |
| 本地基础设施链路 | 可用 | `docker-compose.yml`（PG + Redis + MinIO + 幂等 bucket init）+ `.env.example` |
| 生产部署资产 | 已写好，**未上线** | Day 10 验证：PG/Redis/S3 仅 loopback，无 2375/2376，API 身份被拒绝访问 Docker |

---

## 3. 缺口与风险（按严重度排序）

### ✅ 已解决 — 遗留未认证编译入口与死链路

T-02 Option A 已完成：Fastify/API 层不再注册 `POST /compile` 或 `GET /jobs/:id`，
且不存在可重新开启它们的 build/env 开关。直连 API 的两条路径均返回 Fastify 404，
nginx 的显式拒绝保留为 defense-in-depth。

legacy 全 payload Queue、job store/reader、worker 入口与适配器、五个 Phase 3 smoke，
以及未挂载的 Web export 死路径已删除。产物签名/上传接口已移至中立契约模块；
authenticated snapshot/outbox/pointer-worker/Postgres/S3/sandbox 路径保持不变。

### 🟠 P4-10 生产安全控制基本空白

全仓 grep 结果：无限流插件、无 Fastify `bodyLimit` 覆写、无每用户在途 job 上限、
无 artifact `expires_at`、无清理任务、无 S3 lifecycle。
nginx `client_max_body_size 10m` 与 Fastify 默认 1MB 不一致（实际以 1MB 为准，属配置误导）。
PDF 永久留在桶里。

→ **任务 `T-04`**

### 🟠 持久化模型缺口

- **无 checkpoints**：ADR 0004 与 P4-06 要求的稀疏不可变检查点，迁移里没有表
- **无 soft delete**：文档只能创建/更新，删不掉
- 引用身份用 `cite_key` 做主键的一半，改 citeKey ≈ 删旧建新，正文已插入的引用会失配
  （编译时被 `citationReferenceIntegrity` 拦下报错，不会静默出错，但用户看到的是"编译突然失败"）
- **无自动保存**：只有手动 Save + dirty 提示，关标签页会丢内容

→ 自动保存见 **任务 `T-05`**；checkpoints / soft delete 目前不在任务板（属 P4-06 未完成部分，需用户决定是否补）

### ✅ 已决策 — 邀请制账户模型

Production MVP 明确采用 invite-only Mentor MVP；公共注册不是当前缺口。公共 signup flow、邮箱验证、
密码恢复、滥用保护、账户生命周期、public onboarding、compile quotas 是后续产品阶段的 backlog。
T-05 仍负责 autosave 与 mentor 人工 sign-off，不负责重新决定当前账户模型。

### 🟡 学术合规缺口

- 三个模板都**不是官方认证模板**。`process.md` 自述 GB/T 只做了"关键规则抽样验证，
  不宣称完全符合全部规范或全部标点细节"
- `FigureNodeSchema` / `TableNodeSchema` 仍是空 stub → **没有图、没有表**（明确在 Backlog）
- 无公式、脚注、交叉引用、附录；GB/T 中文期刊常需的基金/收稿日期/中图分类号也没有
- DOI 单一来源 Crossref（无 DataCite / PubMed），CSL 仅子集字段

→ 不在当前任务板，属产品范围决策

### 🟡 部署与对象存储

- **仓库里没有 "Phase A" 概念，也没有任何 AWS 供应商选型证据**。
  S3 完全通过 env 抽象；本地与 Day 10 staging 用的都是 MinIO。
  `e2e/day10/provision-staging.sh` 里的 `arn:aws:s3:::` 只是 MinIO 兼容 AWS 的策略语法，**不是 AWS**
- 生产对象存储供应商**仍未决策**；架构只接受 independent private S3-compatible contract
- ADR 0007 已接受 single-VM full-stack Production MVP：nginx/Web/API/PostgreSQL/Redis/Outbox/
  Pointer Worker/Typst Sandbox 在 VM，artifact storage 在 VM 外
- 生产环境配置、provisioning、deployment、current-master smoke/acceptance **均未发生**

### 🟡 测试债（部分已解决，2026-08-07）

- 62 个测试文件，单测/集成质量高（每边界重校验、含负例、含幂等/并发用例）
- 但**所有真实基础设施测试都是 opt-in 且 CI 默认跳过**（清单见 `02-agent-rules.md` §5）
- ✅ CI 现在 `push` 到 `feature/**` 也会触发（原缺口，已在 T-01 收尾时补齐）
- Day 10 E2E 需要真实 Linux + root + systemd，**Windows 开发机跑不了**
- 验收文档自述 "Full 457-test suite: intentionally not run"
- ✅ 原先 58 个未提交文件已按意图拆分提交，工作树已 clean（`T-01` `DONE`）

→ **`T-01` 已完成**；下一个任务见 `03-task-board.md`

### ✅ T-03 已完成

`process.md` 的 Phase 4 状态、Mentor MVP 范围和退出标准，`architecture.md` 的部署拓扑与账户模型，
以及 ADR 0007 的状态/决策已同步并经 PR #6 合并到 master。T-03 post-merge CI 为 `SUCCESS`；
T-04 已从当前 master 开始，现为 `IN_PROGRESS`。

---

## 4. 关键文件速查

| 想改什么 | 去哪里 |
|---|---|
| 语义 AST / 元数据字段 | `packages/ast/src/schema.ts` |
| 持久化信封 | `packages/ast/src/persisted-document.ts` |
| 编译请求/快照/队列指针契约 | `packages/ast/src/compile.ts` |
| 三个模板渲染 | `packages/transformers/src/render-{ieee,elsevier,gbt7714}-typst-document.ts` |
| 模板版式常量 | `packages/templates/src/{ieee,elsevier,gbt7714}.ts` |
| API 路由注册 | `apps/api/src/app.ts` |
| 生产入口 / 环境变量 | `apps/api/src/server.ts` · `apps/api/src/env.ts` |
| 编译作业业务逻辑 | `apps/api/src/db/compile-job-repository.ts` · `routes/compile-jobs.ts` |
| Worker 执行 | `apps/api/src/workers/compile-pointer-processor.ts` |
| 沙箱 | `apps/api/src/workers/typst-sandbox.ts` |
| 编辑器主界面 | `apps/web/components/document-workspace.tsx` · `editor/editor-area.tsx` |
| 编译按钮/轮询 | `apps/web/components/editor/compile-controls.tsx` |
| 部署 | `deploy/README.md` + `deploy/*.sh` + `deploy/systemd/*` |

## 5. API 路由全清单

| 方法 | 路径 | 鉴权 | 备注 |
|---|---|---|---|
| POST | `/references/doi/lookup` | ❌ 无 | Crossref BFF，可保留但应加限流（`T-04`） |
| GET/POST | `/api/documents` | ✅ | |
| GET/PUT | `/api/documents/:documentId` | ✅ | PUT 带乐观并发 |
| GET/POST | `/api/references` | ✅ | |
| PUT/DELETE | `/api/references/:referenceIdentity` | ✅ | |
| POST | `/api/compile-jobs` | ✅ | 目标契约 |
| GET | `/api/compile-jobs/:jobId` | ✅ | |
| GET | `/api/compile-jobs/:jobId/download` | ✅ | owner-scoped 签名 URL |
| GET | `/api/protected-probe` | ✅ | 探针 |
| GET | `/health/live` · `/health/ready` | ❌ 无 | 健康检查，设计如此 |
| ALL | `/api/auth/*` | — | Better Auth |

---

## 6. 本文件的信息来源与可信度

- 初始来源：2026-08-04 对当时分支的只读结构化分析；后续任务按变更记录增量校正
- T-02 结论来自 2026-08-08 实际代码与定向/全量验证：106 passed / 27 skipped，全量 405 passed / 46 skipped，lint/typecheck/build 通过；PR #5 已合并并通过 master CI
- 当前 master/PR 状态来自 2026-08-09 对 `origin/master` 与 GitHub merge/CI 结果的只读核验
- 代码结构、路由清单、迁移内容、依赖方向均为**直接读取源码所得**，可信

---

## 7. 变更记录

| 日期 | 变更 | 由谁 |
|---|---|---|
| 2026-08-04 | 初次建立（基于只读分析） | 分析会话 |
| 2026-08-07 | T-01 完成后同步：58 个未提交产品改动已拆分为独立提交、工作树 clean、CI 现覆盖 `feature/**` push。更新 §0 陷阱 2、§1 P4-01 行、§2 双语元数据行、§3 测试债段落。提交链本身仍未 `push`，其余缺口（P4-02~P4-12 其余状态、遗留 `POST /compile`、P4-10 安全空白等）未受影响，原样保留 | T-01 收尾会话 |
| 2026-08-08 | T-02 Option A：移除 Fastify 层未认证 legacy compile/jobs 路由、legacy Queue/reader/worker/processor 适配层、五个 smoke 与 Web 死路径；必需产物契约移至中立模块，authenticated pointer 链路保留。定向 106 passed / 27 skipped，全量 405 passed / 46 skipped，lint/typecheck/build 通过 | T-02 实施会话 |
| 2026-08-09 | T-03 当前工作：可信 master 更新为 `64f8ed459...`；记录 PR #3/#4/#5 已合并，接受 single-VM full-stack Production MVP 与 invite-only Mentor MVP；同步 Phase 4 状态，并明确 T-04、autosave、mentor sign-off、生产部署/验收仍未完成 | T-03 实施会话 |
| 2026-08-09 | T-03 合并收尾：PR #6 已合并，可信 master 更新为 `d3fc0790794f272786a3eea196f5975c2b96360e`，post-merge CI `SUCCESS`；T-03 改为 `DONE`，T-04 为下一任务但仍是 `NOT_STARTED` | T-03 收尾会话 |
