#!/usr/bin/env bash
set -euo pipefail
umask 022

if [[ ${EUID} -ne 0 ]]; then
  echo "release.sh must run as root" >&2
  exit 1
fi
if [[ $# -ne 2 ]]; then
  echo "usage: release.sh <clean-source-directory> <40-character-commit-sha>" >&2
  exit 2
fi

SOURCE_DIR=$(realpath "$1")
COMMIT_SHA=$2
DEPRESS_ROOT=${DEPRESS_ROOT:-/opt/depress}
SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-systemctl}

[[ ${COMMIT_SHA} =~ ^[0-9a-f]{40}$ ]]
[[ $(git -C "${SOURCE_DIR}" rev-parse HEAD) == "${COMMIT_SHA}" ]]
git -C "${SOURCE_DIR}" diff --quiet
git -C "${SOURCE_DIR}" diff --cached --quiet

RELEASES_DIR="${DEPRESS_ROOT}/releases"
RELEASE_DIR="${RELEASES_DIR}/${COMMIT_SHA}"
STAGING_DIR="${RELEASES_DIR}/.${COMMIT_SHA}.staging"
install -d -o root -g root -m 0755 "${DEPRESS_ROOT}" "${RELEASES_DIR}"
if [[ -e "${RELEASE_DIR}" || -e "${STAGING_DIR}" ]]; then
  echo "release already exists or has an incomplete staging directory" >&2
  exit 1
fi
install -d -o root -g root -m 0755 "${STAGING_DIR}"

cleanup() {
  if [[ -d "${STAGING_DIR}" ]]; then
    rm -rf --one-file-system "${STAGING_DIR}"
  fi
}
trap cleanup EXIT

rsync -a \
  --exclude=.git \
  --exclude=.env \
  --exclude=node_modules \
  --exclude='**/node_modules' \
  --exclude='**/.next' \
  --exclude='**/.turbo' \
  "${SOURCE_DIR}/" "${STAGING_DIR}/"
printf '%s\n' "${COMMIT_SHA}" > "${STAGING_DIR}/.depress-release"

(
  cd "${STAGING_DIR}"
  /usr/bin/corepack pnpm install --frozen-lockfile
  : "${DEPRESS_API_ORIGIN:?DEPRESS_API_ORIGIN is required for the Web build}"
  /usr/bin/corepack pnpm build
)

chown -R root:root "${STAGING_DIR}"
chmod -R go-w "${STAGING_DIR}"
mv "${STAGING_DIR}" "${RELEASE_DIR}"
trap - EXIT

if [[ -L "${DEPRESS_ROOT}/current" ]]; then
  PREVIOUS_TARGET=$(readlink -f "${DEPRESS_ROOT}/current")
  ln -sfn "${PREVIOUS_TARGET}" "${DEPRESS_ROOT}/previous.new"
  mv -Tf "${DEPRESS_ROOT}/previous.new" "${DEPRESS_ROOT}/previous"
fi
ln -sfn "${RELEASE_DIR}" "${DEPRESS_ROOT}/current.new"
mv -Tf "${DEPRESS_ROOT}/current.new" "${DEPRESS_ROOT}/current"

"${SYSTEMCTL_BIN}" daemon-reload
"${SYSTEMCTL_BIN}" restart depress-api depress-outbox depress-pointer-worker
echo "activated release ${COMMIT_SHA}"
