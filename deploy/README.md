# DePress single-VM production deployment

This package targets one Ubuntu Linux VM running the Next.js Web, Fastify API,
Outbox, Pointer Worker, explicit Migration entrypoint, and a timer-triggered
one-shot Artifact Cleanup process. nginx is the only public application
boundary:

```text
Internet
  -> nginx :443 (HTTP :80 redirects; ACME challenge is allowed)
     /api/* -> 127.0.0.1:3001 (Fastify API)
     /*     -> 127.0.0.1:3000 (Next.js Web)
```

PostgreSQL and Redis are VM-local and private. S3-compatible artifact storage
is external to the VM and private; owner-authorized downloads use short-lived
signed URLs. The Docker socket remains private, and the Worker is the only
DePress identity allowed to use Docker.

## Runtime commands

| Process | Exact command | Identity | Environment |
| --- | --- | --- | --- |
| Web build | `corepack pnpm --filter @depress/web build` | root during build | `DEPRESS_API_ORIGIN=http://127.0.0.1:3001` |
| Web | `corepack pnpm --dir /opt/depress/current --filter @depress/web start --hostname 127.0.0.1 --port 3000` | `depress-web` | `/etc/depress/web.env` |
| API | `corepack pnpm --dir /opt/depress/current --filter @depress/api start:api` | `depress-api` | `/etc/depress/api.env` |
| Outbox | `corepack pnpm --dir /opt/depress/current --filter @depress/api start:outbox` | `depress-outbox` | `/etc/depress/outbox.env` |
| Pointer Worker | `corepack pnpm --dir /opt/depress/current --filter @depress/api start:pointer-worker` | `depress-worker` | `/etc/depress/pointer-worker.env` |
| Migration | `corepack pnpm --dir /opt/depress/current --filter @depress/api db:migrate` | `depress-migration` | `/etc/depress/migration.env` |
| Artifact Cleanup | `corepack pnpm --dir /opt/depress/current --filter @depress/api artifacts:cleanup` | `depress-cleanup` | `/etc/depress/artifact-cleanup.env` |

The public browser path is same-origin. Web clients use relative `/api/*`
URLs. The nginx API location is the sole public `/api/*` proxy. The existing
Next rewrite remains a loopback-only fallback for a direct, non-public Web
request and points at `DEPRESS_API_ORIGIN`; it cannot loop through nginx.

## Identities and environment files

Create six independent system identities with private primary groups:

```bash
sudo groupadd --system depress-release
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin depress-web
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin depress-api
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin depress-outbox
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin depress-worker
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin depress-migration
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin depress-cleanup
sudo usermod -aG depress-release depress-web
sudo usermod -aG depress-release depress-api
sudo usermod -aG depress-release depress-outbox
sudo usermod -aG depress-release depress-worker
sudo usermod -aG depress-release depress-migration
sudo usermod -aG depress-release depress-cleanup
sudo usermod -aG docker depress-worker
```

All six identities retain their private primary groups and receive only the
supplemental `depress-release` group for immutable program reads. That group
must never own an environment file or Secret. Only the Worker may additionally
belong to `docker`. The Web identity has no database,
Redis, S3, Auth, migration, or Docker credentials and reads only
`/etc/depress/web.env`.

```bash
sudo test ! -L /etc/depress
sudo install -d -o root -g root -m 0711 /etc/depress
```

Use `deploy/env.production.example` to create the six root-owned files. Each
file is `root:<matching-private-group>` with mode `0640`. The cleanup file is
`root:depress-cleanup` mode `0640` and contains only its least-privilege
`DATABASE_URL` plus its cleanup-only S3 endpoint, region, bucket, access key,
and secret key. A custom `S3_ENDPOINT` enables the application's existing
path-style behavior; its URL scheme selects HTTP or TLS. `web.env` contains
only:

```text
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=3000
NEXT_TELEMETRY_DISABLED=1
DEPRESS_API_ORIGIN=http://127.0.0.1:3001
```

Run `sudo bash deploy/verify-env-permissions.sh` before enabling services. It
checks positive reads, all cross-file denials, private groups, the non-listable
`0711` directory boundary, and Worker-only Docker membership without printing
environment contents.

All deployment-layer privilege drops use `deploy/run-as-identity.sh`. It
changes to `/` before executing an absolute command with a minimal trusted
environment, so a service identity never inherits a root-only operator cwd.

## Immutable releases

`release.sh` accepts only a clean worktree and an exact 40-character HEAD SHA.
It builds Web and the backend from a `git archive` of that SHA. Dependency
installation forces pnpm's copy import method so permission normalization
cannot mutate or inherit a hard-linked global store. Before activation,
`release-permissions.sh` rejects dangling, looping, escaping, or hard-linked
runtime files, then enforces `root:depress-release`: `0750` on parents and
directories, `0640` on ordinary files, and `0750` only on files that were
already executable. All six identities must read and traverse the Release and
must be unable to write it. This includes `depress-cleanup`, which can execute
the cleanup package from the Release but cannot modify it. Only then is
`.depress-release` finalized and
`current`/`previous` switched atomically.

The service restart order is API, Outbox, Worker, Web. The API is restarted
first so the Web's loopback API origin is available; the asynchronous services
then start from the same `current` symlink, and Web starts last. Migration is
never implicit. A restart or health failure restores both symlinks and
restarts all four services on the former release. `rollback.sh` uses the same
four-service transaction. Release directories are never writable by runtime
identities.

The Web unit uses systemd `StateDirectory` and `CacheDirectory` at
`/var/lib/depress-web` and `/var/cache/depress-web`, both private `0700`
directories. This keeps any Next runtime cache outside the immutable release;
the Web has no write path under `/opt/depress`. Its address-family sandbox adds
only `AF_NETLINK` beyond loopback networking because Next.js reads interface
metadata through Node's `os.networkInterfaces()` during startup.

`deploy/systemd/verify-depress-web-unit.sh` verifies the production Web unit
with the exact target systemd major and a replacement `SYSTEMD_UNIT_PATH` that
contains only `depress-web.service`, `sysinit.target`, and
`network-online.target`. It requires both a zero analyzer exit status and an
empty analyzer diagnostic log. Host package units therefore cannot enter the
static verification graph, while any warning or error from the target unit or
the two controlled stubs still fails closed. The validator separately checks
the exact `ExecStart`, `WorkingDirectory`, and `EnvironmentFile` contract and
their filesystem objects before installing the unit.

## nginx and health checks

Install `deploy/nginx/depress-api.conf` in the nginx `http` context. It
provides an HTTP-to-HTTPS redirect, ACME challenge support, the TLS virtual
host for `de-press.xyz`, same-origin `/api/*`, and the Web root. It forwards
Host, X-Forwarded-Host, X-Forwarded-Proto, X-Forwarded-For, and X-Real-IP.
HTML, authentication, and API responses are not publicly cached; immutable
`/_next/static/*` assets may be cached. API/PDF proxying is unbuffered with
bounded timeouts. It does not publish ports 3000, 3001, 5432, 6379, 9000,
9001, 2375, or 2376.

`health-check.sh` accepts a testable HTTPS origin, Host header, CA file, and
optional PDF download path through environment variables. It checks nginx
health, the Web root and a discovered static asset, same-origin API routing,
internal-route denial, current-release markers, active Web/API units, and an
optional PDF response without requiring production secrets.

## Day 10 production-like Harness

The Harness creates the disposable `depress-day10-web` identity and matching
group in addition to API, Outbox, Worker, and Migration. It starts the real
production-shaped Web unit, API, Outbox, Worker, and nginx unit; browser checks
use the nginx HTTPS root and never connect directly to port 13000. The Web
environment points to loopback API port 13001 and contains no backend secret.

Cleanup is marker- and ownership-checked. It stops the disposable units,
removes Web runtime data, secrets, release data, configuration, the five
disposable identities, and their private groups, and refuses to touch
pre-existing system users or services.

The full candidate flow remains the only formal exact-SHA Full Smoke. Any
validation performed on this uncommitted worktree must be labeled
`NON_CANDIDATE_DIRTY_TREE_VALIDATION`.

## Ubuntu 22.04 and resource notes

Run `bash deploy/host-preflight.sh` on the target before installation. It is
read-only and reports the OS, systemd, CPU, RAM, swap, disk, required command
versions, and listener state. The units use directives supported by systemd 249: `StateDirectory`,
`CacheDirectory`, `RuntimeDirectory`, `ProtectSystem`, `ProtectHome`,
`ReadOnlyPaths`, and `ReadWritePaths`. Node 22, Corepack/pnpm 9, nginx,
Docker Engine, PostgreSQL **server 15 or newer**, Redis, `runuser`, GNU `tar`,
`readlink`, `stat`, `ss`, and `systemd-analyze` are host prerequisites; no
installer is included.

`host-preflight.sh` gates the host on Ubuntu 22.04, but **Ubuntu 22.04
compatibility does not imply that its default PostgreSQL package is an
acceptable production version**. Ubuntu 22.04 ships PostgreSQL 14, and
PostgreSQL 14 and older grant `CREATE` on schema `public` to `PUBLIC` by
default — which would let `depress_cleanup` create objects regardless of its
own least-privilege grants. The version that matters is the one reported by the
**actual connected database server**, not the host OS, the `psql` client, or a
container image tag. PostgreSQL 16 is the version the cleanup permission model
is currently validated against.

The resource gates use exact kernel values: at least 2 CPUs from `nproc`,
`MemTotal >= 3407872 kB` from `/proc/meminfo`, at least 1610612736 bytes of
enabled swap from `/proc/swaps`, and at least 21474836480 available bytes from
`df -B1 -P /`. The 3.25 GiB `MemTotal` floor represents a nominal 4 GiB cloud VM:
firmware and kernel reservations mean Linux may not see all purchased RAM. It
still rejects a 3 GiB class or clearly undersized host. This is a total-memory
class gate, not a current `MemAvailable` requirement; the full Smoke and
resource sampling remain responsible for exposing OOM, swap, and pressure.

On a 2 vCPU/4 GiB VM, one idle Next Web process is expected to be a modest
additional Node resident set, but build-time Next memory is the main peak risk.
The combined API, Web, Outbox, Worker, PostgreSQL, Redis, and Typst sandbox
workload may approach the memory limit during a PDF compile, so keep the 2 GiB
swap and observe actual RSS before setting limits. The 40 GiB disk is primarily
used by the OS, one or two releases, package/build artifacts, PostgreSQL data,
Docker layers, and journals. External S3-compatible artifact storage and its
object data are not part of the VM resource budget. Set bounded journald
retention and an explicit release-retention policy during host operations; this
package does not delete operator-owned releases automatically.

## Artifact cleanup production contract

Install `deploy/systemd/depress-artifact-cleanup.service` and its matching
timer under `/etc/systemd/system`. The service runs as the non-login
`depress-cleanup` identity, reads only
`/etc/depress/artifact-cleanup.env`, and invokes one bounded cleanup batch.
The service is `Type=oneshot`, has a 30-minute start timeout, and has no restart
loop. `depress-artifact-cleanup.timer` uses `OnCalendar=hourly` with
`Persistent=true`; a host that was down receives one catch-up activation, not
one activation per missed hour.

Application artifact expiry is seven days. Each cleanup invocation claims at
most 100 expired rows; abandoned claims become reclaimable after 15 minutes.
The database role is `depress_cleanup`, distinct from all application and
migration roles. Create it as a dedicated `LOGIN NOINHERIT` role with no role
memberships, set its password outside the repository, and apply
`deploy/postgres/artifact-cleanup-grants.sql` while connected to the production
application database as its owner. The grant file permits only database
connection, schema usage, reads of the eight lifecycle/artifact columns needed
by the claim query, and updates of `artifact_cleanup_token`,
`artifact_cleanup_started_at`, and `artifact_deleted_at`. It grants no row
insert/delete, migration, auth-table, outbox, or unrelated-column access.

Run the grant file with `ON_ERROR_STOP` so a refused prerequisite is also a
nonzero exit:

```bash
psql -v ON_ERROR_STOP=1 -f deploy/postgres/artifact-cleanup-grants.sql
```

The whole installation is one transaction, and it verifies two production
prerequisites against the connected server before granting anything. A refused
prerequisite rolls back, so it can never leave a partially installed permission
state:

1. **PostgreSQL server 15 or newer**, read from the server's own
   `server_version_num`. PostgreSQL 14 is refused.
2. **`PUBLIC` must not hold `CREATE` on schema `public`.** The script reads the
   effective schema ACL rather than inferring it from the version, because a
   database upgraded to 15+ keeps its historical public-schema ACL. A
   version-15+ server with an inherited `PUBLIC` `CREATE` grant is refused too.

If either prerequisite fails, cleanup permissions are **not** installed and
production provisioning is blocked until an operator resolves it. The script
never changes the `PUBLIC` ACL itself: removing `CREATE` from `PUBLIC` is a
database-wide privilege change, so an operator must first confirm which roles
still require explicit `CREATE` on schema `public` — migration and application
roles may rely on it — harden the schema deliberately as a database-security
action, and only then rerun the installation.

S3-compatible credentials remain separated by process:

- API: read/sign existing private artifacts; no object deletion.
- Pointer Worker: write `artifacts/*`; no cleanup deletion.
- Cleanup: `DeleteObject` only for the exact object-resource prefix
  `<private-bucket>/artifacts/*`; no `PutObject`, `GetObject`, presigning,
  bucket listing, bucket creation, lifecycle administration, or deletion
  outside `artifacts/*`.

The provider is intentionally not selected or configured by this repository.
Production provisioning must add a provider-native lifecycle backstop for the
`artifacts/` prefix at 14 days, longer than the application's seven-day
retention. This removes upload orphans that never reached a successful database
transition. If bucket versioning is enabled, the provider rule must also cover
noncurrent object versions and delete markers using provider-appropriate
semantics. Application code must not provision or administer this rule.

### Mandatory production provisioning gates

Production is not ready until an operator records confirmation of every gate:

1. Select an external private S3-compatible provider.
2. Provision a separate cleanup S3 credential.
3. Limit cleanup S3 access to `DeleteObject` on `artifacts/*` only.
4. Confirm the API identity remains read/sign only.
5. Confirm the Pointer Worker identity remains write only.
6. Provision the production database on PostgreSQL server 15 or newer with
   `PUBLIC` holding no `CREATE` on schema `public`, then create
   `depress_cleanup` and apply the reviewed minimum PostgreSQL grants. The
   grant script refuses to install if either prerequisite is unmet.
7. Install `/etc/depress/artifact-cleanup.env` as
   `root:depress-cleanup` mode `0640`.
8. Create the non-login `depress-cleanup` system account and private group.
9. Install `depress-artifact-cleanup.service`.
10. Install and enable the hourly persistent cleanup timer.
11. Configure the provider lifecycle backstop for `artifacts/` at 14 days.
12. If versioning is enabled, cover noncurrent versions and delete markers.
13. Run one safe cleanup service invocation and verify successful completion.
14. Verify the timer is enabled and its next activation is scheduled.
