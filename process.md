# PROCESS.md — MVP Roadmap & State

## Status
- Current Phase: **1**
- Last Updated: 2026-07-03

## Phase 1 — Editor Core & AST Contract
Goal: A working structured editor that emits validated AST JSON. No backend yet.
- Define `packages/ast`: Zod schemas for Doc, Heading(1-3), Paragraph, Citation, Figure, Table (stub)
- Scaffold monorepo (pnpm workspaces + turborepo)
- Next.js app shell + Tiptap editor with restricted schema
- Custom Citation node (inline, atom, stores `citeKey`)
- Zustand store: doc metadata, dirty state, autosave debounce (local only for now)
- Reference library panel (CRUD on local CSL-JSON, BibTeX import parser)
- **Exit criteria:** Export button dumps valid AST JSON matching Zod schema.

## Phase 2 — Compilation Engine
Goal: AST in → PDF out, one hardcoded template (IEEE).
- `ast-to-typst` transformer with snapshot tests
- IEEE template in Typst; parameterized injection points
- Fastify API: POST /compile, GET /jobs/:id
- BullMQ worker + Dockerized Typst sandbox
- S3 artifact storage + signed URLs
- **Exit criteria:** Round-trip demo — type in editor, download IEEE PDF.

## Phase 3 — Citation Engine & Multi-Template
Goal: Correct bibliographies in multiple strict styles.
- CSL processing: GB/T 7714-2015, IEEE numeric, Elsevier (APA-like) via citeproc/Typst
- DOI lookup (Crossref) → auto CSL-JSON
- Template #2 (Elsevier) + #3 (GB/T Chinese journal)
- Template switcher: same doc → different PDFs (the core demo moment)
- **Exit criteria:** One document exports to 3 journals with correct citations.

## Phase 4 — Persistence, Auth & Polish
Goal: Deployable portfolio product.
- Postgres persistence + document versioning
- Auth + multi-project workspace
- DOCX export path (Pandoc + reference.docx)
- Landing page, deploy (Vercel + Fly.io/Railway workers)
- **Exit criteria:** Public URL, signup → write → export works end-to-end.

## Phase 1 TODO
- [x] Init monorepo (pnpm, turbo, tsconfig strict, eslint, prettier)
- [x] `packages/ast`: node types + Zod schemas + unit tests
  - 硬性要求(Invariant #3 载体):① node type 区分必须用 `z.discriminatedUnion`,禁用 `z.union`;② TS 类型一律 `z.infer` 从 schema 导出,禁止手写 interface 双份维护;③ 测试必须含拒绝非法输入用例(heading level 4、citation 缺 citeKey 等)
- [ ] Next.js app scaffold + layout shell
- [ ] Tiptap setup with custom restricted schema (decide: keep semantic bold/italic, forbid font/size/color)
- [ ] Citation inline node + insertion command (Cmd+Shift+C)
- [ ] Reference library panel (in-memory) + BibTeX importer
- [ ] "Export AST" debug button + Zod validation
- [ ] Update process.md status when done

## Backlog
(Out-of-phase ideas go here — do not implement early.)
