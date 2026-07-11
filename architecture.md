# ARCHITECTURE.md — DePress (Decoupled Academic Press)

## 1. Core Principle and Invariants

**Content != Layout.** DePress stores semantic authoring content and compiles it against code-reviewed, immutable journal templates. Users never control presentation through document data.

The following invariants apply to both the implemented system and the Phase 4 target:

1. The editor schema permits semantic structure only. Font, font size, color, spacing, margin, layout, and other presentation controls are forbidden.
2. Citations store `citeKey` only; rendered citation text is produced at compile time.
3. `packages/ast` is the shared Zod schema source for cross-boundary document, compile, job, and API contracts. Phase 4 may organize it by internal domains, but does not rename the package.
4. Templates are code-reviewed assets and are not user-editable in the MVP.
5. Compilation is always asynchronous and sandboxed.

## 2. Current Implemented Architecture (Phases 1–3)

This section records repository facts that remain operational while Phase 4 is implemented.

| Layer | Implemented state |
|---|---|
| Web | Next.js 16 App Router, React, TypeScript |
| Editor | Tiptap/ProseMirror with paragraph, heading levels 1–3, text, semantic bold/italic, and a custom citation node |
| Client state | Tiptap document plus in-memory Zustand metadata and reference stores |
| Semantic schema | `@depress/ast` `DocSchema`, CSL schemas, compile schemas, and job response schemas |
| API | Fastify with `POST /compile`, `GET /jobs/:id`, and DOI lookup |
| Queue | BullMQ and Redis; current API and Worker exchange the complete raw AST/reference compile payload |
| Worker | Separate BullMQ Worker process |
| Compiler | Typst 0.15 using immutable IEEE, Elsevier, and GB/T templates |
| Artifact storage | S3-compatible service; local development uses MinIO |
| Sandbox | Per-job Docker invocation with no network, read-only root filesystem, dropped capabilities, and CPU/memory/pids/time limits |

The Phase 3 export chain remains supported during migration:

```text
Tiptap JSON
  -> Web PM-to-AST projection
  -> current raw AST compile request
  -> Fastify
  -> BullMQ/Redis
  -> Worker
  -> Docker Typst sandbox
  -> private S3-compatible artifact
  -> signed download URL
```

Phase 4 migration is additive. P4-03 adds target schemas without deleting the current raw AST contract. P4-08 establishes the authenticated target API through immutable snapshot, initial Compile Job, transactional outbox, and idempotent BullMQ enqueue, but does not cut over the Web or remove the current contract. The current Phase 3 Web/API/Queue/Worker export path must remain usable until P4-09 completes and validates the full Queue-to-Worker-to-Job-to-Artifact replacement path, authorized download, and Web migration. Only after P4-09 acceptance may the old public raw AST compile contract be removed. No intermediate state may leave PDF export unavailable.

## 3. Phase 4 Accepted Target Architecture

### 3.1 Scope

Phase 4 is divided into Core and Stretch.

Phase 4 Core has one product objective: a user can visit a public URL, sign up or log in, write, save, reload, cite, request an authenticated PDF export, and download only an authorized artifact.

Phase 4 Stretch contains DOCX/Pandoc, the full version-history UI, the full multi-project UI, and a complex marketing landing experience. These do not block Phase 4 completion.

### 3.2 Editable canonical document and compile projection

The only editable canonical representation is a persisted ProseMirror document envelope:

```ts
type PersistedDocumentEnvelope = {
  schemaVersion: 1;
  editor: PersistedPmDocument;
  metadata?: DocMetadata;
};
```

`editor` contains the restricted Tiptap/ProseMirror JSON required to reload the editor. `metadata` contains semantic publication metadata. The envelope must reject presentation fields, including `font`, `fontSize`, `color`, `spacing`, `margin`, `layout`, and `templateId`.

The semantic DePress `Doc` AST is a deterministic, derived compile projection:

```text
persisted PM envelope
  -> persisted schema validation
  -> PM document to semantic Doc AST
  -> metadata merge
  -> DocSchema validation
  -> cited Project references resolution
  -> immutable compile input snapshot
```

The semantic AST is not a second editable source of truth. Reload uses persisted PM JSON directly; a general AST-to-ProseMirror conversion is not required for Phase 4 Core.

### 3.3 Ownership and reference model

Project is the Core ownership boundary:

```text
User 1 -> many Projects
Project 1 -> many Documents
Project 1 -> one logical Reference Library
Document 1 -> many sparse Document Checkpoints
Document 1 -> many Compile Jobs
Compile Job 1 -> zero or one Artifact
```

- Each user receives exactly one default Project through an idempotent server-side operation.
- Documents belong to a Project.
- References belong to a Project and may be reused by its Documents.
- Owner identity comes only from a validated database session; clients never choose or assert an owner.
- Job and artifact reads are owner-scoped. UUID secrecy is never authorization.

This is a logical model. P4-04 decides the physical schema while preserving these ownership and relationship invariants. This document does not lock an ORM, database vendor, exact index order, composite foreign-key layout, redundant `owner_user_id` columns, or whether a reference library requires its own physical table.

### 3.4 Persistence and sparse versioning

Postgres is the business source of truth for Documents, References, Compile Jobs, artifact metadata, and the transactional outbox.

Core document state consists of:

- current content;
- current revision;
- content hash;
- sparse immutable checkpoints.

Every successful save uses optimistic concurrency and advances the current revision. Autosave does not create a checkpoint for every debounce. Core checkpoint triggers are document creation, an export-time checkpoint when explicitly needed, and a user-explicit checkpoint. Phase 4 does not define a periodic checkpoint schedule and does not implement a full history or complex restore UI.

### 3.5 Authentication and authorization

The accepted default Auth architecture is Better Auth with Postgres database sessions and a first-party session cookie. Production cookies are HttpOnly, Secure, and SameSite. Browser API traffic uses a same-origin proxy.

Every protected Fastify route validates the session and derives ownership from the validated user. Public anonymous compile is forbidden. The exact sign-up method, email-verification policy, transactional email provider, and choice between email/password and OAuth are implementation-spike decisions rather than architecture-frozen vendor choices.

### 3.6 Target compile contract and immutable snapshot

The target public request is:

```json
{
  "documentId": "uuid",
  "revision": 17,
  "templateId": "ieee",
  "format": "pdf"
}
```

The API authenticates, verifies ownership and the exact revision, loads and validates the persisted envelope, derives the semantic AST, resolves cited Project references, validates the compile input, and stores an immutable `compile_jobs.input_snapshot` plus a deterministic snapshot hash.

The default Queue payload is minimal:

```json
{
  "jobId": "uuid",
  "snapshotHash": "sha256"
}
```

P4-08 ends after the dispatcher has reliably and idempotently submitted this payload to BullMQ. It owns the authenticated target request, owner and revision checks, envelope validation, semantic projection, cited Reference resolution, immutable snapshot and hash, initial Job row, transactional outbox, dispatcher, Queue contract, and enqueue reconciliation. It does not own Worker execution, terminal Job state, Artifact persistence, Web cutover, or removal of the raw public contract.

P4-09 starts at the Queue consumer boundary. The Worker validates the payload, loads the trusted Job and snapshot from Postgres, verifies the hash, atomically claims the Job, and compiles that immutable input. It does not reload the current Document or current References during retry. P4-09 also owns terminal Job writes, Artifact persistence and authorization, the Web migration, real replacement-chain PDF validation, and the final additive cutover.

### 3.7 Job truth and DB/Queue consistency

Postgres is the source of truth for ownership, audit data, input snapshots, and terminal Job state. BullMQ/Redis is transport only.

P4-08 DB/Queue consistency uses:

1. a transactional outbox row committed with the Compile Job;
2. the database Job UUID as the idempotent BullMQ job ID;
3. enqueue retry and reconciliation using the same BullMQ job ID.

If DB commit succeeds and BullMQ enqueue fails, the pending outbox event is retried. If BullMQ accepts the job but the DB queued update fails, the dispatcher retries the same BullMQ job ID and never moves a later DB state backwards. A small P4-08 reconciler handles stale enqueue states.

P4-09 adds the idempotent Worker and processing-state reconciliation. Worker retries always use the same immutable DB snapshot, claim DB state atomically, and write a deterministic artifact key. Postgres terminal success or failure remains authoritative regardless of BullMQ transport state.

### 3.8 Artifact authorization and lifecycle

Artifacts are private objects. Postgres stores their owner relationship, object key, checksum, size, and expiry. The API verifies the validated session and artifact ownership before issuing a short-lived signed URL.

Core deletion scope is intentionally small: Documents support soft delete; artifacts have `expires_at`; scheduled cleanup retries failed object deletion; S3 lifecycle is a backstop. A recovery guarantee, recycle-bin UI, and complex deletion workflow are Stretch or later product decisions.

### 3.9 CI and CD

CI and CD are separate workstreams.

The early CI baseline runs lint, typecheck, default tests, and build on pull requests. Real Docker, Crossref, and other opt-in smoke tests remain skipped by default.

Production migrations, deployment gates, post-deploy smoke, and rollback belong to the later CD workstream. Applications do not auto-migrate production databases on boot.

### 3.10 Package organization

`packages/ast` remains the shared schema source in Phase 4. New schemas should be organized incrementally by internal domains such as `editor`, `document`, `references`, `persistence`, `compile`, `jobs`, and `api`. A future `@depress/contracts` split may be evaluated after Core; package renaming is not a Core task.

## 4. Phase 4 Provisional Deployment Topology

The provisional target is:

```text
Browser
  -> Vercel-hosted Next.js Web
  -> same-origin /api proxy
  -> dedicated Linux VM
       -> Fastify API without Docker-daemon access
       -> private Redis/BullMQ
       -> Worker with Docker-daemon access
       -> per-job fixed-image Typst Docker sandbox
  -> managed Postgres
  -> private S3-compatible object storage
```

This topology is **Proposed, not Accepted**. P4-02 is a technical spike, not a production deployment. It uses no formal production domain or production user data and does not select DigitalOcean, Fly, Railway, or any other provider as an accepted vendor.

The spike must prove Linux host compatibility, Docker isolation flags, resource limits, concurrency, timeouts, restart/retry behavior, cleanup, font mounts, object-storage integration, and the separation between the public API and Docker privileges. Only a successful spike may change ADR 0007 to Accepted. A failed spike changes it to Superseded and triggers a new topology decision.

## 5. Stretch Roadmap

- DOCX export through Pandoc and reference-document assets.
- Full document-version history, comparison, naming, and restore UI.
- Full multi-project workspace UI and project lifecycle management.
- Complex marketing landing, SEO, blog, and analytics.
- Team ownership, sharing, RBAC, and shared reference libraries.
- Collaboration, CRDT, and offline-first editing.
- Per-job VM or other advanced compile-isolation topology.
- Multi-region and high-availability infrastructure.

## 6. Directory Direction

```text
depress/
├── apps/
│   ├── web/                   # Next.js editor and public product UI
│   └── api/                   # Fastify API, persistence, queue, workers
├── packages/
│   ├── ast/                   # Shared Zod schemas and inferred types
│   ├── transformers/          # Pure semantic AST -> Typst transformations
│   └── templates/             # Immutable journal templates
├── docker/                    # Local/current sandbox assets
├── docs/
│   └── adr/                   # Architecture decision records
├── architecture.md
├── process.md
└── .cursorrules
```
