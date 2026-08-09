# DePress — Agent 必读

> 这份文件会被自动加载进每次会话。**内容刻意保持简短**，详细内容在 `.agents/`。

## 1. 开工前必须做的第一件事

**读 [`.agents/README.md`](.agents/README.md)，然后按它指定的顺序读完 4 个文件。**

不读就开干 = 一定会犯下面这些错。

## 2. 三个会让你立刻判断错误的事实

1. **Phase 4 尚未完成。** T-03 已把 `process.md` 与当前实现同步；T-04 生产安全控制、
   autosave、mentor sign-off、生产部署与 current-master acceptance 仍未完成。

2. **历史 58-file 工作树问题已解决并合并。** 仍必须在每次任务开始时运行 `git status --short`，
   但不要再把那批历史改动当成当前未提交产品代码。

3. **Legacy anonymous compile 已删除。** `POST /compile` 和 `GET /jobs/:id` 不再注册；
   唯一生产编译契约是认证的 `/api/compile-jobs` snapshot/outbox/pointer-worker 链路。

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
- CI 在 `master` 与 `feature/**` push、以及面向 `master` 的 pull request 上触发；其他分支 push 不保证触发
- `git diff` 大量 `LF will be replaced by CRLF` 警告是正常的，不是错误
