# Agent 硬性规则

> 优先级高于任何任务文件。任务文件与本文件冲突时，以本文件为准。

## 1. 绝对禁止（做了就是事故）

以下操作**任何情况下都不许自己发起**，必须由用户明确指示：

- `git commit` / `git push` / `git merge` / `git rebase` / `git reset` / `git restore` / `git checkout -- <file>`
- `git stash`（会让 58 个未提交改动消失在视野外）
- 修改、关闭、合并任何 Pull Request
- 删除 `output/`、`tmp/`、`.env` 之外的任何文件
- 在 `packages/ast` 里新增或修改 schema **而不同步更新 web + api 两侧消费者和测试**
- 重新设计架构、替换技术选型、推翻 `docs/adr/` 里已 Accepted 的决策
- 扩大任务范围（scope creep）。看到别的问题 → 写进 `03-task-board.md` 的"发现待办"区，不要顺手做

## 2. 需要先问用户

- 任何超过 3 个文件的改动 → 先输出 ≤10 行编号计划，等批准
- 任何触碰 `packages/ast` 的改动 → 先输出计划，等批准
- 任何触碰 `deploy/` 或 `e2e/day10/` 的改动 → 先输出计划，等批准（这些脚本涉及生产身份与权限）
- 任务文件里写了"需用户确认"的步骤

## 3. 停止条件（立刻停下并报告）

出现以下任一情况，**停止执行、不要尝试修复、直接报告用户**：

1. `git status --short` 的输出与 `01-current-state.md` §0 描述明显不符
2. 任务的"前置条件"检查未通过
3. 同一个命令连续失败 2 次，且失败原因不在任务文件的预期内
4. 需要修改任务文件里 `## 禁止触碰的文件` 列出的文件才能推进
5. 验收标准里的命令输出与预期不符，且你不能 100% 确定原因
6. 发现任何与 Hard Invariants（见 `00-project-context.md` §3）冲突的改动需求

**不许**为了"让测试过"而放宽断言、注释掉测试、加 `skip`、改 snapshot 期望值来迁就实现。
snapshot 只有在**渲染逻辑被有意修改**时才允许更新，且必须在完成记录里写明为什么。

## 4. 代码标准（继承 .cursorrules，此处只列高频踩坑点）

- TypeScript strict + `noUncheckedIndexedAccess`。禁止 `any`，用 `unknown` + 收窄
- 跨边界数据（web ↔ api ↔ worker）**必须**用 `packages/ast` 的 Zod schema 校验，**每个边界都要重新 parse**，不许信任上游
- `packages/transformers` 必须是纯函数，**不许有 I/O**
- `packages/templates` 是不可变字符串常量，**不许改成运行时读文件**
- 文件名 kebab-case，组件 PascalCase，函数 camelCase
- 组件 ≤150 行，逻辑抽成 hook

## 5. 命令手册

在仓库根目录 `D:\depress` 执行。本机是 Windows + PowerShell，但 Bash 工具也可用。

### 日常校验（改完代码必跑）

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

构建需要环境变量，**必须带上**，否则 web 生产构建会因为 `DEPRESS_API_ORIGIN` 缺失而失败：

```bash
DEPRESS_API_ORIGIN=http://127.0.0.1:3001 pnpm build
```

### 单包测试（迭代时更快）

```bash
pnpm --filter @depress/ast test
```

```bash
pnpm --filter @depress/api test
```

```bash
pnpm --filter @depress/web test
```

```bash
pnpm --filter @depress/transformers test
```

### 本地基础设施（Postgres + Redis + MinIO）

```bash
docker compose up -d
```

```bash
docker compose ps
```

### 默认被跳过的 opt-in 测试

这些测试**默认不跑**，需要真实基础设施。没有明确要求时不要开启：

| 环境变量 | 需要什么 |
|---|---|
| `DEPRESS_ROUNDTRIP_SMOKE=1` | Redis + MinIO + Docker |
| `DEPRESS_PHASE3_CITATION_SMOKE=1` | 同上 |
| `DEPRESS_PHASE3_ELSEVIER_SMOKE=1` | 同上 |
| `DEPRESS_PHASE3_GBT7714_SMOKE=1` | 同上 |
| `DEPRESS_PHASE3_EXIT_SMOKE=1` | 同上 |
| `DEPRESS_DOCKER_SMOKE=1` | Docker + 固定 Typst 镜像 |
| `DEPRESS_CROSSREF_SMOKE=1` | 公网访问 Crossref |
| `DEPRESS_POSTGRES_TEST_URL=...` | 可写的 Postgres 实例 |

### 只读排查（随便用）

```bash
git status --short
```

```bash
git log --oneline -20
```

```bash
git diff --stat
```

## 6. 已知环境事实（别浪费时间重新发现）

### Windows 上 pnpm 可能不在 PATH 上

在开工前先探测一次 `pnpm -v`。若报 `command not found`（Bash、PowerShell 都可能出现），
不要假设系统坏了，按下面顺序处理：

1. 优先改用 `corepack pnpm <command>`。
2. 有些工作区工具（尤其是 Turbo）会**自己去 PATH 上找 `pnpm`**，而不是通过 `corepack pnpm` 调用。
   如果 `corepack pnpm lint` 之类的命令本身能跑，但 Turbo 报
   `Unable to find package manager binary: cannot find binary path`，
   这是**环境前置条件**，不是产品代码问题——不要去 `packages/`/`apps/` 里找原因。
3. `corepack enable` 是永久修法，但可能因权限不足失败（`EPERM`，需要管理员权限）。
   **未经用户明确批准，不要修改系统 PATH、Node 安装、Corepack 安装，也不要自行提权**。
   遇到这种情况就把现象和"需要用户跑一次管理员 `corepack enable`"如实报告，等用户处理。
4. **仅当确有必要**时，可以在仓库外建一个临时 shim（把当前 corepack 管理的 pnpm
   复制到一个可执行路径，再在会话里把该目录前置进 `$env:PATH`）作为**本次会话的临时兜底**。
   这个 shim 不许提交进仓库，不许在文档里写成机器特定的绝对路径，也不许当成"解决方案"记录下来——
   它只是绕过当前会话卡点的临时手段，下一次会话可能环境已经不同。
   PowerShell 工具**不保留会话变量**，每次调用都要重新前置。

### 其他

- 包管理器是 **pnpm 9.15.4**，Node **≥22**（实测 v24.14.0 可用）。不要用 npm / yarn
- monorepo 用 turborepo，`pnpm test` 会先 build 依赖包
- 开发机是 **Windows 11**。`deploy/` 和 `e2e/day10/` 的 shell 脚本需要真实 Linux + systemd + root，
  **在这台机器上跑不了**，只能做静态检查（`bash -n` 语法检查）
- CI 工作流 `.github/workflows/ci.yml` 目前**只在 master 的 PR/push 上触发**，
  当前分支 `feature/phase4-mentor-mvp` 推送**不会触发 CI**
- Typst 镜像在代码里固定为 **digest**（`apps/api/src/env.ts` 的 `PINNED_TYPST_IMAGE`），
  env 里 `TYPST_IMAGE` 是 `z.literal()`，连 tag 都不接受。改镜像必须同时改代码常量
- `git diff` 会大量报 `LF will be replaced by CRLF` 警告，**这是正常的**，不是错误

## 7. 输出纪律

- 不要道歉、不要铺垫、不要总结刚做完的事（除非用户问）
- 改文件时只输出 diff / 改动段落，不要重印未改动的代码
- 不要重新解释架构，引用 `00-project-context.md` 的章节号即可
- 需求有歧义时：**问一个精确问题**，不要猜
- 怀疑某个库 API 在训练截止后变了：直说并去查文档，不要编
