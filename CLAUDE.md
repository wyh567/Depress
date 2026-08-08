# DePress — Agent 必读

> 这份文件会被自动加载进每次会话。**内容刻意保持简短**，详细内容在 `.agents/`。

## 1. 开工前必须做的第一件事

**读 [`.agents/README.md`](.agents/README.md)，然后按它指定的顺序读完 4 个文件。**

不读就开干 = 一定会犯下面这些错。

## 2. 三个会让你立刻判断错误的事实

1. **`process.md` 的 Phase 4 状态是错的。** 它写着 P4-02～P4-12 全部 `NOT STARTED`，
   实际上 P4-03～P4-11 的主体已经实现。**以 [`.agents/01-current-state.md`](.agents/01-current-state.md) 为准。**

2. **工作树是脏的**（58 个未提交的产品改动）。开工前先自检，
   计数命令见 [`.agents/01-current-state.md`](.agents/01-current-state.md) §0 陷阱 2。
   不要把自己的改动和这 58 个混在一起。

3. **`POST /compile` 是未认证的遗留路由，仍注册在生产 app 里。** 它是待删的死代码，
   不是可以参考的样板。新的目标契约是 `POST /api/compile-jobs`。

## 3. 绝对禁止（完整清单见 `.agents/02-agent-rules.md`）

- 未经用户明确指示：`git commit` / `push` / `merge` / `rebase` / `reset` / `restore` / `stash`
- 改 `packages/ast` 的 schema 而不同步更新 web + api 两侧消费者和测试
- 扩大任务范围。发现别的问题 → 记进 `.agents/03-task-board.md` 的「发现待办」，不要顺手做
- 为了让测试通过而放宽断言 / 加 skip / 改 snapshot 期望值

## 4. Hard Invariants（违反即为 bug，不是风格问题）

1. 编辑器 schema 只允许语义结构 —— 禁止 font / size / color / spacing / margin / layout
2. Citation 只存 `citeKey`，渲染文本在编译期产出
3. `packages/ast` 是跨边界类型的唯一来源（`z.infer` 导出，`z.discriminatedUnion` 判别）
4. 模板是代码评审资产，用户不可编辑
5. 编译永远异步 + 沙箱（固定 digest / 无网络 / 只读根 / drop caps）

## 5. 常用命令

```bash
pnpm lint && pnpm typecheck && pnpm test
```

生产构建**必须**带环境变量，否则 web 构建会失败：

```bash
DEPRESS_API_ORIGIN=http://127.0.0.1:3001 pnpm build
```

真实基础设施测试默认 skip，需要 `DEPRESS_*_SMOKE=1` + Redis/MinIO/Docker，清单见 `.agents/02-agent-rules.md` §5。

## 6. 环境事实

- pnpm 9.15.4 + Node ≥22 + turborepo。不要用 npm / yarn
- 开发机是 Windows 11。`deploy/` 和 `e2e/day10/` 的 shell 脚本需要真实 Linux + systemd + root，
  **本机跑不了**，只能 `bash -n` 做语法检查
- CI 目前**只在 master 触发**，功能分支推送不跑 CI
- `git diff` 大量 `LF will be replaced by CRLF` 警告是正常的，不是错误
