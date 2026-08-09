# ADR 0007 -- Production MVP Compile Sandbox Topology

## Status

Accepted

## Date

2026-07-11; accepted 2026-08-09

## Context

The Worker invokes a fixed Typst image through the host Docker daemon with network, filesystem, capability, process, memory, CPU, and timeout restrictions. Ordinary application container platforms cannot be assumed to provide the Docker socket or privileged nested-container behavior required by that implementation.

The original proposal separated a Vercel-hosted Web tier from a dedicated backend VM. The repository's hardened deployment assets and historical Day 10 staging exercise instead validated one Linux host with a same-origin nginx edge and strict runtime identities. Production has not yet been deployed, and the Day 10 evidence at `8a83cfd` is historical rather than current-master production acceptance.

## Decision

For the Production MVP, use a single Linux VM running:

- nginx as the only public application edge;
- the Next.js Web process;
- the Fastify API;
- PostgreSQL;
- Redis/BullMQ;
- the Outbox Publisher;
- the Pointer Worker; and
- one fixed-image, no-network Typst Docker sandbox per Compile Job.

Browser traffic is same-origin through nginx. Internal services remain private, and only the Pointer Worker identity may access the Docker daemon. Artifact objects remain in an independent private S3-compatible service and are exposed only through owner-authorized, short-lived signed URLs.

This is a Production MVP deployment decision, not a permanent scaling architecture or infrastructure-provider commitment.

## Consequences

- The MVP has a smaller operational surface and one release/rollback boundary.
- Web, API, database, queue, and compile workloads share one host, so host failure is a full application outage and resource contention must be monitored.
- PostgreSQL and Redis are private on the VM; artifact storage remains external and private.
- nginx provides the same-origin public boundary, but authorization remains enforced by Fastify.
- The sandbox retains its per-job Docker isolation and Worker-only Docker privilege boundary.
- T-04 production safety controls, production provisioning, deployment, and current-master acceptance remain separate unfinished work. Acceptance of this ADR does not claim that production is live.

## Future decomposition triggers

Decompose the single-VM topology only when operational evidence justifies the added complexity, including:

- sustained CPU or memory contention between Web/API and compilation;
- a need to scale Pointer Workers independently;
- database reliability, backup, or availability requirements that a single host cannot meet; or
- unacceptable single-host recovery time or recovery-point characteristics.

Any such change requires a new ADR based on observed production constraints.

## Alternatives considered

- Vercel-hosted Web plus a dedicated backend VM. Not selected for the Production MVP because the repository now has a hardened same-origin single-VM deployment boundary and the split adds operational and routing complexity without current evidence of need.
- Run Typst directly inside the long-lived Worker. Rejected because it removes the existing per-job sandbox boundary.
- Assume a general container platform supports nested Docker. Rejected because Docker-daemon access and privilege behavior must be proven rather than assumed.
- Per-job VM or remote compile service. Deferred until isolation or scaling evidence warrants the additional operational cost.

## Migration / implementation notes

The accepted topology matches `deploy/README.md`: nginx, Web, API, Outbox Publisher, Pointer Worker, PostgreSQL, and Redis are VM-local; private S3-compatible artifact storage is external. The historical Day 10 staging exercise validated the deployment model at `8a83cfd`, but production deployment and acceptance against current master are still pending.
