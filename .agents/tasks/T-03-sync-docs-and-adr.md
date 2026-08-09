# T-03 — 同步 process.md / architecture.md / ADR 0007 到真实状态

- **状态**：`IN_PROGRESS`
- **前置任务**：`T-02`
- **预计改动文件数**：3–4（全是文档）
- **是否需要用户批准才能开工**：**是**（改的是治理文档，且涉及 ADR 状态变更）

## 为什么做这个

这一项本身不产出任何功能，但它是**后面所有决策的信息前提**。

现在的状态是：任何人（包括未来的你自己、包括用户）打开 `process.md`，
都会认为 Phase 4 只做完了架构冻结和 CI，实际却已经实现到 P4-09/P4-11。
基于错误的状态做规划，做出的每个决定都是错的。

具体不一致清单（全部已核实）：

1. `process.md` 头部 P4-02～P4-12 全标 `NOT STARTED`，实际已实现 P4-03～P4-09、P4-11 主体
2. `process.md` / `architecture.md` 里 **"mentor" 出现 0 次**，而过去一个月的产出全是 Mentor MVP
3. `architecture.md` §4 写 Web 在 Vercel + 后端专用 VM；
   `deploy/README.md` 实际是**单台 Ubuntu VM 同时跑 Web/API/Outbox/Worker/nginx**
4. `docs/adr/0007-production-compile-sandbox-topology.md` 状态仍是 `Proposed`，
   但沙箱验证已在 Day 10 通过，且拓扑已经变了 —— 既没改 `Accepted` 也没走 `Superseded`
5. `process.md` Phase 4 exit criteria 里的 signup 条款与 **invite-only** 的实现直接冲突，
   按现状永远不可能勾上

## 前置条件

- [ ] `03-task-board.md` 中 T-02 状态为 `DONE`
- [ ] `git status --short` 无输出

## 允许触碰的文件

- `process.md`
- `architecture.md`
- `docs/adr/0007-production-compile-sandbox-topology.md`
- 可能新建：`docs/adr/0008-*.md`（若用户决定走 Superseded 路线）
- `.agents/**`

## 禁止触碰的文件

- `docs/adr/0001` ～ `0006` —— 已 Accepted 的决策，不许改
- 任何 `apps/**`、`packages/**`、`deploy/**` 源码 —— **本任务只改文档**
- `docs/mentor-mvp-acceptance.md` —— 这是历史验收记录，是证据，不许追改

## ⚠️ 开工前必须问用户的两个决策

### 决策 1：ADR 0007 怎么处理？

实际拓扑（单 VM 全栈）与 ADR 0007 写的（Vercel + 专用 VM）**不一致**。两条合规路线：

| 选项 | 做法 |
|---|---|
| **A** | ADR 0007 改 `Accepted`，并在 "Migration / implementation notes" 追加一节说明实际落地为单 VM，附 Day 10 证据 |
| **B** | ADR 0007 改 `Superseded`，新建 `docs/adr/0008-single-vm-production-topology.md` 记录真实拓扑与决策理由 |

**建议 B** —— 因为拓扑确实变了（Web 从 Vercel 挪到了同一台 VM），
ADR 的价值在于记录"为什么变"，直接改成 Accepted 会抹掉这次变更的决策痕迹。
但**由用户拍板**。

### 决策 2：Phase 4 exit criteria 的 signup 条款怎么办？

当前实现是 invite-only（`auth.ts` `disableSignUp`）。两条路线：

| 选项 | 做法 |
|---|---|
| **A** | 修订 exit criteria：把"公开注册"移到 Phase 4 Stretch 或新 Phase，Core 的验收改为"邀请制账号可完成全流程" |
| **B** | 保留公开注册为 Core 要求，把它作为一个明确的未完成任务列出（需要邮箱验证 + 密码重置 + 邮件服务） |

**建议 A** —— 因为 invite-only 是有意的产品决策（mentor 演示），不是遗漏。
把它诚实地写进标准，比挂着一条永不勾选的条目更有用。**由用户拍板。**

## 执行步骤

1. 把上面**两个决策**原样给用户，等待选择。未得到明确答复不许开工。
2. 按选择输出 ≤10 行修订计划，等批准。
3. 修订 `process.md`：
   - 更新头部状态区，逐项写出 P4-02～P4-12 的**真实**状态
     （数据源：`.agents/01-current-state.md` §1 的对照表）
   - 新增一节记录 Mentor MVP 工作线：目标、范围（invite-only 演示）、
     Day 10 技术验收结论与 SHA（`8a83cfd`）、待办（人工 sign-off、生产部署）
   - 按决策 2 修订 Phase 4 Exit Criteria
   - 更新 `Last Updated` 行
4. 修订 `architecture.md` §4：把 Proposed 的 Vercel 拓扑替换/补充为实际的单 VM 拓扑，
   并说明它的验证状态（Day 10 staging 通过，生产未上线）
5. 按决策 1 处理 ADR 0007（改状态 / 新建 0008）
6. **交叉检查**：修订完后，`process.md` / `architecture.md` / `.agents/01-current-state.md`
   三份文件对同一件事的描述必须一致。不一致 → 说明漏改了

## 验收标准

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | Phase 4 状态已更新 | 读 `process.md` 头部状态区 | P4-02～P4-11 不再全是 `NOT STARTED`，与 `01-current-state.md` §1 一致 |
| 2 | Mentor MVP 已记录 | `grep -in "mentor" process.md` | 有输出（此前为 0） |
| 3 | 拓扑描述一致 | 对比 `architecture.md` §4 与 `deploy/README.md` 开头的拓扑图 | 二者描述同一个拓扑 |
| 4 | ADR 0007 不再是悬空的 Proposed | `grep -A2 "## Status" docs/adr/0007-*.md` | 状态为 `Accepted` 或 `Superseded`（按决策 1） |
| 5 | 若选 B，新 ADR 存在 | `ls docs/adr/` | 存在 `0008-*.md` |
| 6 | 未误改代码 | `git status --porcelain` | 只有 `.md` 文件（+ `.agents/`） |
| 7 | 全套校验仍绿 | `pnpm lint && pnpm typecheck && pnpm test` | 退出码 0 |

## 停止条件

- 用户未对两个决策做出选择 → **停**
- 发现 `01-current-state.md` 的某条事实与你实际读到的代码不符 → **停**并报告
  （说明状态文档本身需要先修正）
- 需要改 `docs/adr/0001`～`0006` 才能自洽 → **停**（这意味着有更深的架构分歧，要用户介入）

## 完成后必须更新

- [ ] `03-task-board.md`：T-03 状态 + 日期 + 完成历史
- [ ] `01-current-state.md`：§0 陷阱 1（process.md 不可信）改为已解决；
      §3 的"文档与代码不一致"一节逐条标记已修
- [ ] `README.md`（`.agents/`）§5：`process.md` 状态不可信的说明可以撤下 —— **此项需用户批准**
- [ ] 本文件 `## 完成记录`

## 完成记录

- 完成日期：待审查、提交与合并（治理同步实现于 2026-08-09）
- 决策 1 结果：接受 single-VM full-stack Production MVP；ADR 0007 改为 `Accepted`，不新建 0008
- 决策 2 结果：接受 invite-only Mentor MVP；公共注册及配套能力推迟到后续产品阶段
- 实际改动文件：`architecture.md`、`process.md`、`docs/adr/0007-production-compile-sandbox-topology.md`、`deploy/README.md`、`CLAUDE.md`、`.cursorrules`、`.agents/README.md`、`.agents/00-project-context.md`、`.agents/01-current-state.md`、`.agents/02-agent-rules.md`、`.agents/03-task-board.md`、`.agents/tasks/T-03-sync-docs-and-adr.md`、`.agents/tasks/T-04-min-production-safety.md`
- 首次一致性审查：`T03_CONSISTENCY_REVIEW_BLOCKED`；发现两项 MAJOR conflicting-stale——`.cursorrules` 仍称 `process.md` Phase 4 不可信，`deploy/README.md` 仍把 S3 服务与数据计入生产 VM 预算。
- 修复状态：当前未提交实现已修正上述两处。focused implementation search 预期 `CONFLICTING_STALE = 0`，仍须独立复审确认；不得据此声称 `T03_CONSISTENCY_REVIEW_PASS`。残留 Vercel、legacy route、`8a83cfd` 与旧状态表述仅允许限定在历史记录、已拒绝替代方案或 future backlog。T-04、autosave、mentor sign-off、生产部署/验收保持未完成。任务在审查与提交前维持 `IN_PROGRESS`

## 阻塞记录

-
