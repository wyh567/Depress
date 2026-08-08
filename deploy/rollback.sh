#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "rollback.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPRESS_ROOT=${DEPRESS_ROOT:-/opt/depress}
DEPRESS_RELEASE_GROUP=${DEPRESS_RELEASE_GROUP:-depress-release}
SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-systemctl}
HEALTH_CHECK_BIN=${HEALTH_CHECK_BIN:-${DEPRESS_ROOT}/current/deploy/health-check.sh}
RELEASE_PERMISSIONS_BIN=${RELEASE_PERMISSIONS_BIN:-${SCRIPT_DIR}/release-permissions.sh}
TARGET=${1:-}
readonly -a SERVICE_UNITS=(
  depress-api
  depress-outbox
  depress-pointer-worker
  depress-web
)

CURRENT_LINK="${DEPRESS_ROOT}/current"
PREVIOUS_LINK="${DEPRESS_ROOT}/previous"
RELEASES_DIR="${DEPRESS_ROOT}/releases"

resolve_release_target() {
  local candidate=$1
  local releases_real resolved

  releases_real=$(realpath -e -- "$RELEASES_DIR") || return 1
  resolved=$(realpath -e -- "$candidate") || return 1
  [[ -d "$resolved" && "$(dirname -- "$resolved")" == "$releases_real" ]] ||
    return 1
  printf '%s\n' "$resolved"
}

if [[ -n "${TARGET}" ]]; then
  [[ ${TARGET} =~ ^[0-9a-f]{40}$ ]] || {
    echo "rollback target must be a 40-character lowercase commit SHA" >&2
    exit 2
  }
  RELEASE_DIR="${DEPRESS_ROOT}/releases/${TARGET}"
else
  test -L "${PREVIOUS_LINK}"
  RELEASE_DIR=$(resolve_release_target "${PREVIOUS_LINK}") || {
    echo "previous target escapes the releases directory" >&2
    exit 1
  }
fi
test -L "${CURRENT_LINK}"
test -d "${RELEASE_DIR}"
test -f "${RELEASE_DIR}/.depress-release"
RELEASE_DIR=$(resolve_release_target "${RELEASE_DIR}") || {
  echo "rollback target escapes the releases directory" >&2
  exit 1
}
[[ -f "$RELEASE_PERMISSIONS_BIN" && ! -L "$RELEASE_PERMISSIONS_BIN" ]] || {
  echo "release permission helper is missing or a symlink" >&2
  exit 1
}
DEPRESS_ROOT="$DEPRESS_ROOT" DEPRESS_RELEASE_GROUP="$DEPRESS_RELEASE_GROUP" \
  bash "$RELEASE_PERMISSIONS_BIN" verify "$RELEASE_DIR"

CURRENT_TARGET=$(resolve_release_target "${CURRENT_LINK}") || {
  echo "current target escapes the releases directory" >&2
  exit 1
}
HAD_PREVIOUS=0
OLD_PREVIOUS_TARGET=
if [[ -L "${PREVIOUS_LINK}" ]]; then
  HAD_PREVIOUS=1
  OLD_PREVIOUS_TARGET=$(resolve_release_target "${PREVIOUS_LINK}") || {
    echo "previous target escapes the releases directory" >&2
    exit 1
  }
fi

restore_link() {
  local link_path=$1
  local had_link=$2
  local old_target=$3
  local restore_path="${link_path}.restore"

  if [[ "${had_link}" == "1" ]]; then
    ln -sfn "${old_target}" "${restore_path}"
    mv -Tf "${restore_path}" "${link_path}"
  elif [[ -L "${link_path}" ]]; then
    rm -f -- "${link_path}"
  fi
}

restart_all_services() {
  local unit
  for unit in "${SERVICE_UNITS[@]}"; do
    "${SYSTEMCTL_BIN}" restart "${unit}"
  done
}

run_health_check() {
  [[ -x "${HEALTH_CHECK_BIN}" ]] || {
    echo "health check is missing or not executable: ${HEALTH_CHECK_BIN}" >&2
    return 1
  }
  "${HEALTH_CHECK_BIN}"
}

ln -sfn "${CURRENT_TARGET}" "${PREVIOUS_LINK}.new"
mv -Tf "${PREVIOUS_LINK}.new" "${PREVIOUS_LINK}"
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.new"
mv -Tf "${CURRENT_LINK}.new" "${CURRENT_LINK}"

if ! "${SYSTEMCTL_BIN}" daemon-reload || ! restart_all_services || ! run_health_check; then
  restore_link "${CURRENT_LINK}" 1 "${CURRENT_TARGET}"
  restore_link "${PREVIOUS_LINK}" "${HAD_PREVIOUS}" "${OLD_PREVIOUS_TARGET}"
  "${SYSTEMCTL_BIN}" daemon-reload || true
  restart_all_services || true
  echo "rollback service action failed; current and previous were restored" >&2
  exit 1
fi

echo "rolled back to $(<"${RELEASE_DIR}/.depress-release")"
