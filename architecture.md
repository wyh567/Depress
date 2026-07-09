# ARCHITECTURE.md — "DePress" (Decoupled Academic Press)

## 1. Core Principle
Content ≠ Layout. The frontend produces a **structured content AST (JSON)**. The backend compiles it against **immutable journal templates**. Users can never touch presentation.

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript | SSR for landing/docs, SPA feel for editor |
| Editor Core | Tiptap (ProseMirror) | Schema-enforced document model; forbid marks like fontSize by omitting them from schema — enforcement at data layer, not CSS |
| State | Zustand + Tiptap doc as source of truth | Minimal re-renders; doc JSON is canonical |
| Citation UI | Custom Tiptap Node `citation` (stores citeKey only) | Rendering deferred to compile time |
| Reference Mgmt | CSL-JSON store per project; import via BibTeX/DOI (Crossref API) | Industry standard; maps directly to citeproc |
| Backend | Node.js (Fastify) + TypeScript for API; compilation jobs in isolated workers | Single language across stack |
| Compilation Engine | **Typst (primary)** + Pandoc (fallback/DOCX export) | Typst: fast (<1s), programmable templates, native bibliography. Pandoc: mature DOCX output + citeproc for CSL (incl. GB/T 7714-2015) |
| Job Queue | BullMQ + Redis | Compilation is async; PDF jobs must not block API |
| Storage | Postgres (documents as JSONB, versioned) + S3-compatible (compiled artifacts) | JSONB enables server-side AST validation |
| Sandbox | Compilation runs in Docker containers (no network, tmpfs) | Typst/Pandoc process untrusted input |
| Auth | Better-Auth or Clerk | Not a differentiator; buy don't build |

## 3. Data Flow

```
[User types]
   → Tiptap schema validates input (headings/paragraphs/citations only)
   → Doc AST (ProseMirror JSON) autosaved to Postgres (debounced, versioned)

[User cites]
   → Search local CSL-JSON library (or DOI lookup → Crossref → CSL-JSON)
   → Insert <citation citeKey="smith2024"/> node — NO formatted text stored

[User exports]
   → POST /api/compile { docId, templateId, format }
   → API validates AST against template constraints (e.g., max heading depth)
   → Job enqueued → Worker:
        1. AST → Typst markup (transformer: ast-to-typst.ts)
        2. Inject into journal template (.typ) + bibliography (CSL/Typst-native)
        3. typst compile (sandboxed) → PDF
        4. (DOCX path: AST → Pandoc Markdown → pandoc --citeproc --reference-doc)
   → Artifact uploaded to S3 → client polls/receives signed URL
```

## 4. Directory Structure

```
depress/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── app/
│   │   ├── components/
│   │   │   ├── editor/         # Tiptap extensions, citation node
│   │   │   └── library/        # Reference manager UI
│   │   └── stores/
│   └── api/                    # Fastify API
│       ├── routes/
│       ├── services/
│       └── workers/            # BullMQ compile workers
├── packages/
│   ├── ast/                    # Shared AST types + Zod schemas (single source of truth)
│   ├── transformers/           # ast-to-typst, ast-to-pandoc-md
│   └── templates/              # Journal templates (.typ, reference.docx, .csl)
│       ├── src/ieee.ts         # IEEE Typst template (immutable string asset)
│       ├── ieee/ elsevier/ gbt7714/  # reserved dirs (Phase 3 fills elsevier + gbt7714)
├── docker/                     # Sandbox images for typst/pandoc
├── architecture.md
├── process.md
└── .cursorrules
```

## 5. Key Invariants (never violate)
1. The editor schema is the ONLY gate for content structure. No rich formatting nodes, ever.
2. Citations are stored as keys, never as rendered text.
3. `packages/ast` is the single source of truth for document types; both apps import it.
4. Templates are code-reviewed assets, never user-editable in MVP.
5. Compilation is always sandboxed and async.
