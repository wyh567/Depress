# ADR 0004 -- Sparse Document Versioning

## Status

Accepted

## Date

2026-07-11

## Context

Phase 4 needs optimistic concurrency and a path to future history without generating an immutable version for every debounced autosave. Event sourcing and a complete restore product would add substantial Core complexity.

## Decision

Core document versioning consists of:

- current content;
- a monotonically increasing current revision;
- a content hash;
- sparse immutable document checkpoints.

Every accepted save validates a base revision and advances the current revision. Autosave does not create a checkpoint for every debounce.

Core checkpoint triggers are:

- Document creation;
- export time when a checkpoint is explicitly needed;
- a user-explicit checkpoint.

Phase 4 Core does not define a periodic checkpoint schedule and does not implement a complete history or complex restore UI.

## Consequences

- Revision is the optimistic-concurrency token even when no checkpoint exists for every revision.
- Compile determinism comes from the immutable Compile Job input snapshot, not from requiring a Document checkpoint for every export.
- Sparse checkpoints preserve a future path to history without unbounded autosave-version growth.

## Alternatives considered

- Store current state only. Rejected because it blocks future history and explicit checkpoints.
- Create a version for every autosave. Rejected because debounce frequency would cause unnecessary storage and noisy history.
- Event sourcing. Rejected as disproportionate to the Phase 4 product and collaboration requirements.
- Fix a five-minute checkpoint cadence. Rejected because Core has not established a product or retention need for that policy.

## Migration / implementation notes

P4-03 defines revision/checkpoint contracts. P4-04 chooses the physical table layout. P4-06 implements optimistic save conflicts and sparse checkpoint creation. History browsing, comparison, named versions, and restore UI remain Stretch.
