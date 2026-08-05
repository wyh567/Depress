# T-05 — 自动保存 + mentor 人工验收收口

- **状态**：`NOT_STARTED`
- **前置任务**：`T-04`
- **预计改动文件数**：3–5（代码部分）
- **是否需要用户批准才能开工**：**是**

## 为什么做这个

两件事，一件代码一件流程。

**代码**：`apps/web/components/document-workspace.tsx` 现在只有手动 Save 按钮 + dirty 提示，
没有 debounce 自动保存（P4-07 本来就要求）。用户关标签页就丢内容 ——
这是 mentor 试用时最可能被吐槽的单点，也是"能不能给人用"的分水岭。

**流程**：`docs/mentor-mvp-acceptance.md` 明确写着人工 mentor sign-off **pending**。
技术验收过了不等于产品可用。走完 `docs/manual-acceptance/` 里的 runbook 和检查表，
拿到书面结论（Accepted / Accepted with conditions / Rejected），
才谈得上决定域名与对象存储供应商。

## 前置条件

- [ ] `03-task-board.md` 中 T-04 状态为 `DONE`
- [ ] `git status --short` 无输出
- [ ] `pnpm test` 通过

## 允许触碰的文件

- `apps/web/components/document-workspace.tsx`
- 可能新建：`apps/web/components/use-document-autosave.ts`（把逻辑抽成 hook，符合 `.cursorrules` 的组件 ≤150 行）
- `apps/web/components/document-workspace.test.tsx`
- `apps/web/components/editor/editor-area.tsx`（仅为显示 autosave 状态）
- `.agents/**`

## 禁止触碰的文件

- `packages/**` —— 自动保存不需要契约变更
- `apps/api/**` —— 服务端 `PUT /api/documents/:id` 已经支持乐观并发，不需要改
- `docs/mentor-mvp-acceptance.md` —— 历史验收记录，是证据，不许追改
- `docs/manual-acceptance/*` 的模板结构 —— 只填不改

## ⚠️ 已知陷阱

1. **自动保存必须复用现有的 `save()` 逻辑**，不要另写一套。
   现有 `save()` 已经处理了：metadata 合并、`PersistedDocumentEnvelopeSchema` 校验、
   revision 乐观并发、`editVersion` 竞态（保存期间又有编辑则保持 dirty）、
   `DocumentConflictError` → `conflict` 状态。**重写必然漏掉其中之一。**

2. **`hydrating` 标志**：加载文档时会 `setContent`，
   `markDirty` 里靠 `hydrating.current` 挡住误标脏。自动保存的触发条件必须同样尊重它，
   否则一打开文档就会触发一次无意义的保存。

3. **不要在 `saveState === "conflict"` 或 `"failed"` 时继续自动保存。**
   冲突状态下反复自动保存会不断打服务器且永远失败。
   正确行为：暂停自动保存，等用户选"重载服务端版本"或"继续编辑"。

4. **编译前必须已保存。** `compile-controls.tsx` 依赖 `saveState` 来决定能不能编译
   （Day 10 验收项："Dirty-document rule: Compile disabled and save guidance visible"）。
   加自动保存后**不许破坏这条规则** —— 验收检查表里有这一项。

5. **测试里不要用真实定时器。** 用 vitest 的 fake timers，否则测试会又慢又飘。

## 执行步骤

### 第一部分：自动保存

1. 读完 `document-workspace.tsx` 的 `save` / `markDirty` / `hydrate` 三个函数，
   确认自己理解了陷阱 1–3。
2. 输出 ≤10 行计划（debounce 时长、暂停条件、状态显示），等用户批准。
3. 抽 `use-document-autosave.ts` hook：接收 `saveState` + `save` + `activeDocumentId`，
   在 dirty 且不处于 `saving`/`conflict`/`failed` 时，debounce 后调用 `save()`。
4. 在 `document-workspace.tsx` 接上，**不改 `save()` 本身**。
5. 补测试（fake timers）：
   - 编辑后等待 debounce → 触发一次保存
   - debounce 窗口内连续编辑 → 只保存一次
   - `conflict` 状态下 → 不触发自动保存
   - 加载文档（hydrate）→ 不触发自动保存
   - 保存中又编辑 → 保存完成后状态仍是 dirty，且会再次触发

### 第二部分：mentor 人工验收（**这部分由用户执行，agent 只做准备**）

6. 检查 `docs/manual-acceptance/mentor-session-runbook.md` 里的准备项是否都能满足，
   把**不能满足的项**列给用户。
7. 提醒用户：验收需要一个可用的 staging 环境（`e2e/day10/provision-staging.sh`），
   而它需要**真实 Linux + root + systemd**，Windows 开发机跑不了。
8. **不要**替用户填写 `mentor-signoff-checklist.md` 里的任何结果。
   那是人工观察记录，agent 代填就是造假。

## 验收标准

### 代码部分

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | 自动保存测试全过 | `pnpm --filter @depress/web test` | 新增的 5 条用例全过 |
| 2 | 编译前置规则未破坏 | `pnpm --filter @depress/web test` | `compile-controls` 相关测试仍全过 |
| 3 | 逻辑抽成了 hook，没有堆进组件 | `wc -l apps/web/components/document-workspace.tsx` | **不超过改动前的 264 行**。`.cursorrules` 要求组件 ≤150 行，该文件本就超标（既有欠债，不在本任务范围），但本任务**不许让它更长** |
| 4 | 全套校验 | `pnpm lint && pnpm typecheck && pnpm test` | 退出码 0 |
| 5 | 构建 | `DEPRESS_API_ORIGIN=http://127.0.0.1:3001 pnpm build` | 退出码 0 |

### 流程部分

| # | 检查 | 期望 |
|---|---|---|
| 6 | 验收准备项清单已交给用户 | 用户确认收到 |
| 7 | mentor 书面结论 | **由用户提供**。agent 不得代填、不得代签 |

## 停止条件

- 需要改 `save()` 的内部逻辑才能实现自动保存 → **停**并说明为什么
  （多半意味着方案不对，应该在外层控制触发时机而不是改保存本身）
- 加了自动保存后 `compile-controls` 的既有测试变红 → **停**（破坏了 Day 10 验收项）
- 用户要求你替他填写 sign-off 检查表 → **拒绝并说明**：那是人工观察记录，代填即造假

## 完成后必须更新

- [ ] `03-task-board.md`：T-05 状态 + 日期 + 完成历史
- [ ] `01-current-state.md`：§1 表格 P4-07 行改为完成；§3 的"无自动保存"一条移除
- [ ] 本文件 `## 完成记录`
- [ ] 若 mentor 给出结论 → 把**结论本身**（不是原始记录）反映到 `process.md`，
      原始签字记录按 `mentor-signoff-checklist.md` 末尾要求**保存在仓库之外**

## 完成记录

- 完成日期：
- debounce 时长与暂停条件：
- 新增测试用例数：
- 验收实测输出：
- mentor 结论（若已进行）：

## 阻塞记录

-
