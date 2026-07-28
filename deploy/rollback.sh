#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "rollback.sh must run as root" >&2
  exit 1
fi

DEPRESS_ROOT=${DEPRESS_ROOT:-/opt/depress}
SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-systemctl}
TARGET=${1:-}

if [[ -n "${TARGET}" ]]; then
  [[ ${TARGET} =~ ^[0-9a-f]{40}$ ]]
  RELEASE_DIR="${DEPRESS_ROOT}/releases/${TARGET}"
else
  test -L "${DEPRESS_ROOT}/previous"
  RELEASE_DIR=$(readlink -f "${DEPRESS_ROOT}/previous")
fi
test -d "${RELEASE_DIR}"
test -f "${RELEASE_DIR}/.depress-release"

CURRENT_TARGET=$(readlink -f "${DEPRESS_ROOT}/current")
ln -sfn "${CURRENT_TARGET}" "${DEPRESS_ROOT}/previous.new"
mv -Tf "${DEPRESS_ROOT}/previous.new" "${DEPRESS_ROOT}/previous"
ln -sfn "${RELEASE_DIR}" "${DEPRESS_ROOT}/current.new"
mv -Tf "${DEPRESS_ROOT}/current.new" "${DEPRESS_ROOT}/current"

"${SYSTEMCTL_BIN}" restart depress-api depress-outbox depress-pointer-worker
echo "rolled back to $(<"${RELEASE_DIR}/.depress-release")"
