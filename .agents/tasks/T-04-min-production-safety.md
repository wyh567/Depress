# T-04 — P4-10 最小生产安全集

- **状态**：`NOT_STARTED`
- **前置任务**：`T-03`
- **预计改动文件数**：6–10
- **是否需要用户批准才能开工**：**是**（涉及新增依赖 + 数据库迁移）

## 为什么做这个

从"邀请制演示"走向"任何人可用"的最低门槛。现在的空白（全仓 grep 已核实）：

- 无限流插件
- 无 Fastify `bodyLimit` 覆写（用默认 1MB，而 nginx 写的是 `client_max_body_size 10m` —— 两边不一致，实际以 1MB 为准）
- 无每用户在途 compile job 上限
- artifact 无 `expires_at`、无清理任务、无 S3 lifecycle → PDF 永久留在桶里

不做的话，公网开放后第一个恶意用户就能把 Redis、磁盘和对象存储打满。

**范围严格限定在三件事**，不要扩：

1. 请求体 / 文档大小上限，且与 nginx 对齐
2. 每用户在途 compile job 上限
3. artifact `expires_at` + 定时清理

## 前置条件

- [ ] `03-task-board.md` 中 T-03 状态为 `DONE`
- [ ] `git status --short` 无输出
- [ ] `pnpm test` 通过
- [ ] 本地基础设施可用：`docker compose up -d` 后 `docker compose ps` 显示 postgres/redis/minio 健康

## 允许触碰的文件

- `apps/api/src/app.ts`（Fastify 配置 / 插件注册）
- `apps/api/src/server.ts`（生产入口配置）
- `apps/api/src/env.ts`（新增限额相关环境变量，带安全默认值）
- `apps/api/src/routes/compile-jobs.ts`（在途 job 上限检查）
- `apps/api/src/db/compile-job-repository.ts`（在途计数查询 / artifact 过期字段）
- `apps/api/src/db/migrations/0006_*.sql`（**新建**，不许改已有迁移）
- `deploy/nginx/depress-api.conf`（对齐大小上限）—— **改这个需要单独说明并等批准**
- 对应的 `*.test.ts`
- `.agents/**`

## 禁止触碰的文件

- `apps/api/src/db/migrations/0001` ～ `0005` —— **已应用的迁移绝对不许改**，只能新增
- `packages/**` —— 除非用户明确批准（限额不属于跨边界契约）
- `apps/api/src/workers/typst-sandbox.ts` —— 沙箱已加固，不要动
- `deploy/` 除 nginx conf 外的任何文件

## ⚠️ 已知陷阱

1. **迁移只能新增。** `0001`～`0005` 已在 Day 10 staging 应用过，改它们会让已有数据库无法对齐。
   新建 `0006_artifact_lifecycle.sql`。

2. **`compile_jobs` 表上有严格 CHECK 约束**（见 `0005`）：
   - `(status='processing') = (processing_token IS NOT NULL AND processing_started_at IS NOT NULL)`
   - `status='succeeded'` 必须有 `artifact_key` + `artifact_byte_length >= 5` + `error_code IS NULL`
   - `status='failed'` 必须有 `error_code` 且 `artifact_key IS NULL`

   → 新增 `expires_at` 列时，**不要**写出会与这些约束冲突的新约束。先读 `0005` 再动手。

3. **限流插件需要新增依赖**（`@fastify/rate-limit`）。新增依赖必须：
   - 先问用户批准
   - 用 pnpm 装到 `apps/api`：`pnpm --filter @depress/api add @fastify/rate-limit`
   - 确认 `pnpm-lock.yaml` 变更被提交

4. **限流不能挡住健康检查。** `/health/live` 和 `/health/ready` 必须豁免，
   否则 systemd / nginx 的健康探测会被自己的限流打死。

5. **`/references/doi/lookup` 是未认证路由**（走 Crossref 外网），
   它是最需要限流的那个，别漏了。

6. **清理任务不要写成"应用启动时自动跑"。** `architecture.md` §3.9 明确：
   应用不在启动时自动迁移生产数据库。清理任务同理，应该是独立入口或定时触发。

## 执行步骤

1. 读 `apps/api/src/db/migrations/0005_compile_job_processing_ownership.sql` 全文，
   确认现有约束（陷阱 2）。
2. 输出 ≤10 行计划，明确三件事各自怎么做、要不要加依赖、迁移列名，等用户批准。
3. **大小上限**：在 `app.ts` 的 Fastify 构造里设 `bodyLimit`，值从 `env.ts` 读（带安全默认）。
   与 `deploy/nginx/depress-api.conf` 的 `client_max_body_size` 对齐到同一个数字。
4. **限流**：注册 `@fastify/rate-limit`，豁免 `/health/*`。
   为 `/references/doi/lookup` 和 `/api/compile-jobs` 单独设更严格的配额。
5. **在途 job 上限**：在 `POST /api/compile-jobs` 创建前，
   查询该 owner 处于 `accepted|queued|processing` 的 job 数，超限返回明确的安全错误码（如 429 + `COMPILE_JOB_LIMIT`）。
   错误码要加进 `packages/ast` 吗？—— **如果需要改 `packages/ast`，先停下问用户**。
6. **artifact 生命周期**：新建迁移加 `expires_at`；写入成功时设置过期时间；
   下载路由在签名前检查未过期；提供一个**独立的**清理入口（不在应用启动时自动跑）。
7. 每一项都补对应单测：超限被拒、豁免路径不被限、过期 artifact 不可下载。

## 验收标准

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | 超大请求体被拒 | 新增单测 | 返回 413（或明确的安全错误码） |
| 2 | 限流生效 | 新增单测 | 超过配额返回 429 |
| 3 | 健康检查不被限流 | 新增单测 | 连续请求 `/health/live` 始终 200 |
| 4 | 在途 job 超限被拒 | 新增单测 | 返回安全错误码，且**不会**创建多余的 job 行 |
| 5 | 过期 artifact 不可下载 | 新增单测 | 下载路由不返回签名 URL |
| 6 | 新迁移可在全新库上应用 | `DEPRESS_POSTGRES_TEST_URL=... pnpm --filter @depress/api test` | 迁移集成测试通过 |
| 7 | nginx 与 Fastify 上限一致 | `grep client_max_body_size deploy/nginx/depress-api.conf` 对比 `bodyLimit` 默认值 | 同一数字 |
| 8 | 全套校验 | `pnpm lint && pnpm typecheck && pnpm test` | 退出码 0 |
| 9 | 构建 | `DEPRESS_API_ORIGIN=http://127.0.0.1:3001 pnpm build` | 退出码 0 |

## 停止条件

- 需要修改 `packages/ast` 才能表达新错误码 → **停**并问用户（这是跨边界契约变更）
- 需要修改 `0001`～`0005` 任一迁移 → **停**（方案错了）
- 新增依赖未获批准 → **停**
- 加了 CHECK 约束后现有测试数据插不进去 → **停**并把约束冲突原样报告

## 完成后必须更新

- [ ] `03-task-board.md`：T-04 状态 + 日期 + 完成历史
- [ ] `01-current-state.md`：§1 表格 P4-10 行改为部分完成；§3 的 🟠 P4-10 一节按实际改写
- [ ] `deploy/README.md` 若限额影响运维行为，需追加说明 —— **改前问用户**
- [ ] 本文件 `## 完成记录`

## 完成记录

- 完成日期：
- 新增依赖：
- 新增迁移文件名：
- 三项限额的实际数值：
- 验收实测输出：

## 阻塞记录

-
