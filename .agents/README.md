# DePress Agent Workflow — 入口文件

> **任何 agent 在本仓库做任何事之前，必须先完整读完本文件。**
> 本目录是给 AI agent 用的操作手册，不是给人看的项目介绍。

## 0. 这是什么

`.agents/` 记录 DePress 项目的**真实状态**、**硬性规则**和**已排序的可执行任务**。
它的存在原因：仓库根目录的 `process.md` 目前**严重滞后于代码实际状态**
（详见 [`01-current-state.md`](01-current-state.md) §0），直接照 `process.md` 干活会得出错误结论。

在 `process.md` 被修正（任务 `T-03`）之前，**本目录是项目状态的唯一可信来源**。

## 1. 强制阅读顺序

每次会话开始，按顺序读完这 4 个文件，不许跳过、不许只读标题：

| 顺序 | 文件 | 作用 |
|---|---|---|
| 1 | [`02-agent-rules.md`](02-agent-rules.md) | 禁止事项、停止条件、常用命令。**违反即为事故** |
| 2 | [`00-project-context.md`](00-project-context.md) | 项目是什么、架构、不可违反的 Hard Invariants |
| 3 | [`01-current-state.md`](01-current-state.md) | 现在真实完成到哪一步、哪些是坑 |
| 4 | [`03-task-board.md`](03-task-board.md) | 该做哪个任务、顺序、当前状态 |

然后从 `03-task-board.md` 里取**第一个状态不是 `DONE` 的任务**，打开 `tasks/` 下对应文件，
严格按里面的步骤执行。**一次只做一个任务。**

## 2. 会话协议（每次都要走）

### 开始时

1. 读完上面 4 个文件。
2. 用 `01-current-state.md` §0 陷阱 2 给出的**产品改动计数命令**自检工作树状态。
   - 若与预期不一致：**停下**，把差异报告给用户，等待指示。
   - 注意：不要用 `git status --short` 的总行数去比对，工作流文件也会计入。
3. 在 `03-task-board.md` 找到当前任务，把它的状态改成 `IN_PROGRESS`，写上日期。
4. 打开 `tasks/T-xx-*.md`，逐条执行 `## 执行步骤`。

### 结束时

1. 逐条核对任务文件里的 `## 验收标准`，**每一条都要真的跑命令**，不许凭感觉判断通过。
2. 全部通过 → 在 `03-task-board.md` 把状态改为 `DONE`，并在任务文件底部 `## 完成记录` 填写实测结果。
3. 有任何一条没通过 → 状态改为 `BLOCKED`，在任务文件 `## 阻塞记录` 写清楚：
   卡在哪一步、跑了什么命令、实际输出是什么。**不要自己发明变通方案。**
4. 按 [`templates/session-handoff.md`](templates/session-handoff.md) 输出一份交接摘要给用户。

## 3. 目录结构

```
.agents/
├── README.md                  ← 你正在读的文件，入口
├── 00-project-context.md      ← 项目定位 / 架构 / Hard Invariants / 目录地图
├── 01-current-state.md        ← 真实完成度 / 已实现能力 / 缺口与风险（活文档）
├── 02-agent-rules.md          ← 禁止事项 / 停止条件 / 命令手册
├── 03-task-board.md           ← 任务索引与状态（活文档）
├── tasks/
│   ├── T-01-worktree-and-ci.md
│   ├── T-02-remove-legacy-compile-contract.md
│   ├── T-03-sync-docs-and-adr.md
│   ├── T-04-min-production-safety.md
│   └── T-05-autosave-and-mentor-signoff.md
└── templates/
    ├── task-template.md       ← 新增任务时复制这个
    └── session-handoff.md     ← 每次会话结束的交接格式
```

## 4. 活文档 vs 冻结文档

| 文件 | 谁可以改 | 什么时候改 |
|---|---|---|
| `01-current-state.md` | agent | 任务完成后，更新对应事实 |
| `03-task-board.md` | agent | 每次开始/结束任务时更新状态 |
| `tasks/T-xx-*.md` | agent | 只能填 `## 完成记录` / `## 阻塞记录` 两节，**其余内容不许改** |
| `00-project-context.md` | 仅用户批准后 | 架构发生真实变更时 |
| `02-agent-rules.md` | 仅用户批准后 | 规则变更时 |
| `README.md` | 仅用户批准后 | 流程变更时 |

## 5. 与仓库既有规则的关系

- `.cursorrules` 仍然有效，**本目录不覆盖它**，只是补充"当前该做什么"。
- `architecture.md` 是架构真相，仍然有效。
- `process.md` 的**阶段状态部分当前不可信**（见 `01-current-state.md` §0），
  但它的 Phase 1–3 历史验收记录是可信的。任务 `T-03` 专门修这个问题。

## 6. 本目录的信息来源

2026-08-04 对 `feature/phase4-mentor-mvp` 分支做的一次只读结构化分析，
依据：`architecture.md`、`process.md`、`docs/adr/*`、`docs/mentor-mvp-acceptance.md`、
`packages/{ast,templates,transformers}`、`apps/{web,api}`、`deploy/`、`e2e/day10/`、
`docker-compose.yml`、`.env.example`、`git log`、`git status`。

**该分析未运行任何测试**。所有"测试通过"类陈述都来自仓库既有记录，不是实测。
