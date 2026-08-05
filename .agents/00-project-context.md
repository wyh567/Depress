# 项目上下文 — DePress

> 冻结文档。未经用户批准不得修改。
> 架构细节以根目录 `architecture.md` 为准，本文件是给 agent 的浓缩版 + 代码落点索引。

## 1. 项目是什么

**DePress = Decoupled Academic Press** —— 内容与版式解耦的学术写作/排版系统。

用户只写**语义内容**，版式由**代码评审过的不可变期刊模板**在编译期决定。
同一份正文不改一个字，切换 `templateId` 即可得到 IEEE / Elsevier / GB/T 7714 三种合规 PDF。

核心价值链：

```
结构化编辑器 → 语义 AST → 沙箱 Typst 编译 → 期刊级 PDF
```

## 2. 与普通编辑器的本质区别：Content != Layout

这不是口号，是 schema 层面强制执行的约束。改动时必须维持：

| 约束 | 代码位置 |
|---|---|
| 只有语义标记，没有字体/字号/颜色节点 | `packages/ast/src/schema.ts` → `MarkSchema = z.enum(["bold","italic"])` |
| 持久化信封全链 `.strict()`，表现字段直接被拒 | `packages/ast/src/persisted-document.ts` → `PersistedDocumentEnvelopeSchema` |
| 引用只存 `citeKey`，编号在编译期生成 | `packages/ast/src/schema.ts` → `CitationNodeSchema` |
| `templateId` 不进文档数据，只是编译请求参数 | `packages/ast/src/compile.ts` → `CompileJobCreateRequestSchema` |

对比 LaTeX：不让用户碰宏包与样式。
对比 Word：不让用户碰任何表现属性。
用户交出"排版自由"，换回"投稿即合规"。

## 3. Hard Invariants（违反即为 bug，不是风格问题）

| # | 不变量 | 强制点 | 改动时必须做的事 |
|---|---|---|---|
| 1 | 编辑器 schema 只允许语义结构，禁止 font/size/color/spacing/margin/layout | `MarkSchema`、`DocMetadataSchema.strict()`、`PersistedDocumentEnvelopeSchema.strict()` | 新增字段前先问：这是语义还是表现？表现 → 拒绝 |
| 2 | Citation 只存 `citeKey`，渲染文本编译期产出 | `CitationNodeSchema`、`citationReferenceIntegrity()` | 禁止把 `[1]` 这类渲染结果写进 AST |
| 3 | `packages/ast` 是跨边界类型的唯一来源 | 全部 `z.infer` 导出，禁止手写 interface；node 判别一律 `z.discriminatedUnion` | 改 schema 必须同 PR 更新 web + api + 测试 |
| 4 | 模板是代码评审资产，用户不可编辑 | `packages/templates` 是冻结字符串常量，无运行时 I/O | 禁止加"用户自定义模板/样式"入口 |
| 5 | 编译永远异步 + 沙箱 | 独立 pointer worker 进程；Docker 固定 digest、无网络、只读根、drop caps | 禁止在 API 进程内同步编译；禁止沙箱联网 |

补充两个实现级不变量（同样不许破坏）：

- **Postgres 是终态真相，Redis 只是传输**。`compile_jobs` 表用 CHECK 约束在数据库层拒绝非法状态组合。
- **Worker 重试永远用同一份不可变快照**，不重读当前文档/引用。

## 4. 目标编译数据流（已实现，不是设计稿）

```
Tiptap 编辑器
  → PersistedDocumentEnvelope { schemaVersion:1, editor: PM JSON, metadata? }   ← 唯一可编辑真相
  → PUT /api/documents/:id      （session 鉴权 + owner 派生 + revision 乐观并发 + content_hash）
  → POST /api/compile-jobs { documentId, revision, templateId, format }
        ├ 校验 owner + 精确 revision
        ├ PM → 语义 Doc AST 投影              (packages/ast/src/persisted-pm-to-ast.ts)
        ├ 解析 project 内被引用的 references
        ├ 写 compile_jobs.input_snapshot + snapshot_hash        ← 不可变
        └ 同事务写 compile_outbox                                ← 事务性发件箱
  → outbox publisher → BullMQ 入队 { jobId, snapshotHash }       ← 最小指针载荷
  → pointer worker: 重解析指针 → 从 PG 读可信快照 → 重算哈希比对 → 原子 claim(token)
  → renderTypstProject → Docker 沙箱（pinned digest / 无网络 / 只读根 / drop caps）
  → S3 上传 artifacts/{jobId}.pdf → PG 写终态 succeeded|failed
  → GET /api/compile-jobs/:id/download → owner 校验 → 短时签名 URL
```

**注意**：仓库里还并存一条 Phase 3 遗留链路（未认证 `POST /compile` + 内存 job store + legacy worker）。
它是待删除的死代码，见 `01-current-state.md` §3 与任务 `T-02`。

## 5. 包边界与依赖方向（单向，无环 —— 不许制造反向依赖）

```
@depress/ast  (零依赖，只有 zod)
   ↑              ↑                ↑
   |              |                |
apps/web   @depress/transformers   apps/api
                  ↑                  ↑
           @depress/templates ───────┘
```

- `ast`：跨 Web/API/Queue/Worker 的唯一契约源。零业务依赖。
- `transformers`：纯函数，AST → Typst 文本 + Hayagriva YAML。**无 I/O**。
- `templates`：不可变模板字符串常量。**无 I/O**。
- `web` ⇸ `api`：只通过 HTTP + 共享 schema，无编译期耦合。

## 6. 目录地图

```
depress/
├── packages/
│   ├── ast/            零依赖(仅 zod)。跨边界唯一契约源。
│   │                   schema(语义 AST) · persisted-document(可编辑真相)
│   │                   persisted-pm-to-ast(投影) · compile(请求/快照/指针/Job)
│   │                   csl · normalize-doi · doi-lookup · document-api · reference-api
│   ├── transformers/   纯函数。renderTypstProject 统一校验 → 收集 citeKey →
│   │                   选首次出现子集 → 序列化 Hayagriva → 穷尽分派到三个渲染器
│   └── templates/      不可变模板常量，仅暴露 {{TITLE}}/{{BODY}}/{{BIBLIOGRAPHY}} 等语义注入点
│
├── apps/
│   ├── web/            Next.js 16 + Tiptap 3 + Zustand
│   │                   app/(page,login) · components/(auth,editor,library)
│   │                   lib/(document|reference|compile-job|auth)-client
│   │                   生产走同源 /api/*，next rewrite 仅本地回退
│   └── api/            Fastify 5
│       ├── routes/     documents · references · compile-jobs
│       │               compile(遗留,未认证) · jobs(遗留)
│       ├── auth/       Better Auth + PG session + seed-mentor
│       ├── db/         pool · migrate · 5 个迁移 · 4 个 repository
│       ├── queue/      compile-pointer-queue(新) · compile-queue(遗留)
│       ├── workers/    compile-pointer-worker(生产) · typst-sandbox + reconciler
│       │               compile-worker(遗留死代码)
│       ├── services/   s3 · crossref · job-reader(遗留)
│       └── 入口:       server.ts · outbox-main.ts · pointer-worker-main.ts
│
├── deploy/             单 VM 生产资产：systemd×4 + nginx TLS + release/rollback
│                       + migrate + health-check + 一整套 *.test.sh 安全自检
├── e2e/day10/          真实 Linux staging 编排 + Playwright 验收 + 交付包生成
├── docker/             本地沙箱资产
├── docs/adr/           7 份架构决策记录
├── docs/manual-acceptance/  mentor 人工验收 runbook / 检查表 / 观察表
└── architecture.md · process.md · docker-compose.yml · .env.example · .cursorrules
```

## 7. 数据库表一览（5 个迁移，`apps/api/src/db/migrations/`）

| 表 | 来源迁移 | 关键约束 |
|---|---|---|
| `projects` | 0001 | 每用户唯一默认项目（部分唯一索引 `WHERE is_default`） |
| `documents` | 0001 | `revision > 0`、`content_hash ~ '^[0-9a-f]{64}$'`、`envelope_json->>'schemaVersion' = '1'` |
| `project_references` | 0001 | 主键 `(project_id, cite_key)` |
| `user` / `session` / `account` / `verification` | 0002 | Better Auth 标准表 |
| `projects.owner_user_id` FK | 0003 | 先检查孤儿行再加外键 |
| `compile_jobs` / `compile_outbox` | 0004 | 快照哈希格式、状态枚举、未发布事件的部分索引 |
| `compile_jobs` 处理态归属 | 0005 | `(status='processing') = (token IS NOT NULL AND started_at IS NOT NULL)`、成功必须有 artifact、失败必须有 error_code 且无 artifact |

**不存在的表**（是缺口不是遗漏发现）：`document_checkpoints`、artifact 生命周期表、软删除列。
