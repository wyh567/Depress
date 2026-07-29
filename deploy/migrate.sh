#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo "migrate.sh must run as root" >&2
  exit 1
fi

DEPRESS_ROOT=${DEPRESS_ROOT:-/opt/depress}
MIGRATION_ENV_FILE=${MIGRATION_ENV_FILE:-/etc/depress/migration.env}
MIGRATION_USER=${MIGRATION_USER:-depress-migration}
COREPACK_BIN=${COREPACK_BIN:-/usr/bin/corepack}

test -L "${DEPRESS_ROOT}/current"
test -r "${MIGRATION_ENV_FILE}"

runuser -u "${MIGRATION_USER}" -- \
  env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash -c '
    set -euo pipefail
    readonly migration_env_file=$1
    readonly depress_root=$2
    readonly corepack_bin=$3
    mapfile -t migration_lines < "${migration_env_file}"
    if [[ ${#migration_lines[@]} -ne 1 ]]; then
      echo "migration.env must contain exactly one DATABASE_URL assignment" >&2
      exit 1
    fi
    case "${migration_lines[0]}" in
      DATABASE_URL=?*)
        ;;
      *)
        echo "migration.env must contain exactly one non-empty DATABASE_URL assignment" >&2
        exit 1
        ;;
    esac
    export DATABASE_URL="${migration_lines[0]#DATABASE_URL=}"
    unset migration_lines
    exec "${corepack_bin}" pnpm --dir "${depress_root}/current" \
      --filter @depress/api db:migrate
  ' bash "${MIGRATION_ENV_FILE}" "${DEPRESS_ROOT}" "${COREPACK_BIN}"
