# ADR 0007 -- Production Compile Sandbox Topology

## Status

Proposed

## Date

2026-07-11

## Context

The implemented Worker invokes a fixed Typst image through the host Docker daemon with network, filesystem, capability, process, memory, CPU, and timeout restrictions. Ordinary application container platforms cannot be assumed to provide the Docker socket or privileged nested-container behavior required by that implementation.

## Decision

The provisional topology to test is:

- Vercel-hosted Next.js Web;
- same-origin Web-to-API proxy;
- a dedicated Linux VM hosting the Fastify API, private Redis/BullMQ, and Worker;
- no Docker-daemon access for the public API process;
- Docker-daemon access limited to the Worker;
- one fixed-image, no-network Typst Docker sandbox per Compile Job;
- managed Postgres and private S3-compatible object storage.

This is a technical hypothesis, not an accepted production deployment or provider selection.

## Consequences

- P4-02 must run before Auth implementation because a failed sandbox model can change the backend topology.
- The spike must use non-production infrastructure and no production domain or production user data.
- No infrastructure provider is accepted by this ADR.
- Production deployment remains P4-11 and cannot be inferred from spike success alone.

## Alternatives considered

- Run Typst directly inside the long-lived Worker container. Rejected as the default because it removes the existing per-job sandbox boundary.
- Assume Railway, Fly, or another container platform supports nested Docker. Rejected because this must be proven rather than assumed.
- Per-job VM or remote compile service. Kept as a future alternative if the provisional topology fails, but not selected for Core before evidence exists.

## Migration / implementation notes

P4-02 must prove Linux compatibility, Docker isolation flags, limits, concurrency, timeout, restart/retry, cleanup, fonts, storage connectivity, and API/Worker privilege separation. If it passes, this ADR may change from Proposed to Accepted. If it fails, this ADR must become Superseded and a replacement topology ADR must be created before Auth implementation or deployment planning continues.
