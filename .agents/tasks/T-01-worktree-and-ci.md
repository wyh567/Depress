# T-01 — 整理工作树 + 让 CI 覆盖本分支

- **状态**：`NOT_STARTED`
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

- 完成日期：
- 实际提交数与分组：
- 四条校验命令的实测输出：
- CI 改动内容：

## 阻塞记录

-
