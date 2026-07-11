# ADR 0001 -- Phase 4 Core and Stretch

## Status

Accepted

## Date

2026-07-11

## Context

The former Phase 4 roadmap mixed the public product exit path with DOCX, a complete multi-project workspace, full version history, deployment, and marketing work. Treating every bullet as a completion blocker would expand the phase without improving the minimum public product proof.

## Decision

Phase 4 is divided into Core and Stretch.

Core has one product objective: a user can visit a public URL, sign up or log in, write, save, reload, cite, request an authenticated PDF export, and download only an authorized artifact.

Core includes persistence, ownership, Auth, authorized deterministic PDF compilation, production safeguards, CI/CD, deployment, and the public exit smoke required for that path.

Stretch includes DOCX/Pandoc, full version-history UI, full multi-project UI, complex marketing landing work, and other capabilities not required by the Core product path.

## Consequences

- Phase 4 COMPLETE is measured by the verifiable Core exit criteria, not by completion of every historical Phase 4 idea.
- Project remains part of the Core data and ownership model even though the full workspace UI is Stretch.
- A minimal public entry and Auth navigation are Core; a complex marketing site is not.
- P4-00 completes documentation only and changes Phase 4 to IN PROGRESS without claiming any product capability is implemented.

## Alternatives considered

- Use only the short public URL/signup/write/export exit statement. Rejected because it leaves persistence, authorization, consistency, and production readiness ambiguous.
- Require every former Phase 4 bullet. Rejected because DOCX and full workspace/history UI are independent product expansions.

## Migration / implementation notes

`process.md` owns the P4-00 through P4-12 execution plan and exit checklist. Stretch items must not be pulled into Core unless a later ADR demonstrates that a Core exit criterion cannot be met without them.
