# ADR 0005 -- Compile Snapshot and Transactional Outbox

## Status

Accepted

## Date

2026-07-11

## Context

The Phase 3 compile route accepts a complete client-provided AST and References, and BullMQ/Redis currently carries both input and Job state. A public multi-user product needs server-authoritative ownership, deterministic retries, an immutable compile input, and a defined answer to the Postgres/BullMQ dual-write problem.

## Decision

The target public Compile request is:

```json
{
  "documentId": "uuid",
  "revision": 17,
  "templateId": "ieee",
  "format": "pdf"
}
```

The API authenticates, verifies ownership and the exact revision, loads the persisted envelope, derives and validates the semantic AST, resolves cited Project References, and stores an immutable `compile_jobs.input_snapshot` and deterministic `snapshot_hash`.

The Compile Job and a `compile.enqueue` outbox event are committed in the same Postgres transaction. An outbox dispatcher publishes `{ jobId, snapshotHash }` to BullMQ using the database Job UUID as the BullMQ job ID. The Worker loads and validates the trusted snapshot from Postgres and atomically claims DB state.

Postgres is ownership, audit, input, and terminal Job truth. BullMQ/Redis is transport only.

## Consequences

- DB success plus BullMQ failure leaves a pending outbox event that is retried.
- BullMQ success plus DB queued-update failure is recovered by retrying the same idempotent BullMQ job ID; the dispatcher never moves processing or terminal DB state backwards.
- Worker retries use the same immutable snapshot and hash, not the current Document or current References.
- Deterministic artifact keys and unique Job/Artifact relationships make repeated delivery idempotent.
- A small reconciler is required for stale enqueue and processing states.

## Alternatives considered

- Best-effort DB insert followed by direct enqueue. Rejected because a process crash can strand Jobs without a durable retry instruction.
- `pending_enqueue` plus ad-hoc reconciliation without an outbox. Rejected because it duplicates event reconstruction logic and weakens the atomic relationship between accepted Jobs and enqueue intent.
- Store the complete snapshot only in Redis. Rejected because Redis is not the business source of truth and retention/eviction would undermine audit and retries.
- Put ownerId, documentId, or documentVersionId in the Queue payload. Rejected by default because the Worker can load the authoritative relationships from the Job row.

## Migration / implementation notes

Migration is additive. P4-03 adds target schemas but does not delete the Phase 3 raw AST compile contract.

P4-08 establishes only the authenticated target Compile API, owner and exact-revision checks, persisted-envelope validation, semantic projection, cited Project Reference resolution, immutable snapshot and hash, initial Compile Job record, transactional outbox, dispatcher, minimal Queue contract, idempotent BullMQ job ID, and enqueue retry/reconciliation. P4-08 does not own Worker Postgres loading or claiming, Worker retry, terminal Job writes, Artifact persistence or authorization, Web cutover, or removal of the public raw contract.

P4-09 establishes the Worker DB load and atomic claim, snapshot-hash verification, idempotent retry, Postgres terminal Job state, Typst Docker execution, deterministic object key, Artifact persistence, owner-scoped Job and download authorization, Web migration using the P4-07 save-flush capability, real replacement-chain PDF validation, and the final cutover.

Only after P4-09 accepts the complete Web target request -> API snapshot -> outbox -> BullMQ -> Worker -> DB Job lifecycle -> Artifact -> authorized PDF download chain may the old public raw AST compile contract be removed. Export must remain available throughout migration.
