# T-01A — 修复 document-metadata 中重复手写的 AST 元数据类型

- **状态**：`DONE`
- **前置任务**：无（从 `T-01` 的阻塞中分出的独立修复任务）
- **预计改动文件数**：1
- **是否需要用户批准才能开工**：否（用户已在本次会话明确授权此受限修复）

## 为什么做这个

`T-01` 在步骤 4 卡住：`pnpm typecheck` 与 `pnpm build` 因 `@depress/web` 的 2 个 `TS2345` 失败。
`T-01` 自身的「禁止触碰的文件」排除了所有 `apps/**` 源码，因此不能在 `T-01` 内修。
本任务专门解除这个类型阻塞，让 `T-01` 能继续。

根因不只是类型不匹配，而是**违反 Hard Invariant #3**：
`apps/web/stores/document-metadata.ts` 手写了与 `@depress/ast` 的
`DocAuthor` / `DocAffiliation` 等价的结构字面量类型，形成双份维护。

## 前置条件

- [x] 分支 `feature/phase4-mentor-mvp`
- [x] 产品改动数 58（与 `01-current-state.md` §0 一致）
- [x] `DocAuthor` / `DocAffiliation` 确认由 `@depress/ast` 公开入口导出

## 允许触碰的文件

- `apps/web/stores/document-metadata.ts`
- `.agents/**`（状态记录）

## 禁止触碰的文件

- `packages/ast/**` —— 权威类型已存在且已公开导出，无需改动
- 其余全部 `apps/**`、`packages/**`、`deploy/**`、`e2e/**`

## 禁止手段

- `any` / `unknown` / `as` 强制断言
- `@ts-ignore` / `@ts-expect-error`
- 关闭或放宽 `exactOptionalPropertyTypes`
- 用不准确的临时结构类型「扩宽」绕过
- deep import `packages/ast` 内部文件
- 改动运行逻辑、格式化结果、UI 文案、持久化格式

## 执行步骤

1. 核实 `@depress/ast` 的真实公开导出（不靠猜）。
2. 从 `@depress/ast` 公开入口 `import type { DocAffiliation, DocAuthor }`。
3. 把 `formatAuthorLine` / `formatAffiliationLine` 的手写结构参数类型替换为权威类型。
4. 函数体一行不改。
5. 按验收标准逐条跑命令。

## 验收标准

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | Web 局部类型检查 | `pnpm --filter @depress/web typecheck` | 退出码 0，原 2 个 TS2345 消失 |
| 2 | Web 局部构建 | `pnpm --filter @depress/web build` | 退出码 0 |
| 3 | 全仓类型检查 | `pnpm typecheck` | 5/5 packages 通过 |
| 4 | 全仓构建 | `pnpm build` | 退出码 0 |
| 5 | 全仓测试 | `pnpm test` | 465 passed / 51 skipped，无新增失败 |
| 6 | 全仓 lint | `pnpm lint` | 5/5 packages 通过 |
| 7 | 无新增镜像类型 | 人工检查 diff | 不引入任何新的手写 author/affiliation 结构类型 |
| 8 | 行为不变 | 人工检查 diff | 仅类型与 import 变化，无逻辑改动 |

## 停止条件

- `DocAuthor` / `DocAffiliation` 未从公开入口导出 → 报告 `PUBLIC_AST_EXPORT_REQUIRED` 并停
- 需要改 `packages/ast` 才能修好 → **停**
- 修复后出现原本没有的新错误 → **停**并原样报告

## 完成后必须更新

- [ ] `03-task-board.md`：新增 T-01A 行并标 `DONE`；T-01 从 `BLOCKED` 恢复 `IN_PROGRESS`
- [ ] `tasks/T-01-worktree-and-ci.md`：阻塞记录补充解除说明
- [ ] 本文件 `## 完成记录`

## 完成记录

- 完成日期：2026-08-05
- 实际改动文件：`apps/web/stores/document-metadata.ts`（唯一产品文件，3 处编辑）

### 公开导出核实（步骤 1）

- `packages/ast/package.json` → `"exports": { ".": "./src/index.ts" }`（单一公开入口）
- `src/index.ts` → `export * from "./schema"`
- `src/schema.ts:83` → `export type DocAffiliation = z.infer<typeof DocAffiliationSchema>`
- `src/schema.ts:94` → `export type DocAuthor = z.infer<typeof DocAuthorSchema>`

结论：两个权威类型**已由公开入口导出**，无需改动 `packages/ast`，
未触发 `PUBLIC_AST_EXPORT_REQUIRED`。也无 deep import。

### 实际改动（净 3 处）

```diff
-import type { DocMetadata } from "@depress/ast";
+import type { DocAffiliation, DocAuthor, DocMetadata } from "@depress/ast";

-function formatAuthorLine(author: {
-  name: string;
-  nameEn?: string;
-  affiliationIds?: string[];
-}): string {
+function formatAuthorLine(author: DocAuthor): string {

-function formatAffiliationLine(affiliation: {
-  id: string;
-  name: string;
-  nameEn?: string;
-}): string {
+function formatAffiliationLine(affiliation: DocAffiliation): string {
```

两个函数体**一行未改**，格式化输出、UI 文案、持久化格式均不变。

### 验收实测输出

| # | 命令 | 结果 |
|---|---|---|
| 1 | `corepack pnpm --filter @depress/web typecheck` | ✅ EXITCODE=0，原 2 个 TS2345 消失 |
| 2 | `corepack pnpm --filter @depress/web build` | ✅ EXITCODE=0，TypeScript 3.7s 通过，5 个静态页生成 |
| 3 | `corepack pnpm typecheck` | ✅ 5/5 packages，EXITCODE=0 |
| 4 | `corepack pnpm build` | ✅ 1/1 task，EXITCODE=0 |
| 5 | `corepack pnpm test` | ✅ 4/4 tasks，**465 passed / 51 skipped**（ast 104 · transformers 61 · api 173+51skip · web 127） |
| 6 | `corepack pnpm lint` | ✅ 5/5 packages，EXITCODE=0 |
| 7 | 无新增镜像类型 | ✅ 净改动是**删除**两个手写结构类型，未新增 |
| 8 | 行为不变 | ✅ 仅 import 与参数类型变化 |

禁用手段自查：`grep -nE ":\s*any\b|as unknown|@ts-ignore|@ts-expect-error|exactOptionalPropertyTypes"` → 无命中。

### 越界发现（已记入任务板「发现待办」，本任务未处理）

同文件的 `parseAuthors` / `parseAffiliations` **返回类型**仍是手写的 author/affiliation 结构镜像，
同属 Invariant #3 违规。但它们当前**能通过类型检查**（赋值方向协变合法），
修它属于重构而非最小类型修复，故按「不扩大范围」原则未动。

## 阻塞记录

- 无
