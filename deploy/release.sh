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
COREPACK_BIN=${COREPACK_BIN:-/usr/bin/corepack}

if [[ ! ${COMMIT_SHA} =~ ^[0-9a-f]{40}$ ]]; then
  echo "commit SHA must be exactly 40 lowercase hexadecimal characters" >&2
  exit 2
fi
if [[ $(git -C "${SOURCE_DIR}" rev-parse --is-inside-work-tree 2>/dev/null) != "true" ]]; then
  echo "source directory must be a Git worktree" >&2
  exit 1
fi
REPOSITORY_ROOT=$(realpath "$(git -C "${SOURCE_DIR}" rev-parse --show-toplevel)")
if [[ "${REPOSITORY_ROOT}" != "${SOURCE_DIR}" ]]; then
  echo "source directory must be the Git worktree root" >&2
  exit 1
fi
if ! git -C "${SOURCE_DIR}" cat-file -e "${COMMIT_SHA}^{commit}" 2>/dev/null; then
  echo "commit SHA does not identify a local commit" >&2
  exit 1
fi
if [[ $(git -C "${SOURCE_DIR}" rev-parse HEAD) != "${COMMIT_SHA}" ]]; then
  echo "commit SHA must equal the source worktree HEAD" >&2
  exit 1
fi
if [[ -n $(git -C "${SOURCE_DIR}" status --porcelain=v1 --untracked-files=all) ]]; then
  echo "source worktree must have no staged, modified, or untracked files" >&2
  exit 1
fi

RELEASES_DIR="${DEPRESS_ROOT}/releases"
RELEASE_DIR="${RELEASES_DIR}/${COMMIT_SHA}"
STAGING_DIR="${RELEASES_DIR}/.${COMMIT_SHA}.staging"
CURRENT_LINK="${DEPRESS_ROOT}/current"
PREVIOUS_LINK="${DEPRESS_ROOT}/previous"
install -d -o root -g root -m 0755 "${DEPRESS_ROOT}" "${RELEASES_DIR}"
if [[ -e "${RELEASE_DIR}" || -e "${STAGING_DIR}" ]]; then
  echo "release already exists or has an incomplete staging directory" >&2
  exit 1
fi
if [[ (-e "${CURRENT_LINK}" || -L "${CURRENT_LINK}") && ! -L "${CURRENT_LINK}" ]]; then
  echo "current must be a symlink or absent" >&2
  exit 1
fi
if [[ (-e "${PREVIOUS_LINK}" || -L "${PREVIOUS_LINK}") && ! -L "${PREVIOUS_LINK}" ]]; then
  echo "previous must be a symlink or absent" >&2
  exit 1
fi
install -d -o root -g root -m 0755 "${STAGING_DIR}"
ARCHIVE_FILE=

cleanup() {
  if [[ -n "${ARCHIVE_FILE}" ]]; then
    rm -f -- "${ARCHIVE_FILE}"
  fi
  if [[ -d "${STAGING_DIR}" ]]; then
    rm -rf --one-file-system "${STAGING_DIR}"
  fi
}
trap cleanup EXIT
ARCHIVE_FILE=$(mktemp "${RELEASES_DIR}/.${COMMIT_SHA}.archive.XXXXXX")

git -C "${SOURCE_DIR}" archive \
  --format=tar \
  --output="${ARCHIVE_FILE}" \
  "${COMMIT_SHA}"
tar -xf "${ARCHIVE_FILE}" -C "${STAGING_DIR}"
rm -f -- "${ARCHIVE_FILE}"
printf '%s\n' "${COMMIT_SHA}" > "${STAGING_DIR}/.depress-release"

(
  cd "${STAGING_DIR}"
  "${COREPACK_BIN}" pnpm install --frozen-lockfile
  : "${DEPRESS_API_ORIGIN:?DEPRESS_API_ORIGIN is required for the Web build}"
  "${COREPACK_BIN}" pnpm build
)

chown -R root:root "${STAGING_DIR}"
chmod -R go-w "${STAGING_DIR}"
mv "${STAGING_DIR}" "${RELEASE_DIR}"
trap - EXIT

HAD_CURRENT=0
HAD_PREVIOUS=0
OLD_CURRENT_TARGET=
OLD_PREVIOUS_TARGET=
if [[ -L "${CURRENT_LINK}" ]]; then
  HAD_CURRENT=1
  OLD_CURRENT_TARGET=$(readlink -f "${CURRENT_LINK}")
fi
if [[ -L "${PREVIOUS_LINK}" ]]; then
  HAD_PREVIOUS=1
  OLD_PREVIOUS_TARGET=$(readlink -f "${PREVIOUS_LINK}")
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

restore_activation() {
  restore_link "${CURRENT_LINK}" "${HAD_CURRENT}" "${OLD_CURRENT_TARGET}"
  restore_link "${PREVIOUS_LINK}" "${HAD_PREVIOUS}" "${OLD_PREVIOUS_TARGET}"
  rm -f -- "${CURRENT_LINK}.new" "${PREVIOUS_LINK}.new"
}

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}.new"
if [[ "${HAD_CURRENT}" == "1" ]]; then
  ln -sfn "${OLD_CURRENT_TARGET}" "${PREVIOUS_LINK}.new"
fi

if ! {
  if [[ "${HAD_CURRENT}" == "1" ]]; then
    mv -Tf "${PREVIOUS_LINK}.new" "${PREVIOUS_LINK}"
  fi
  mv -Tf "${CURRENT_LINK}.new" "${CURRENT_LINK}"
}; then
  restore_activation
  echo "release activation failed; current and previous were restored" >&2
  exit 1
fi

if ! "${SYSTEMCTL_BIN}" daemon-reload ||
  ! "${SYSTEMCTL_BIN}" restart depress-api depress-outbox depress-pointer-worker; then
  restore_activation
  if [[ "${HAD_CURRENT}" == "1" ]]; then
    "${SYSTEMCTL_BIN}" daemon-reload || true
    "${SYSTEMCTL_BIN}" restart depress-api depress-outbox depress-pointer-worker || true
  fi
  echo "service action failed; current and previous were restored" >&2
  exit 1
fi
echo "activated release ${COMMIT_SHA}"
