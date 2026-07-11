# ADR 0006 -- Better Auth Database Session

## Status

Accepted

## Date

2026-07-11

## Context

The current application has no identity or authorization layer. The Web and Fastify API need one validated ownership identity for Project, Document, Reference, Job, and Artifact access while avoiding a custom authentication system.

## Decision

Use Better Auth with Postgres database sessions and a first-party session cookie. Production session cookies are HttpOnly, Secure, and SameSite. Browser requests use a same-origin proxy, and protected Fastify routes validate the real session before deriving the owner User ID.

Public anonymous compile is forbidden. Client-provided owner identifiers are ignored or rejected.

## Consequences

- Session revocation and expiration are backed by the database rather than trusting an unverified client claim.
- Project and all downstream ownership queries share the Better Auth User identity root.
- Fastify remains the final authorization boundary even when the Web performs optimistic navigation checks.
- Auth requires Postgres and may not be implemented before the production sandbox spike decision.

## Alternatives considered

- Clerk. Viable, but not selected as the default because the architecture prefers ownership and sessions in the product database and lower identity-provider lock-in.
- Browser-managed bearer tokens. Rejected as the default browser flow because first-party HttpOnly cookies reduce token exposure and match database sessions.
- Custom password/session implementation. Rejected because Auth is not a product differentiator and the security cost is unjustified.

## Migration / implementation notes

P4-05 is an implementation spike as well as integration work. It decides email/password versus OAuth, email-verification policy, and any transactional email provider. Those choices are intentionally not frozen by this ADR. The spike must verify same-origin proxy and cookie behavior before public deployment.
