# DePress Mentor MVP Day 10 Technical Acceptance

## Classification

`MENTOR_MVP_DAY10_TECHNICAL_ACCEPTANCE_PASS`

Technical acceptance passed against application commit
`8a83cfd9dee844efc4473b05a3547edf860f1ccb` on branch
`feature/phase4-mentor-mvp`. Application releases were created from a
`git archive` of that exact commit. No product-code change was required.
Harness, configuration, test-evidence, and report changes remain unstaged and
uncommitted.

Manual mentor sign-off is pending. Production domain/provider deployment is
also pending; neither item was part of this bounded technical acceptance.

## TYPST_IMAGE harness root cause

The first pointer Worker failure was a harness environment error. The Day 10
environment supplied a mutable Typst tag, while the production parser accepts
only the code-owned pinned digest. `parsePointerWorkerEnv(process.env)` rejected
`TYPST_IMAGE` before PostgreSQL, Redis, S3, BullMQ processing, or a sandbox
container could start.

The staging harness now supplies
`ghcr.io/typst/typst@sha256:b23ba03da5c085a2c8780bc9f2296db937abe1d0c75348cf2f8a9273199c3a14`.
Independent production-parser, PostgreSQL, Redis, S3, Docker, exact-image, font,
and Worker filesystem preflight checks passed.

## Reused PDF evidence

The previously completed three-template evidence was reused; it was not
regenerated during D10-010 or the remaining-case run.

- IEEE: 14,446 bytes, one page, SHA-256
  `b60851fa3c318d7fd7fe907a47c565c44b5713b31f73da18e9b577a35f500f6e`.
- Elsevier: 19,362 bytes, one page, SHA-256
  `5b616fc76bea1f42a498600a5fe657d4dd6b10cc589e3c6ca1d6261c2cc8939f`.
- GB/T 7714: 24,976 bytes, one page, SHA-256
  `e6b1e3e0a0f662be0be0dfc5eae6715b85127cc90c77ab7fd86a89111893144c`.

All three had passed `%PDF-`, nonzero page count, authenticated download,
citation-order, and used/unused bibliography assertions. Citation stability
was 5/5, and literal `A,B,A` passed editor, save request, save response,
PostgreSQL, GET response, reopened editor, and visible-node boundaries.

## D10-010 locator diagnosis and fix

- Intended element: the visible safe download-retry alert,
  `The compile service is unavailable. Try again.`
- Original locator: page-wide `page.getByRole("alert")`.
- Match count at failure: 2.
- Match 1: application `<p role="alert">` containing the expected message,
  inside the unique `main` editor landmark.
- Match 2: Next.js `<div id="__next-route-announcer__" role="alert"
aria-live="assertive">`, empty and outside `main`.
- Both alert roles had empty accessible names. Their rendered contents differed.
- This was not duplicate application UI; two semantically distinct alert
  regions shared the same page-wide role.
- Fix classification: unique landmark/component scope, then exact alert role
  and exact message invariant. The focused locator was
  `page.getByRole("main").getByRole("alert")`, required count 1, and required
  exact text. No positional selector, broad page-text selector, data-testid,
  relaxed result, or product markup/behavior change was used.

A fresh disposable D10-010 environment used one Mentor-A login, two saved
documents, and only the two IEEE Jobs required for stale-state and retry proof.
D10-010 passed once with no Playwright retry. The corrected locator uniquely
matched the application alert; the unrelated route announcer was outside its
scope. Document switching cleared compile/download UI, stopped further polling
of the stale Job, ignored its later success, and retained an enabled download
button after the controlled 503. Timed sleeps were removed from this proof.
Listener, route, Worker, and full environment cleanup ran on success/failure.

## Remaining Day 10 results

- Logout: compile status count 0, download button count 0, session cookie count
  0, and no retained Job identifier in browser storage.
- Mentor-B isolation: document GET 404, reference mutation 404, Job GET 404,
  and download GET 404.
- Unauthenticated access: document, references, compile creation, Job, and
  download requests all returned 401.
- Unsigned private object access: 403.
- Proxy: `/compile`, `/jobs/probe`, `/api/internal/probe`,
  `/internal/worker`, and `/internal/outbox` returned 404; health endpoints
  returned 200; observed legacy compile calls remained 0.
- Docker/network boundaries: API Docker access denied; Worker Docker access
  allowed with only `/run/depress-worker` writable. PostgreSQL, Redis, and S3
  listeners were loopback-only; Docker TCP listeners 2375/2376 were absent.
- Worker recovery: a queued Job survived Worker stop/start reconciliation,
  reached `succeeded`, and had exactly one artifact.
- Compiler failure: safe `failed` status, no download UI, no internal detail,
  and download endpoint 409.
- Upload failure: safe `failed` status, no download UI, and download endpoint 409.
- Later retry/new compile: `succeeded`.
- Signed URLs persisted in neither browser storage nor database state.
- D10-011 through D10-019 passed with two controlled sign-ins, zero signup
  requests, zero retries, and no regenerated PDF evidence files.

## Validation and cleanup

- Focused D10-010: PASS in a fresh disposable environment.
- Remaining D10-011 through D10-019: PASS in a second fresh environment.
- Previously recorded IEEE, Elsevier, GB/T, citation stability, persistence,
  and focused Worker evidence: reused.
- Affected ESLint and strict TypeScript checks: PASS.
- Shell syntax: PASS.
- `git diff --check`: PASS.
- Both staging runs reported complete cleanup; final `verify-clean` reported no
  listeners, processes, containers, volumes, networks, or runtime residue.
- Full 457-test suite: intentionally not run.
- Nothing staged, committed, pushed, merged, or changed in a PR.
