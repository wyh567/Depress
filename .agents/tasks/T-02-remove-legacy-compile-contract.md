# T-02 — 移除遗留未认证编译入口与死代码

- **状态**：`DONE`
- **前置任务**：`T-01`（工作树必须先干净）
- **预计改动文件数**：15–20（**超过 3 个 → 必须先出计划等用户批准**）
- **是否需要用户批准才能开工**：**是**，且中途有一个必须问用户的决策点

## 为什么做这个

`apps/api/src/app.ts` 无条件调用 `registerCompileRoute`，
生产 API 进程仍然暴露 **未认证的 `POST /compile`**（`apps/api/src/routes/compile.ts` 全文无任何鉴权）
和 `GET /jobs/:id`。

后果：

- 目前只靠 nginx 返 404 挡住 → **单层边缘防护**。代理配置回退、端口暴露、内网访问都能绕过
- 生产 systemd 只跑 pointer-worker，**没有 legacy worker 消费这个队列** →
  匿名入队的任务在 Redis 里无限堆积 → 低成本内存耗尽
- 违背 `architecture.md` §3.5 "Public anonymous compile is forbidden"
- 这是 P4-09 final cutover gate 的最后一步。不做完，Phase 4 的"匿名编译返回 401"就不成立

## 前置条件（逐条验证，任一不满足就停）

- [ ] `03-task-board.md` 中 T-01 状态为 `DONE`
- [ ] `git status --short` 无输出（工作树干净）
- [ ] `pnpm test` 通过（有一个已知良好的基线）

## ⚠️ 开工前必须问用户的决策点

删掉 `POST /compile` 会**连带打断 5 个 Phase 3 遗留 smoke 测试**，它们都通过这条路径验证真实编译链路：

- `apps/api/src/roundtrip.smoke.test.ts`
- `apps/api/src/citation.smoke.test.ts`
- `apps/api/src/elsevier.smoke.test.ts`
- `apps/api/src/gbt7714.smoke.test.ts`
- `apps/api/src/phase3-exit.smoke.test.ts`

（这些测试默认 skip，需要 `DEPRESS_*_SMOKE=1` + Redis/MinIO/Docker 才跑。）

**把三个选项原样给用户，等他选，不要自己决定：**

| 选项 | 做法 | 代价 |
|---|---|---|
| **A** | 删掉这 5 个 smoke 测试 | Phase 3 证据已记录在 `process.md`，但失去可重跑的真实链路回归 |
| **B** | 把它们改写到认证后的 `/api/compile-jobs` 路径 | 工作量大（需要建 session + project + document + reference），但保住回归能力 |
| **C** | 保留路由但默认关闭（`buildApp` 加 opt-in 开关，仅测试打开） | 最小改动，生产不再暴露；但死代码继续留在仓库里 |

**建议向用户推荐 C 作为本任务范围，A/B 单独排期** —— 理由：本任务的目标是"生产不再暴露未认证入口"，
把"清理死代码"和"迁移回归测试"混进来会让 diff 大到无法审查。
但**最终由用户拍板**，用户选了什么就做什么。

## 允许触碰的文件

> 具体范围取决于用户选的方案。以下是**选项 C** 的白名单：

- `apps/api/src/app.ts`
- `apps/api/src/routes/jobs.ts`（仅为搬移 `ArtifactUrlSigner` 类型，见下）
- `apps/api/src/app.test.ts`
- `.agents/**`

**选项 A** 额外允许删除：上面 5 个 smoke 测试文件。

**选项 B** 额外允许改写：上面 5 个 smoke 测试文件。

## 禁止触碰的文件

- `apps/api/src/routes/compile-jobs.ts` —— 这是**新的**目标契约，不要动
- `apps/api/src/workers/compile-pointer-*.ts` —— 生产 worker，不要动
- `packages/**` —— 本任务不涉及契约变更
- `deploy/**`、`e2e/**` —— 不要动

## ⚠️ 已知陷阱（先看，能省你两小时）

1. **`ArtifactUrlSigner` 类型定义在待删文件里。**
   `apps/api/src/routes/jobs.ts:10` 定义了它，但 `app.ts` 和
   **仍在生产使用的** `routes/compile-jobs.ts:12` 都 import 它。
   → 删 `jobs.ts` 之前，必须先把这个类型搬到一个中立位置
   （建议 `apps/api/src/routes/artifact-url-signer.ts` 或 `apps/api/src/services/s3.ts`），
   并更新两处 import。**顺序搞反会导致一片红。**

2. **`app.ts` 底部有 re-export**：

   ```ts
   export * from "./contracts";
   export * from "./queue/compile-queue";
   export * from "./services/job-reader";
   ```

   删对应文件时这些 re-export 也要同步处理，否则 `@depress/api` 的入口会断。

3. **`apps/api/src/app.test.ts` 和 `queue/compile-queue.test.ts` 直接测 `/compile`**，
   删路由必然影响它们。

4. **web 侧死代码**（`editor-area.tsx` 已不再挂载它们，可安全删）：
   `components/editor/export-pdf-button.tsx`、`compile-export.ts`、`use-compile-export.ts`
   及其 `.test.ts(x)`。
   → 但这属于"清理死代码"，**只在用户选 A 或明确要求时才做**，不要塞进选项 C。

## 执行步骤

1. 把上面的**决策点**三个选项完整呈现给用户，等待选择。**未得到明确选择不许开工。**
2. 按选定方案输出 ≤10 行编号计划，等用户批准。
3. **先搬 `ArtifactUrlSigner`**（如果方案涉及删除 `routes/jobs.ts`）：
   新建中立模块 → 更新 `app.ts` 和 `routes/compile-jobs.ts` 的 import → 跑 `pnpm typecheck` 确认绿。
4. 再做主改动（按选定方案）。
5. 更新受影响的测试，让它们断言**新的正确行为**
   （例如选 C：默认构建的 app 上 `POST /compile` 返回 404）。
   **不许**为了让测试过而删断言或加 skip。
6. 跑完整验收。

## 验收标准

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | 默认构建的 app 不再暴露未认证编译入口 | 新增/更新的单测（`app.test.ts`） | `POST /compile` 返回 404（或路由不存在） |
| 2 | 认证编译路径不受影响 | `pnpm --filter @depress/api test` | `compile-jobs` 相关测试全过 |
| 3 | 类型检查通过 | `pnpm typecheck` | 退出码 0 |
| 4 | Lint 通过 | `pnpm lint` | 退出码 0 |
| 5 | 全量默认测试通过 | `pnpm test` | 全过，无新增 skip |
| 6 | 构建通过 | `DEPRESS_API_ORIGIN=http://127.0.0.1:3001 pnpm build` | 退出码 0 |
| 7 | 无残留引用 | `grep -rn "registerCompileRoute" apps/api/src` | 仅在允许保留的位置出现（选 C 时是 opt-in 分支内） |

## 停止条件

- 用户未在决策点做出选择 → **停**
- `pnpm typecheck` 出现你无法定位来源的类型错误 → **停**并把完整错误给用户
- 发现某个"死代码"其实仍被生产入口引用（`server.ts` / `pointer-worker-main.ts` / `outbox-main.ts`）→ **停**
- 需要修改 `packages/ast` 才能推进 → **停**（说明方案选错了）

## 完成后必须更新

- [ ] `03-task-board.md`：T-02 状态 + 日期 + 完成历史
- [ ] `01-current-state.md`：§3 的 🔴 高危一节改写为"已解决"或"部分解决（剩余死代码待清理）"；
      §5 API 路由清单里的两行遗留路由更新
- [ ] 本文件 `## 完成记录`

## 完成记录

- 完成日期：2026-08-08
- 用户选定方案：A（完全移除 legacy 未认证契约与死架构）
- 实际改动文件：`app.ts` / `server.ts` 去 legacy wiring；新增中立 artifact contracts 与 authenticated compile executor；删除 legacy routes/Queue/store/reader/worker/processor adapter、5 个 smoke、legacy-only tests 和未挂载 Web export 路径；更新 pointer-contract 与 404 测试。
- 验收实测输出：直连 Fastify `POST /compile` / `GET /jobs/:id` 均为 404，未认证 `/api/compile-jobs` 为 401；定向 API 93 passed / 27 skipped，Web 13 passed；全量 405 passed / 46 skipped；lint 5/5、typecheck 5/5、build 通过。相比 475/51 基线，删除 77 个 legacy passing tests + 5 个 skipped smoke，新增 7 个聚焦测试，净变化 -70 passed / -5 skipped。

## 阻塞记录

-
