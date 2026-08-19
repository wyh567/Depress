# T-06 — Production UI implementation（Claude Design 视觉对齐，功能零回归）

- **状态**：`DONE`
- **前置任务**：无（owner reprioritization; T-04 temporarily paused，两者不同时活跃）
- **预计改动文件数**：按 slice 逐个批准，Slice 1 为 6–8 个文件
- **是否需要用户批准才能开工**：**是**（owner 已批准 Phase 0 只读检查报告 + Phase 1 分片实施计划；
  每个 slice 的具体文件范围仍需 owner 逐次确认后才能开工）

## 为什么做这个

`D:\depress-ui-handoff\claude-design` 是已批准的 Claude Design 视觉终稿（Login / Papers Dashboard /
Paper Editor / References / PDF Preview 五个画板 + Broadsheet 设计系统）。Owner 要求把这份视觉终稿
落地为生产前端，同时不得回归任何既有功能（认证、文档生命周期、dirty/save 状态、revision 冲突处理、
reference session-generation guard、citeKey 语义、TipTap schema 不变量、BibTeX 导入、三个编译模板、
compile 轮询状态机、下载行为、AST 导出、metadata authoring）。

本任务的范围与红线，已经过两轮 owner 审阅（Phase 0 只读检查报告、Phase 1 分片实施计划）以及针对
Q1–Q8 与两条 correction 的显式裁决确定：

- **不新增路由**（`/papers` 等）——Dashboard/Editor/References/PDF 在本阶段是现有认证工作区内部的
  视图/展示状态，不是新路由，以保留现有的内存态未保存变更守卫、store 生命周期、compile 状态行为。
- **不虚构数据** —— Dashboard/Editor/References/PDF 中任何设计稿字段若无真实后端来源，一律省略或
  降低视觉密度，不得硬编码。
- **PDF 预览取保守范围** —— 不做内联 PDF 渲染，不改 OSS CORS，不加同源代理；只展示真实 compile job
  状态 + 已知的模板/格式信息 + Download PDF。
- **三个模板全部保留** —— ieee / elsevier / gbt7714，默认值与既有 reset-to-ieee 行为不变。
- **英文视觉为主，但既有可访问性名称必须保持**——通过 `aria-label` 或保留原文本，使全部既有
  `getByRole` / `getByLabelText` / `getByText` 断言继续通过；不为了改字面文案而放宽任何断言。
- **BibTeX 导入必须保留**（作为 References 视图的次级/收纳操作）；DOI 导入保持未挂载，不接线。
- **不做 autosave，不加编译快捷键** —— 保存态文案只反映真实 `saveState`。
- **Metadata authoring 必须保留一个可访问的编辑入口**，不得因为设计稿没有对应界面就静默移除。

## 前置条件（逐条验证，任一不满足就停）

- [x] `git status --short` 干净（工作分支创建前已确认）
- [x] `pnpm lint && pnpm typecheck && pnpm test` 基线全部通过（本次会话已记录基线结果，见完成记录）
- [x] Owner 已批准 Phase 0（只读检查）与 Phase 1（分片实施计划）两份报告，并对 Q1–Q8 与两条
      correction 给出书面裁决
- [x] `03-task-board.md` 治理状态已改为 T-04 `PAUSED`、T-06 `IN_PROGRESS`

## 允许触碰的文件（白名单，超出即为越界；按 slice 分批授权）

### Slice 1（本次授权范围）

- `apps/web/lib/fonts.ts`（新建）
- `apps/web/components/ui/button.tsx`（新建）
- `apps/web/components/ui/tag.tsx`（新建）
- `apps/web/components/ui/field.tsx`（新建）
- `apps/web/components/ui/segmented-control.tsx`（新建）
- `apps/web/components/ui/README.md`（新建）
- `apps/web/app/globals.css`（仅追加 token 层，不删除既有规则）
- 字体二进制资源文件 —— **仅当**"已批准本地资源来源检查"通过时才允许新增；否则本 slice
  不新增任何字体二进制文件，并报告 `FONT_ASSET_SOURCE_REQUIRED`
- `.agents/03-task-board.md`、`.agents/tasks/T-06-production-ui-implementation.md`（治理文件）

后续 slice 的文件范围将在各自开工前由 owner 单独确认，不在此提前列出。

## 禁止触碰的文件（本任务全程，直到 owner 明确扩大范围）

- `apps/web/app/page.tsx`、`apps/web/app/login/page.tsx` —— 尚未进入视觉落地阶段
- `apps/web/components/auth/**` —— 认证行为不可在 token 阶段触碰
- `apps/web/components/document-workspace.tsx` —— 核心编排逻辑，冻结契约
- `apps/web/components/document-list-panel.tsx`
- `apps/web/components/editor/**` —— 含 compile 状态机、citation 语义、TipTap schema
- `apps/web/components/library/**` —— 含 BibTeX/DOI 导入、reference session guard
- `apps/web/stores/**` —— session-generation guard 等安全机制
- `apps/web/lib/document-client.ts`、`lib/compile-job-client.ts`、`lib/reference-client.ts`、
  `lib/auth-client.ts`、`lib/api-origin.ts`
- `apps/web/next.config.ts`
- `packages/ast/**`、`packages/templates/**`、`packages/transformers/**`
- `apps/api/**`
- `deploy/**`、`docker/**`、`docker-compose.yml`
- 任何 `*.test.ts` / `*.test.tsx` 文件 —— 不许为了让视觉改动通过而放宽断言

## 执行步骤

> 严格按顺序。每步做完先确认，再做下一步。每个 slice 单独授权、单独验收，不得合并推进。

1. 治理文件更新：`03-task-board.md`（T-04 → `PAUSED`，新增 T-06 `IN_PROGRESS`）+ 本任务文件。
2. 建立专用 feature 分支（不在 `master` 上直接开工）。
3. **Slice 1 — 设计 token + 字体 + 基础 UI 原语（零业务逻辑改动）**：
   a. 记录基线 `pnpm lint && pnpm typecheck && pnpm test` 结果。
   b. 检查是否存在已批准的本地 Source Serif 4 资源（仓库内文件 / 已安装依赖）；
      存在 → 通过 `next/font/local` 接入；不存在 → 不新增字体二进制文件，报告
      `FONT_ASSET_SOURCE_REQUIRED`，其余 token 工作（颜色/间距/圆角/阴影/字号刻度）
      仍可继续，字体变量声明保留一个不依赖具体二进制的 fallback 栈。
   c. 在 `app/globals.css` 追加 Broadsheet token 层（`:root` 变量 + `@theme` 绑定），
      不删除、不修改任何既有规则（`.prose-depress`、`.citation-chip` 等原样保留）。
   d. 新建 `components/ui/{button,tag,field,segmented-control}.tsx` 与 `components/ui/README.md`，
      全部独立、不被任何现有页面或组件引用。
   e. 验收：`git status --short` 与 `git diff --stat` 仅命中本 slice 授权文件；
      `pnpm lint && pnpm typecheck && pnpm test` 与基线 pass/skip 数一致，
      零测试文件改动；`DEPRESS_API_ORIGIN=http://127.0.0.1:3001 pnpm build` 通过。
   f. 按 owner 要求的固定格式输出 Slice 1 结题报告，然后 **停止，不进入 Slice 2**。
4. Slice 2 及以后（Login → Shell → Dashboard 视图 → Editor 视图 → References 视图 → PDF 视图 →
   交互态 → 响应式 → 视觉对比 → 全量回归）——留待 owner 对 Slice 1 验收通过后逐一单独授权范围，
   本文件届时更新对应小节，不在当前版本预先展开。

## 验收标准

> **每一条都必须真的跑命令**，不许凭感觉判断。全过才算该 slice `DONE`。

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | 工作树范围 | `git status --short` | 仅命中该 slice 授权文件列表 |
| 2 | Diff 范围 | `git diff --stat` | 与授权文件列表一致，无行为文件被触碰 |
| 3 | Lint | `pnpm lint` | PASS，与基线一致 |
| 4 | 类型检查 | `pnpm typecheck` | PASS，与基线一致 |
| 5 | 测试 | `pnpm test` | pass/skip 计数与基线完全一致，测试文件 diff 数为 0 |
| 6 | 生产构建 | `DEPRESS_API_ORIGIN=http://127.0.0.1:3001 pnpm build` | PASS |
| 7 | 外部依赖 | 人工核查新增文件 | 无 Google Fonts CDN、无 unpkg、无未经批准的字体二进制 |

## 停止条件

- 任何一步需要触碰"禁止触碰的文件"清单中的文件 → 立即停止，报告 owner，不自行变通。
- 任何一步需要修改测试文件才能通过 → 立即停止，报告 owner。
- Source Serif 4 无法从已批准本地来源获取 → 停止新增字体二进制文件，报告
  `FONT_ASSET_SOURCE_REQUIRED`，其余不依赖字体资产的 token 工作可以继续。
- 任意 slice 的 diff 超出该 slice 事先声明的文件范围 → 停止，报告差异，等待 owner 确认后再继续。

## 完成后必须更新

- [ ] `03-task-board.md` 状态改 `DONE`（或阶段性 slice 完成记录）+ 日期
- [ ] `01-current-state.md` 对应事实（视觉落地进度）
- [ ] 本文件 `## 完成记录`

## 完成记录

> 由执行 agent 填写。写实测结果，不写计划。

- 完成日期：2026-08-18
- 实际改动文件：15 个已修改 + 约 25 个新建文件（`apps/web/components/{ui,shell,papers,references,pdf}/**`、
  `apps/web/app/fonts/source-serif-4/**`、`apps/web/lib/fonts.ts`、以及 auth/editor/library 目录下的既有文件
  presentation-only 改动 + Slice 7A–7B-2 的 compile 状态机重构）
- 验收实测输出：Slice 9（Final Product Acceptance）经 Slice 9A（accessibility 修正）后 PASS——
  466 passed / 107 skipped，`pnpm lint`/`pnpm typecheck`/`DEPRESS_API_ORIGIN=... pnpm build` 全部 PASS，
  0 个测试文件被改动，accessibility（含 Slice 6B focus-visible 与 Slice 9A 引用表单去重复）PASS，
  1440×1024 与 1280×900 视觉验收 PASS，real-data-only 审计 PASS，无 backend/API/schema/infra 改动，
  无 Claude Design 运行时文件被打包。READY_FOR_PR = YES，BLOCKERS = NONE。

## 阻塞记录

> 卡住时填。写清楚：第几步、跑了什么命令、实际输出、你判断的原因。

-
