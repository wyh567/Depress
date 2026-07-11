# ADR 0003 -- Project Ownership and Reference Library

## Status

Accepted

## Date

2026-07-11

## Context

The current Web reference store is process-local and has no owner. The long-term model needs stable authorization boundaries for Documents, References, Compile Jobs, and Artifacts without making the complete multi-project UI a Core requirement.

## Decision

Project is the Phase 4 Core ownership boundary.

- Each validated User may own Projects.
- The server idempotently creates one default Project for each new User.
- Documents belong to a Project.
- References belong to a Project through one logical Project Reference Library.
- Compile Jobs derive their owner and Project relationship from the validated Document ownership chain.
- Artifacts derive authorization from their Compile Job.
- Owner identity is always derived from a validated session; clients never assert it.

UUIDs and unguessable identifiers are locators, not authorization.

## Consequences

- References can be reused by Documents in the same Project without becoming global to the User.
- The Core product can initially expose only the default Project while preserving a future multi-project UI.
- Every owner-scoped API lookup must combine the requested resource identity with the validated session identity or an equivalent verified ownership join.

## Alternatives considered

- Documents and References belong directly to User. Rejected because future Project migration would be invasive and Reference reuse boundaries would be unclear.
- References belong to each Document. Rejected because it duplicates a library and prevents natural reuse within a Project.
- A global User reference library. Rejected because it creates overly broad coupling across future Projects.

## Migration / implementation notes

This ADR fixes logical ownership, relationships, and authorization invariants only. P4-04 decides whether the physical schema uses a separate `reference_libraries` table, redundant owner columns, composite foreign keys, or ownership joins. Full Project creation/switching/lifecycle UI remains Stretch.
