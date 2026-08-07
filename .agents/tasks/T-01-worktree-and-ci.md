# T-01 — 整理工作树 + 让 CI 覆盖本分支

- **状态**：`DONE`
- **前置任务**：无
- **预计改动文件数**：1（`.github/workflows/ci.yml`）+ 提交动作
- **是否需要用户批准才能开工**：否，但**提交前必须经用户批准**

## 为什么做这个

工作树现在有 58 个未提交文件，包括几乎全部 `deploy/` 安全脚本、`e2e/day10/` 编排、
IEEE/GB/T 渲染器改动和 4 个 snapshot。这些改动：

- 不在 Day 10 验收的 SHA（`8a83cfd`）里 → 别人克隆仓库复现不了验收结果
- 没进过 CI → 没有任何自动化验证
- 会和后续任何新改动混在一起 → diff 无法审查，出事无法回滚

同时 CI 只在 master 的 PR/push 触发，当前分支 `feature/phase4-mentor-mvp` 推送**不跑 CI**，
等于这条分支上一个多月的产出全靠人工判断。

**这两件事不解决，后面每个任务都是在流沙上盖房子。**

## 前置条件（逐条验证，任一不满足就停）

- [ ] `git branch --show-current` → 期望：`feature/phase4-mentor-mvp`
- [ ] `git status --short` 有输出（工作树确实是脏的）。若已经干净 → 跳到步骤 6

## 允许触碰的文件

- `.github/workflows/ci.yml`
- `.agents/**`（状态更新）

## 禁止触碰的文件

- 任何 `apps/**`、`packages/**`、`deploy/**`、`e2e/**` 的源码 —— 本任务**只整理与验证，不修改产品代码**

## 执行步骤

### 第一部分：摸清工作树

1. 运行并**完整记录**输出：

   ```bash
   git status --short
   ```

2. 按目录分组统计，产出一张表（改动文件数按组）：

   ```bash
   git status --porcelain | awk '{print $NF}' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn
   ```

3. 查看改动规模：

   ```bash
   git diff --stat
   ```

### 第二部分：在当前脏树上跑全套校验

> 目的是回答一个问题：**这 58 个文件的改动是好的吗？**
> 任一命令失败 → 记录完整错误，**停下报告用户**，不要自己修。

4. 依次运行，每条都记录实际输出：

   ```bash
   pnpm lint
   ```

   ```bash
   pnpm typecheck
   ```

   ```bash
   pnpm test
   ```

   ```bash
   DEPRESS_API_ORIGIN=http://127.0.0.1:3001 pnpm build
   ```

5. 对 shell 脚本做静态语法检查（Windows 上无法真正执行它们）：

   ```bash
   for f in deploy/*.sh deploy/nginx/*.sh deploy/systemd/*.sh e2e/day10/*.sh e2e/day10/operator-validation/*.sh; do bash -n "$f" || echo "SYNTAX FAIL: $f"; done
   ```

### 第三部分：提交（**必须先经用户批准**）

6. 按逻辑分组提出**提交计划**（≤10 行），交给用户批准。建议分组：

   - `deploy/`：生产部署与权限自检脚本
   - `e2e/day10/`：验收编排与 Playwright
   - `packages/{ast,templates,transformers}` + `apps/web` 元数据面板：双语学术元数据与三模板渲染
   - `process.md`：状态记录

7. **等用户明确说"可以提交"再动手。** 未获批准 → 任务状态记为 `BLOCKED`，
   在 `## 阻塞记录` 写明"等待用户批准提交"，然后结束会话。

8. 获批后逐组提交。提交信息沿用仓库既有风格（`type(scope): 祈使句描述`，见 `git log --oneline -20`）。

### 第四部分：让 CI 覆盖本分支

9. 编辑 `.github/workflows/ci.yml`，把 `pull_request` 和 `push` 的分支范围扩到功能分支。
   当前是：

   ```yaml
   on:
     pull_request:
       branches:
         - master
     push:
       branches:
         - master
   ```

   目标：`pull_request` 保持只针对 master（PR 到 master 时跑），
   `push` 增加 `feature/**`，使功能分支推送也跑 CI。

10. 改完再跑一次 `pnpm lint`（yaml 不在 lint 范围，但确认没误改别的文件）。

11. CI 改动同样**需用户批准后**才提交。

## 验收标准

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | Lint 通过 | `pnpm lint` | 全部 task 成功，退出码 0 |
| 2 | 类型检查通过 | `pnpm typecheck` | 全部 task 成功，退出码 0 |
| 3 | 默认测试通过 | `pnpm test` | 全部通过；opt-in 测试显示 skipped（正常） |
| 4 | 生产构建通过 | `DEPRESS_API_ORIGIN=http://127.0.0.1:3001 pnpm build` | 退出码 0 |
| 5 | shell 脚本语法通过 | 步骤 5 的循环 | 无 `SYNTAX FAIL` 输出 |
| 6 | 工作树干净 | `git status --short` | 无输出（或仅剩 `.agents/` 的状态更新） |
| 7 | CI 覆盖本分支 | 查看 `.github/workflows/ci.yml` | `push.branches` 含 `feature/**` |

## 停止条件

- 步骤 4 任一命令失败 → **停**。这说明未提交的改动本身有问题，需要用户判断是修还是回退
- 步骤 5 报出 `SYNTAX FAIL` → **停**。deploy 脚本涉及生产权限，不许自行改
- 用户未批准提交 → **停**，记 `BLOCKED`
- `git status` 里出现你不认识的文件 → **停**并列给用户

## 完成后必须更新

- [ ] `03-task-board.md`：T-01 状态改 `DONE` + 日期；§4 完成历史追加一行
- [ ] `01-current-state.md`：§0 陷阱 2（工作树脏）改为已解决；§3 测试债一节更新 CI 触发范围
- [ ] 本文件 `## 完成记录`

## 完成记录

- 完成日期：（未完成，见阻塞记录）
- 实际提交数与分组：未提交
- 四条校验命令的实测输出：见下方阻塞记录
- CI 改动内容：未开始（步骤 9–11 未执行）

### 第一、二部分实测结果（2026-08-05）

工作树盘点（步骤 1–3）：

- 分支 `feature/phase4-mentor-mvp`，产品改动 **58**（与预期一致）
- 分组：`deploy` 19 · `e2e/day10` 9 · `packages/transformers/src` 6 · `deploy/systemd` 6 ·
  `transformers/__snapshots__` 4 · `packages/templates/src` 2 · `packages/ast/src` 2 ·
  `deploy/nginx` 2 · `apps/web/stores` 2 · 其余各 1
- 规模：43 files changed, 2127 insertions(+), 514 deletions(-)（不含未跟踪文件）

四道校验（步骤 4）：

| 命令 | 结果 |
|---|---|
| `pnpm lint` | ✅ **PASS** 5/5 packages |
| `pnpm typecheck` | ❌ **FAIL** 4/5，`@depress/web` 2 个 TS2345 |
| `pnpm test` | ✅ **PASS** 4/4 tasks，**465 passed / 51 skipped**（ast 104 · web 127 · transformers 61 · api 173+51skip） |
| `DEPRESS_API_ORIGIN=... pnpm build` | ❌ **FAIL**，`@depress/web` 同一根因 |

Shell 语法检查（步骤 5）：✅ **PASS**，41 个脚本全部通过 `bash -n`，无 `SYNTAX FAIL`。

## 阻塞记录

**阻塞点：步骤 4 的 `pnpm typecheck` 与 `pnpm build` 失败**，命中本文件「停止条件」第 1 条。

失败位置：`apps/web/stores/document-metadata.ts` 第 74、76 行，2 个 `error TS2345`。

根因：该文件新增的两个本地辅助函数把参数类型**手写**成结构化字面量：

```ts
function formatAuthorLine(author: { name: string; nameEn?: string; affiliationIds?: string[] }): string
function formatAffiliationLine(affiliation: { id: string; name: string; nameEn?: string }): string
```

而 `tsconfig` 开了 `exactOptionalPropertyTypes: true`，
`@depress/ast` 的 `DocAuthor` / `DocAffiliation` 里对应字段是 `nameEn?: string | undefined`。
`string | undefined` 不能赋给 `string`，`.map(formatAuthorLine)` 因此报错。

**这是未提交改动引入的，不是既有问题** —— 已用 `git show HEAD:apps/web/stores/document-metadata.ts`
核实：HEAD 版本中 `nameEn` 出现 0 次。

**附带发现**：这两个手写结构化类型本身**违反 Hard Invariant #3**
（`packages/ast` 是唯一类型源，禁止手写 interface 双份维护）。
因此正确修法不是补 `| undefined`，而是直接 import 并使用 `@depress/ast` 导出的
`DocAuthor` / `DocAffiliation`——一次同时解决类型错误和不变量违规。

**为什么没有自行修复**：本任务「禁止触碰的文件」明确排除了所有 `apps/**` 源码，
本任务只整理与验证、不修改产品代码。等用户决定「修」还是「回退」。

**环境插曲（已解决，不构成阻塞）**：本机 `pnpm` 不在 PATH 上，
`corepack enable` 因权限失败。已用 ASCII 路径副本 + shim 绕过，
详情与永久解法已记入 `02-agent-rules.md` §6。

---

### ✅ 阻塞已解除（2026-08-05）

由独立任务 [`T-01A`](T-01A-fix-duplicated-metadata-types.md) 修复：
`formatAuthorLine` / `formatAffiliationLine` 的手写结构参数类型已替换为
`@depress/ast` 公开导出的 `DocAuthor` / `DocAffiliation`。

修复后四道校验全绿：

| 命令 | 修复前 | 修复后 |
|---|---|---|
| `pnpm lint` | ✅ 5/5 | ✅ 5/5 |
| `pnpm typecheck` | ❌ 4/5 | ✅ **5/5** |
| `pnpm test` | ✅ 465/51skip | ✅ 465/51skip |
| `pnpm build` | ❌ FAIL | ✅ **PASS** |

**T-01 状态回到 `IN_PROGRESS`，从步骤 6（提出提交计划、等用户批准）继续。**
步骤 1–5 的实测结果见上方「完成记录」，无需重跑。

---

### ✅ 最终收尾（用户批准，DONE）

**最终 commit 链**（本仓库仅本地存在，均未 push）：

| # | SHA | 标题 |
|---|---|---|
| 1 | `fc7b65f` | `docs(agents): add agent workflow and correct stale entry points` |
| 2 | `d7dcff7` | `feat(metadata): add bilingual academic metadata and complete IEEE front matter` |
| 3 | `6e0d909` | `test(sandbox): pin runtime identity in compile processor fixture` |
| 4 | `fa4977a` | `feat(deploy): complete hardened single-VM production topology with Web tier` |
| 5 | `b29126d` | `feat(e2e): add operator validation bundle generator` |
| 6 | `516c20c` | `refactor(e2e): make Day10 harness environment-overridable` |
| 7 | `f9626f0` | `docs(agents): close T-01 and record validated workflow state` |
| 8 | `e1ff2f4` | `fix(ci): run CI on feature branches` |
| 9 | `aaf3685` | `docs(agents): synchronize current state after T-01 completion` |

原始 58 个未提交产品改动，按意图拆分为提交 1–6（提交 7 是 `.agents` 状态收尾，
提交 8 补齐 CI 触发范围，提交 9 同步 Agent 当前状态文档）。
每个提交的详细分组理由、staging 决策、ECS 隔离验证过程见本轮会话记录；
本文件只保留后续 agent 需要的结论，不复制过程。

**验证状态**：全套 `lint / typecheck / test / build` 在最终提交前完整重跑一次，
测试基线为 **465 passed / 51 skipped**，与整个提交链过程中的历次实测一致。
已知 skipped 测试全部是 opt-in 基础设施测试（清单见 `02-agent-rules.md` §5 的表格），
本机（Windows）无法运行，不构成回归。

**Remote candidate evidence**：提交 4（部署拓扑）与提交 5（operator-validation）在提交前
均已上传到 ECS 上的一次性隔离目录并完成 SHA-256 校验 + `bash -n` + 部分测试实际运行，
本会话内确认目录仍存在、未被清理。具体路径与主机身份属操作细节，不记录在本文件
（避免把机器/网络专属信息固化进仓库）。

**当前 Git 状态**（截至 `aaf3685` 时点的 T-01 最终快照）：分支 `feature/phase4-mentor-mvp`
本地领先 `origin`（`upstream` 仍指向 `7a59a5a51ca665c6694f0dc5be7a0fa8569406c0`）
共 **9** 个提交，尚未 `push`，未修改任何 PR。
**下一步操作是用户决定是否 push / 发起 PR review，不是继续整理工作树。**

**⚠️ 已知未完成项（记录保留，历史准确）**：原任务验收标准第 7 条要求
把 `.github/workflows/ci.yml` 的 `push.branches` 从 `master` 扩展到含 `feature/**`，
使当前分支的推送也能跑 CI。**在上面这次收尾时这一步从未执行**——`.github/workflows/ci.yml`
在当时的整个提交链中未被改动过。用户在那一轮收尾时未将其列入最终验收范围，因此本任务
当时标记 `DONE`，但这个缺口原样保留。

---

### ✅ 缺口已在最终审查阶段补齐（2026-08-07）

用户在最终审查中发现验收标准第 7 条尚未闭合，要求单独处理。核实结果：
`pull_request.branches` 与 `push.branches` 当时均**精确匹配** `master`（非 glob），
确实未被任何等价规则覆盖 `feature/**`，因此执行最小修改：只给 `push.branches`
新增一项 `"feature/**"`，`pull_request.branches` 保持不变（与原验收标准 #9 的
目标描述一致："`pull_request` 保持只针对 master……`push` 增加 `feature/**`"）。

提交 `e1ff2f4 fix(ci): run CI on feature branches`，净改动仅 1 行新增，
`jobs`/`steps`/`permissions`/actions 版本、`master` 触发行为均未动。
`pnpm lint`、`pnpm typecheck` 均通过，`git diff --check` 无告警。

**原验收标准第 7 条现在真正闭合**：`push.branches` 含 `feature/**`。
T-01 的全部原验收标准（含这一条）现在都已满足，不再有已知遗留缺口。
