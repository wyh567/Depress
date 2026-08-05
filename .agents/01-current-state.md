# 当前真实状态

> **活文档**。任务完成后由 agent 更新对应事实，并在 §7 追加变更记录。
> 快照日期：**2026-08-04**，分支 `feature/phase4-mentor-mvp`，
> 最新提交 `7a59a5a test(e2e): handle transient compile status sampling`。

---

## 0. ⚠️ 先读这一节：三个会让你判断错误的陷阱

### 陷阱 1：`process.md` 的 Phase 4 状态是错的

`process.md` 头部写着：

```
P4-00: COMPLETE / P4-01: COMPLETE
P4-02 ~ P4-12: NOT STARTED
```

**这是错的。** 实际上 P4-03 到 P4-11 的绝大部分已经实现（见 §1 表格）。
git log 有一整条 20+ 提交的 "mentor MVP" 工作线（`ad92770` → `7a59a5a`），
而 `process.md` 和 `architecture.md` 里 **"mentor" 一词出现 0 次**。

→ 在任务 `T-03` 完成前，**以本文件为准，不要照 `process.md` 的状态行做决策**。
→ `process.md` 的 Phase 1–3 历史验收记录仍然可信，只有 Phase 4 状态部分不可信。

### 陷阱 2：工作树是脏的（58 个文件）

用这条命令自检（**只数产品改动**，不受工作流文件干扰）：

```bash
git status --porcelain -- apps packages deploy e2e docs process.md architecture.md docker-compose.yml playwright.day10.config.ts | wc -l
```

期望输出：**58**（约 43 个已修改 + 约 15 个未跟踪）。

> `git status --short` 的**总行数**会更大，因为 `.agents/`、`CLAUDE.md`、`.claude/settings.json`
> 这些工作流文件在被提交前也会计入。**不要拿总行数去比对 58。**
主要涉及：`deploy/` 全部安全脚本、`e2e/day10/`、IEEE/GB/T 渲染器与 snapshot、
双语元数据（`packages/ast/src/schema.ts`、`apps/web/stores/document-metadata.ts`）。

→ 这些改动**既没进 CI，也不在 Day 10 验收的那个 SHA（`8a83cfd`）里**。
→ 任何新改动会和这 58 个文件混在一起，diff 无法审查。
→ **这就是 `T-01` 必须排在第一位的原因。**

### 陷阱 3：Day 10 "验收通过" 不等于"已上线"

`docs/mentor-mvp-acceptance.md` 的 `MENTOR_MVP_DAY10_TECHNICAL_ACCEPTANCE_PASS`
是在**一次性 staging 环境**上、针对 commit `8a83cfd` 取得的技术验收。
文档自己写明：人工 mentor sign-off **pending**，生产域名/供应商部署 **pending**，
完整 457 测试套件 **intentionally not run**。

→ 不要把它当成"产品已上线"。

---

## 1. Phase 完成度对照表

### Phase 1–3：真实完成，有可复现证据

| Phase | 状态 | 证据 |
|---|---|---|
| Phase 1 编辑器核心 + AST 契约 | ✅ COMPLETE | `process.md` Phase 1 TODO 全勾 |
| Phase 2 编译引擎 | ✅ COMPLETE | 2026-07-09 验收：7 files / 47 tests，真实 `%PDF-` |
| Phase 3 引用引擎 + 多模板 | ✅ COMPLETE | 2026-07-11 退出 smoke：同一 AST 三份 PDF，字节 24,611 / 24,643 / 26,477，SHA-256 互异 + 人工视觉抽检 |

### Phase 4：文档声明 vs 代码实际

| 任务 | process.md 声明 | 代码实际 | 证据 / 缺口 |
|---|---|---|---|
| P4-00 架构冻结 | COMPLETE | ✅ COMPLETE | 7 份 ADR |
| P4-01 CI baseline | COMPLETE | ⚠️ 部分 | `.github/workflows/ci.yml` 存在，但**只在 master 触发**，当前分支不跑 CI |
| P4-02 沙箱 spike | NOT STARTED | ✅ 实质完成 | Day 10 真实 Linux 跑通；但 **ADR 0007 仍是 `Proposed`** |
| P4-03 共享契约 | NOT STARTED | ✅ 完成 | `persisted-document.ts` / `compile.ts`(快照+指针) / `document-api.ts` / `reference-api.ts` |
| P4-04 Postgres | NOT STARTED | ✅ 完成 | 5 个迁移，带 CHECK 约束与部分索引 |
| P4-05 Auth | NOT STARTED | ✅ 完成（**刻意 invite-only**） | Better Auth + PG session；`auth.ts` `disableSignUp: allowSignUp !== true` |
| P4-06 文档/引用持久化 | NOT STARTED | ⚠️ 部分 | CRUD + 乐观并发 + owner 隔离有；**checkpoints / soft delete 完全没有** |
| P4-07 Web 存取 | NOT STARTED | ⚠️ 部分 | save/load/reopen/冲突处理完整；**无 debounce 自动保存** |
| P4-08 快照 + outbox | NOT STARTED | ✅ 完成 | 不可变 `input_snapshot` + `snapshot_hash` + `compile_outbox` + 幂等 BullMQ job id |
| P4-09 Worker/Artifact/切换 | NOT STARTED | ⚠️ 差最后一步 | 主链路全通；**旧的未认证 `POST /compile` 仍注册在生产 app 里，cutover gate 未关** |
| P4-10 安全/生命周期 | NOT STARTED | ❌ 基本未做 | 无限流 / 无配额 / 无 artifact 过期 / 无清理 |
| P4-11 CD/部署 | NOT STARTED | ✅ 资产完成，未上线 | systemd×4 + 5 身份 + nginx TLS + release/rollback + 权限自检脚本 |
| P4-12 公网退出 | NOT STARTED | ❌ 未达成 | 无公开注册、无线上部署证据 |

---

## 2. 已实现且可用的产品能力

| 能力 | 状态 | 证据 |
|---|---|---|
| 结构化编辑（heading 1–3 / 段落 / 语义粗斜体 / citation 原子节点） | 可用 | `apps/web/components/editor/*` + `editor-schema.test.ts` |
| 双语学术元数据（title/titleEn、abstract/abstractEn、keywords/keywordsEn、作者与单位 nameEn） | 可用（**未提交**） | `packages/ast/src/schema.ts` `DocMetadataSchema`；`document-metadata-panel.tsx` 有对应输入框 |
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

### 🔴 高危 — 遗留未认证编译入口仍在生产 app 中

`apps/api/src/app.ts` 无条件调用 `registerCompileRoute`，
于是生产 API 进程仍暴露 **未认证的 `POST /compile`**（`routes/compile.ts` 全文无鉴权）和 `GET /jobs/:id`。

- 目前只靠 nginx 返回 404 挡住 → **单层边缘防护**，代理配置回退/端口暴露/内网访问都能绕过
- 生产 systemd 只跑 pointer-worker，**没有 legacy worker 消费这个队列** → 匿名入队的任务在 Redis 无限堆积 → 低成本内存耗尽
- 违背 `architecture.md` §3.5 "Public anonymous compile is forbidden"
- 说明 P4-09 的 final cutover gate 事实上没关

连带死代码：`worker-main.ts`、`workers/compile-worker.ts`、`services/job-store.ts`、
`services/job-reader.ts`、`queue/compile-queue.ts`，以及 web 侧
`export-pdf-button.tsx`、`compile-export.ts`、`use-compile-export.ts`
（`editor-area.tsx` 已不再挂载它们）。

→ **任务 `T-02`**

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

### 🟠 Auth 与公网产品定位冲突

注册被关（`disableSignUp`）、无邮箱验证、无密码重置、无邮件服务。
对 mentor 演示是正确取舍，但意味着 **Phase 4 exit criteria 的 signup 相关项永远不会通过**。
需要的是**修订退出标准**，不是继续挂着不勾。

→ **任务 `T-03`**（文档修订）+ `T-05`（决策）

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
- 生产对象存储供应商**仍未决策**
- **ADR 0007 仍标 `Proposed`，且实际拓扑已与它不符**：
  ADR 写的是 Web 在 Vercel + 后端专用 VM，`deploy/README.md` 实际是**单台 Ubuntu VM 同时跑
  Web/API/Outbox/Worker/nginx**。这是一次未走决策流程的架构变更（既没改 Accepted 也没走 Superseded）

→ **任务 `T-03`**

### 🟡 测试债

- 62 个测试文件，单测/集成质量高（每边界重校验、含负例、含幂等/并发用例）
- 但**所有真实基础设施测试都是 opt-in 且 CI 默认跳过**（清单见 `02-agent-rules.md` §5）
- CI **只在 master 的 PR/push 触发**，当前分支推送不跑 CI
- Day 10 E2E 需要真实 Linux + root + systemd，**Windows 开发机跑不了**
- 验收文档自述 "Full 457-test suite: intentionally not run"
- **58 个文件未提交**，既没进 CI 也不在验收 SHA 里

→ **任务 `T-01`**

### 🟡 文档与代码不一致（汇总）

1. `process.md` P4-02～P4-12 全标 NOT STARTED，实际已实现 P4-03～P4-09、P4-11 主体
2. `process.md` / `architecture.md` 完全没有 "Mentor MVP" 这条工作线
3. `architecture.md` §4 Vercel 拓扑 vs `deploy/README.md` 单 VM 拓扑
4. ADR 0007 状态 `Proposed`，与已完成的沙箱验证和已变更的拓扑都不符
5. `process.md:12` 的 Last Updated 只记了双语元数据，未反映 Phase 4 真实进度

→ **任务 `T-03`**

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
| POST | `/compile` | ❌ **无** | 🔴 遗留，待删（`T-02`） |
| GET | `/jobs/:id` | ❌ **无** | 🔴 遗留，待删（`T-02`） |
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

- 来源：2026-08-04 对本分支的一次**只读**结构化分析
- **未运行任何测试**。所有"测试通过"陈述引用自 `process.md` 与 `docs/mentor-mvp-acceptance.md` 的历史记录
- 代码结构、路由清单、迁移内容、依赖方向均为**直接读取源码所得**，可信

---

## 7. 变更记录

| 日期 | 变更 | 由谁 |
|---|---|---|
| 2026-08-04 | 初次建立（基于只读分析） | 分析会话 |
