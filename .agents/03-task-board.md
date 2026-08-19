# 任务板

> **活文档**。每次开始/结束任务时更新状态列与日期。
> 状态取值：`NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `DONE`

## 规则

1. **一次只做一个任务。** 取表中第一个状态不是 `DONE` 的任务。
2. 前置任务未 `DONE` 时，**不许**跳过去做后面的任务。
3. 任务文件的 `## 执行步骤` 和 `## 验收标准` **不许改**，只能填 `## 完成记录` / `## 阻塞记录`。
4. 做任务过程中发现的其他问题 → 写进本文件 §3「发现待办」，**不要顺手做**。

## 1. 任务列表（按执行顺序）

| # | 任务 | 文件 | 状态 | 前置 | 更新日期 |
|---|---|---|---|---|---|
| T-01A | 修复 document-metadata 中重复手写的 AST 元数据类型 | [tasks/T-01A-fix-duplicated-metadata-types.md](tasks/T-01A-fix-duplicated-metadata-types.md) | `DONE` | 无（解除 T-01 阻塞） | 2026-08-05 |
| T-01 | 整理工作树 + 让 CI 覆盖本分支 | [tasks/T-01-worktree-and-ci.md](tasks/T-01-worktree-and-ci.md) | `DONE` | 无 | 2026-08-07 |
| T-02 | 移除遗留未认证编译入口与死代码 | [tasks/T-02-remove-legacy-compile-contract.md](tasks/T-02-remove-legacy-compile-contract.md) | `DONE` | T-01 | 2026-08-08 |
| T-03 | 同步 process.md / architecture.md / ADR 0007 | [tasks/T-03-sync-docs-and-adr.md](tasks/T-03-sync-docs-and-adr.md) | `DONE` | T-02 | 2026-08-09 |
| T-04 | P4-10 最小生产安全集 | [tasks/T-04-min-production-safety.md](tasks/T-04-min-production-safety.md) | `PAUSED — owner reprioritized to Production UI implementation` | T-03 | 2026-08-17 |
| T-06 | Production UI implementation（Claude Design 视觉对齐，功能零回归） | [tasks/T-06-production-ui-implementation.md](tasks/T-06-production-ui-implementation.md) | `DONE` | Owner reprioritization; T-04 temporarily paused | 2026-08-18 |
| T-05 | 自动保存 + mentor 人工验收收口 | [tasks/T-05-autosave-and-mentor-signoff.md](tasks/T-05-autosave-and-mentor-signoff.md) | `NOT_STARTED` | T-04 | 2026-08-04 |

## 2. 为什么是这个顺序

分析报告里按「用户可试用价值 / 上线阻塞」排序时，安全问题（T-02）排第一。
但**执行顺序**必须先做 T-01，原因很实际：

> T-01 开始时工作树有 58 个未提交文件，因此当时任何新改动都会与既有改动混在一起，
> diff 无法审查，出问题也无法回滚到干净点。
> 先把地基整干净，后面每个任务的 diff 才是可读、可审、可回滚的。
> **该前提已随 T-01 完成消除。**

T-02 → T-03 的顺序也有依赖：先删掉遗留契约，`process.md` 里 P4-09 才能诚实地标成完成。

**当前任务：T-04（`IN_PROGRESS`）。** T-03 已完成；已批准的治理决策是
single-VM full-stack Production MVP 与 invite-only Mentor MVP。T-05 的顺序与范围不变。

T-04 之后才做 T-05，是因为即使是 invite-only 生产入口也必须先有最小限流/配额/清理控制，
而自动保存 + 人工验收是”给人用”的收口动作。T-04 不开启公共注册。

**2026-08-17 owner 决策：T-04 暂停，T-06（Production UI implementation）为当前唯一活跃任务。**
Owner reprioritization; T-04 temporarily paused. T-04 未完成的安全控制项不放弃，只是延后；
T-04 与 T-06 不同时活跃 —— T-06 完成或阶段性完成后由 owner 决定是否恢复 T-04，
届时 T-05 仍在 T-04 之后、顺序不变。T-06 遵循已批准的 Phase 0（只读检查）与 Phase 1
（分片实施计划）两份报告划定的范围与红线：不新增路由、不虚构 Dashboard/Editor/References/
PDF 数据、不改 PDF 基础设施（OSS CORS / 同源代理）、保留全部三个编译模板（ieee / elsevier /
gbt7714）、不做 autosave、不做 i18n、不移除 BibTeX 导入、不移除 metadata authoring、
不新增编译快捷键、所有既有可访问性名称（aria-label / 可见文本断言）保持不变。
详见任务文件 [tasks/T-06-production-ui-implementation.md](tasks/T-06-production-ui-implementation.md)。

## 3. 发现待办（做任务时发现、但明确不在当前 scope 的问题）

> 往这里追加，不要顺手实现。用户会决定何时排进任务列表。

| 发现日期 | 问题 | 影响 | 发现于 |
|---|---|---|---|
| 2026-08-04 | 无 document checkpoints（ADR 0004 / P4-06 要求，迁移里无表） | 无版本历史，无法回溯 | 初次分析 |
| 2026-08-04 | 无 soft delete，文档创建后删不掉 | 功能缺失 | 初次分析 |
| 2026-08-04 | 改 citeKey 等于删旧建新，正文已插入引用会失配 → 表现为"编译突然失败" | 用户体验 | 初次分析 |
| 2026-08-04 | Figure / Table 节点仍是空 stub，没有图和表 | 学术论文硬缺口（在 Backlog） | 初次分析 |
| 2026-08-04 | 生产对象存储供应商未决策（当前只有 MinIO，无 AWS 选型证据） | 上线阻塞 | 初次分析 |
| 2026-08-04 | 无邮箱验证 / 密码重置 / 邮件服务 | 公开注册的前提 | 初次分析 |
| 2026-08-04 | 三个模板均非官方认证模板，GB/T 仅抽样验证 | 投稿前需逐条比对期刊 guideline | 初次分析 |
| 2026-08-04 | `apps/web/components/document-workspace.tsx` 264 行，超过 `.cursorrules` 的组件 ≤150 行约定 | 既有欠债，需拆分 | 初次分析 |
| 2026-08-05 | `document-metadata.ts` 的 `parseAuthors` / `parseAffiliations` **返回类型**仍是手写的 author/affiliation 结构镜像（同属 Invariant #3 违规）。当前**能通过类型检查**（协变方向合法），故不在 T-01A 的最小修复范围内 | Invariant #3 双份维护；日后 ast 字段变更时会静默漂移 | T-01A |
| 2026-08-09 | 在途 compile job 需要独立的 stale-job reconciliation | 否则异常终止的 active 状态可能长期占用后续配额 | T-04 决策审计（D19） |
| 2026-08-09 | 生成 PDF 仍缺少硬字节上限 | 请求体上限不能限制渲染后 artifact 体积 | T-04 决策审计（D20） |
| 2026-08-09 | 生产 nginx 未转发公开 `/references/doi/lookup` | Web/API 对该公开 DOI BFF 的生产可达性尚未闭环 | T-04-A 路由复核 |

## 4. 完成历史

| 完成日期 | 任务 | 结果摘要 |
|---|---|---|
| 2026-08-05 | T-01A | `document-metadata.ts` 手写 AST 镜像类型替换为 `@depress/ast` 公开导出的 `DocAuthor`/`DocAffiliation`，解除 T-01 的 typecheck/build 阻塞 |
| 2026-08-07 | T-01 | 58 个原始未提交产品改动按意图拆分为 6 个独立提交（元数据+IEEE前置信息、沙箱测试固化、部署拓扑加固、operator-validation 生成器、Day10 harness 可移植性）+ 1 个 `.agents` 收尾提交；全套 lint/typecheck/test/build 最终重跑通过，465 passed / 51 skipped；部署与 operator-validation 两个候选在 ECS 完成隔离验证；全部提交仅存在本地，未 push，PR 未改动 |
| 2026-08-07 | T-01（CI 缺口补齐） | 原验收标准第 7 条（CI `push` 覆盖 `feature/**`）在最终审查阶段单独处理：`push.branches` 新增 `"feature/**"`，`pull_request.branches` 不变；lint/typecheck 通过。T-01 全部原验收标准现在真正闭合 |
| 2026-08-08 | T-02 | 用户选定 Option A：完全移除未认证 `POST /compile` / `GET /jobs/:id`、legacy 全 payload Queue/reader/worker/processor 适配层、五个 Phase 3 smoke 与未挂载 Web 死路径；保留并验证 authenticated snapshot/outbox/pointer-worker/S3/sandbox 链路。lint/typecheck/build 通过，404 与目标路径定向测试通过，全量 405 passed / 46 skipped |
| 2026-08-09 | T-03 | 治理与架构同步经 PR #6 合并到 master `d3fc0790794f272786a3eea196f5975c2b96360e`，post-merge CI `SUCCESS`；T-03 完成，T-04 保持 `NOT_STARTED` 并成为下一任务 |
| 2026-08-18 | T-06 | Production UI implementation（Slice 1 – 9A，共 15 个已批准分片）完成。Final Product Acceptance（Slice 9/9A）PASS：466 passed / 107 skipped，lint/typecheck/build 全部 PASS，accessibility PASS，1440×1024 与 1280×900 视觉验收 PASS，无 backend/API/schema/infra 改动，无 Claude Design 运行时产物被打包。分支 `feature/t06-ui-design-tokens` 已确认 READY_FOR_PR，PR 待创建。T-04 未完成安全控制项仍待 owner 决定是否恢复。 |
