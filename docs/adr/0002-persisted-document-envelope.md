# ADR 0002 -- Persisted Document Envelope

## Status

Accepted

## Date

2026-07-11

## Context

The implemented editor emits Tiptap/ProseMirror JSON, while DePress compilation consumes a different semantic `Doc` AST. Metadata currently lives outside the editor JSON. There is a PM-to-AST projection but no complete AST-to-PM reload path. Treating both shapes as the same document would create two editable sources of truth and make reliable reload ambiguous.

## Decision

The only editable canonical representation is a versioned persisted ProseMirror envelope:

```ts
type PersistedDocumentEnvelope = {
  schemaVersion: 1;
  editor: PersistedPmDocument;
  metadata?: DocMetadata;
};
```

The envelope stores the restricted PM JSON required by the editor and semantic publication metadata. It must reject presentation fields including `font`, `fontSize`, `color`, `spacing`, `margin`, `layout`, and `templateId`.

The semantic DePress `Doc` AST is a deterministic derived compile projection. It is regenerated and validated from the persisted envelope and is not an editable document source.

## Consequences

- Editor reload consumes persisted PM JSON directly.
- Metadata remains semantic but does not need to be embedded in the PM document tree.
- Compile snapshots may store a derived AST for deterministic execution without becoming a second editable canonical document.
- Envelope `schemaVersion` provides an explicit future migration boundary.

## Alternatives considered

- Persist only semantic Doc AST. Rejected because the repository has no complete AST-to-PM conversion and reload would require a new lossy or duplicated mapping.
- Persist PM JSON and semantic AST as co-equal current state. Rejected because synchronization failure would create two sources of truth.
- Put References or template selection inside the envelope. Rejected because References are Project-owned and templates are compile-time presentation inputs.

## Migration / implementation notes

P4-03 adds the persisted PM and envelope schemas to `packages/ast`. The existing PM-to-AST behavior should become a shared, deterministic projection. Existing Phase 3 export remains operational during the additive migration.
