# DePress Day 9 deployment and recovery runbook

This package targets a Vercel-compatible Next.js Web and one private Linux VM.
The VM runs three distinct systemd identities: `depress-api`,
`depress-outbox`, and `depress-worker`, each with a matching private primary
group. A fourth non-login identity, `depress-migration`, runs only explicit
migrations. Only `depress-worker` belongs to the host `docker` group.
PostgreSQL, Redis, S3-compatible storage, and the Docker socket must not listen
on a public interface.

## Runtime commands

| Process        | Exact command                                     | Startup validation/readiness                                            |
| -------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Web build      | `pnpm --filter @depress/web build`                | `DEPRESS_API_ORIGIN` is required in production                          |
| API            | `pnpm --filter @depress/api start:api`            | configuration and S3 shape at boot; `/health/ready` checks DB and Redis |
| Outbox         | `pnpm --filter @depress/api start:outbox`         | configuration at boot; systemd `active` plus safe startup log           |
| Pointer Worker | `pnpm --filter @depress/api start:pointer-worker` | configuration, Docker reconciliation, S3 shape, then safe startup log   |
| Migration      | `pnpm --filter @depress/api db:migrate`           | PostgreSQL only; never called by API startup                            |

## Environment contract

S = secret, N = non-secret, R = production-required, O = optional.

| Variable                                    | Owner                          | Class | Default / notes                                                                    |
| ------------------------------------------- | ------------------------------ | ----- | ---------------------------------------------------------------------------------- |
| `DEPRESS_API_ORIGIN`                        | Web build                      | N/R   | none; server-only same-origin rewrite destination                                  |
| `PUBLIC_ORIGIN`                             | API                            | N/R   | local `http://localhost:3000`                                                      |
| `AUTH_ORIGIN`                               | API                            | N/R   | Better Auth base/trusted origin; local Web origin                                  |
| `BETTER_AUTH_SECRET`                        | API                            | S/R   | none; at least 32 characters                                                       |
| `DATABASE_URL`                              | API, outbox, Worker, migration | S/R   | none; use least-privilege credentials per process                                  |
| `REDIS_URL`                                 | API, outbox, Worker            | S/R   | local compatibility uses `REDIS_HOST=localhost`, `REDIS_PORT=6379`                 |
| `S3_ENDPOINT`                               | API, Worker                    | N/O   | omit for provider default; private URL for compatible storage                      |
| `S3_REGION` / `S3_BUCKET`                   | API, Worker                    | N/R   | none                                                                               |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | API, Worker                    | S/R   | separate read/sign and write identities where supported                            |
| `API_BIND_HOST` / `API_PORT`                | API                            | N/O   | `127.0.0.1` / `3001`                                                               |
| `OUTBOX_BATCH_SIZE`                         | outbox                         | N/O   | `25`, bounded 1–100                                                                |
| `OUTBOX_POLL_INTERVAL_MS`                   | outbox                         | N/O   | `1000`, bounded 100–60000 ms                                                       |
| `POINTER_WORKER_CONCURRENCY`                | Worker                         | N/O   | `1`, bounded 1–16                                                                  |
| `TYPST_IMAGE`                               | Worker                         | N/O   | exact code-pinned digest only; any other value fails boot                          |
| `TYPST_FONT_PATH`                           | Worker                         | N/O   | bundled release font directory; absolute host path override for equivalent layouts |
| `LOG_LEVEL`                                 | API, outbox, Worker            | N/O   | `info`                                                                             |
| `CROSSREF_MAILTO`                           | API                            | N/O   | none                                                                               |

`TYPST_IMAGE` accepts only the code-owned
`ghcr.io/typst/typst@sha256:...` digest; an unset value uses that same pin and
any other value fails boot. `TYPST_FONT_PATH` defaults to the directory derived
from the root-owned release and is mounted read-only; its override exists only
for an equivalent host-visible layout. A request, document, or queue item
cannot change either identity.

## First installation and release

1. Install Node 22+, Corepack, pnpm 9, Git, tar, nginx, Docker, and systemd.
2. Create `depress-api`, `depress-outbox`, `depress-worker`, and
   `depress-migration` as non-login system users. Give each identity a matching
   private primary group (`depress-api`, `depress-outbox`, `depress-worker`,
   `depress-migration`). Add only `depress-worker` to `docker`; do not add the
   API, outbox, or migration identities to that group. On a new host,
   `useradd --system --user-group --no-create-home --shell /usr/sbin/nologin
   <name>` creates the required private group and user together.
3. Install the unit templates and nginx template as root. Provision TLS files
   outside the repository at `/etc/depress/tls/`.
4. Create the four process-specific `/etc/depress/*.env` files from the
   example. Apply these exact owners and modes:

   | File | Owner | Mode |
   | ---- | ----- | ---- |
   | `/etc/depress/api.env` | `root:depress-api` | `0640` |
   | `/etc/depress/outbox.env` | `root:depress-outbox` | `0640` |
   | `/etc/depress/pointer-worker.env` | `root:depress-worker` | `0640` |
   | `/etc/depress/migration.env` | `root:depress-migration` | `0640` |

   The private groups are an access boundary: never add another runtime
   identity to them. The root-started migration script drops privileges first;
   only then does `depress-migration` read its root-owned, non-writable file.
   That file must contain exactly one non-empty `DATABASE_URL=...` line.
5. From a clean checkout of the exact commit, run
   `sudo DEPRESS_API_ORIGIN=https://<api-origin> bash deploy/release.sh "$PWD" "$(git rev-parse HEAD)"`.
6. Run `sudo bash deploy/migrate.sh` explicitly, then
   `bash deploy/health-check.sh`.
   Migrations are idempotent and are never coupled to API boot.

Before enabling or restarting services, run
`sudo bash deploy/verify-env-permissions.sh`. It verifies ownership, modes,
cross-service denial, the migration boundary, and that Docker membership is
limited to the Worker. It never prints environment-file contents.
The core read checks are equivalent to:

```bash
sudo -u depress-api test -r /etc/depress/api.env
sudo -u depress-api test ! -r /etc/depress/pointer-worker.env
sudo -u depress-worker test -r /etc/depress/pointer-worker.env
sudo -u depress-worker test ! -r /etc/depress/api.env
sudo -u depress-outbox test -r /etc/depress/outbox.env
sudo -u depress-outbox test ! -r /etc/depress/api.env
sudo -u depress-migration test -r /etc/depress/migration.env
```

Releases are immutable, root-owned directories at
`/opt/depress/releases/<commit-sha>`. `/opt/depress/current` is an atomic
symlink; `/opt/depress/previous` records the prior target. Runtime identities
have no write path under `/opt/depress`. `release.sh` rejects any staged,
modified, or untracked source file, then builds from `git archive` of the exact
40-character HEAD commit. Ignored local files and build outputs therefore
cannot enter a release.

## Restart, rollback, and recovery

Normal restart:
`sudo systemctl restart depress-api depress-outbox depress-pointer-worker`.
Confirm `systemctl is-active` for all three, then run the health script.
Outbox and Worker readiness is `active` state plus the safe startup messages;
the Worker message occurs only after Docker reconciliation.

Rollback the immediately prior code release with
`sudo bash deploy/rollback.sh`, or name a known commit with
`sudo bash deploy/rollback.sh <commit-sha>`. Database
migrations do not roll back automatically. Before release, verify migration
backward compatibility; otherwise restore PostgreSQL from a tested backup
under an explicit incident plan. After rollback, recheck all service states,
health, and journal logs.

If readiness fails, keep the API out of rotation, inspect root-only service
journals, verify private dependency reachability, and restart only after the
cause is corrected. Never paste environment files, URLs, bucket names, Docker
metadata, or raw internal errors into public diagnostics.

## Public surface

The nginx template terminates HTTPS and forwards only `/api/*`,
`/health/live`, and `/health/ready` to the loopback API. It preserves Host,
forwarded host/proto, cookies, and `Set-Cookie`; bounds body size and timeouts;
and returns 404 for `/compile`, `/jobs/*`, internal Worker/outbox prefixes, and
all other paths. Redis, PostgreSQL, S3/MinIO, and Docker have no proxy route.
