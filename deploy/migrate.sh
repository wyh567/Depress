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
MIGRATION_RUNTIME_DIR=${MIGRATION_RUNTIME_DIR:-/run/depress-migration}
COREPACK_BIN=${COREPACK_BIN:-/usr/bin/corepack}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
IDENTITY_EXEC=${DEPRESS_IDENTITY_EXEC_BIN:-${SCRIPT_DIR}/run-as-identity.sh}

[[ -f "$IDENTITY_EXEC" && ! -L "$IDENTITY_EXEC" ]] || {
  echo "migration identity runner is missing or a symlink" >&2
  exit 1
}
# shellcheck disable=SC1090
source "$IDENTITY_EXEC"

test -L "${DEPRESS_ROOT}/current"
test -r "${MIGRATION_ENV_FILE}"

id "${MIGRATION_USER}" >/dev/null 2>&1 || {
  echo "migration user does not exist" >&2
  exit 1
}
MIGRATION_GROUP=$(id -gn "${MIGRATION_USER}")
[[ "${MIGRATION_GROUP}" == "${MIGRATION_USER}" ]] || {
  echo "migration user must have a matching private primary group" >&2
  exit 1
}
if id -nG "${MIGRATION_USER}" | tr ' ' '\n' | grep -Fxq docker; then
  echo "migration user must not belong to the docker group" >&2
  exit 1
fi

[[ "${MIGRATION_RUNTIME_DIR}" == /* &&
  "${MIGRATION_RUNTIME_DIR}" != "/" &&
  "$(readlink -m -- "${MIGRATION_RUNTIME_DIR}")" == "${MIGRATION_RUNTIME_DIR}" ]] || {
  echo "migration runtime must be a normalized absolute path other than /" >&2
  exit 1
}
RUNTIME_PARENT=$(dirname -- "${MIGRATION_RUNTIME_DIR}")
[[ -d "${RUNTIME_PARENT}" && ! -L "${RUNTIME_PARENT}" &&
  "$(readlink -m -- "${RUNTIME_PARENT}")" == "${RUNTIME_PARENT}" ]] || {
  echo "migration runtime parent must be an existing real directory" >&2
  exit 1
}
DEPRESS_ROOT_REAL=$(readlink -m -- "${DEPRESS_ROOT}")
case "${MIGRATION_RUNTIME_DIR}/" in
  "${DEPRESS_ROOT_REAL}/"*)
    echo "migration runtime must be outside the release root" >&2
    exit 1
    ;;
esac

ensure_private_runtime_directory() {
  local directory=$1
  if [[ ! -e "${directory}" && ! -L "${directory}" ]]; then
    install -d -o "${MIGRATION_USER}" -g "${MIGRATION_GROUP}" -m 0700 -- "${directory}"
  fi
  [[ -d "${directory}" && ! -L "${directory}" &&
    "$(readlink -m -- "${directory}")" == "${directory}" &&
    "$(stat -c '%U:%G:%a' -- "${directory}")" == "${MIGRATION_USER}:${MIGRATION_GROUP}:700" ]] || {
    echo "migration runtime metadata is not private and exact" >&2
    exit 1
  }
}

ensure_private_runtime_directory "${MIGRATION_RUNTIME_DIR}"
ensure_private_runtime_directory "${MIGRATION_RUNTIME_DIR}/corepack"
ensure_private_runtime_directory "${MIGRATION_RUNTIME_DIR}/cache"

run_as_identity_from_safe_cwd "${MIGRATION_USER}" \
  /usr/bin/env \
  HOME="${MIGRATION_RUNTIME_DIR}" \
  COREPACK_HOME="${MIGRATION_RUNTIME_DIR}/corepack" \
  XDG_CACHE_HOME="${MIGRATION_RUNTIME_DIR}/cache" \
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
