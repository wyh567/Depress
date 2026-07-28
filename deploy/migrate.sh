#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo "migrate.sh must run as root" >&2
  exit 1
fi

DEPRESS_ROOT=${DEPRESS_ROOT:-/opt/depress}
MIGRATION_ENV_FILE=${MIGRATION_ENV_FILE:-/etc/depress/migration.env}

test -L "${DEPRESS_ROOT}/current"
test -r "${MIGRATION_ENV_FILE}"
set -a
# shellcheck disable=SC1090
source "${MIGRATION_ENV_FILE}"
set +a
: "${DATABASE_URL:?DATABASE_URL is required}"

runuser -u depress-api -- \
  /usr/bin/corepack pnpm --dir "${DEPRESS_ROOT}/current" \
  --filter @depress/api db:migrate
