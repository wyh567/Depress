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
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPRESS_ROOT=${DEPRESS_ROOT:-/opt/depress}
DEPRESS_RELEASE_GROUP=${DEPRESS_RELEASE_GROUP:-depress-release}
SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-systemctl}
COREPACK_BIN=${COREPACK_BIN:-/usr/bin/corepack}
HEALTH_CHECK_BIN=${HEALTH_CHECK_BIN:-${SOURCE_DIR:-}/deploy/health-check.sh}
RELEASE_PERMISSIONS_BIN=${RELEASE_PERMISSIONS_BIN:-${SCRIPT_DIR}/release-permissions.sh}
readonly -a SERVICE_UNITS=(
  depress-api
  depress-outbox
  depress-pointer-worker
  depress-web
)

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
getent group "${DEPRESS_RELEASE_GROUP}" >/dev/null 2>&1 || {
  echo "missing release group ${DEPRESS_RELEASE_GROUP}" >&2
  exit 1
}
[[ -f "${RELEASE_PERMISSIONS_BIN}" && ! -L "${RELEASE_PERMISSIONS_BIN}" ]] || {
  echo "release permission helper is missing or a symlink" >&2
  exit 1
}
install -d -o root -g "${DEPRESS_RELEASE_GROUP}" -m 0750 \
  "${DEPRESS_ROOT}" "${RELEASES_DIR}"
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
install -d -o root -g "${DEPRESS_RELEASE_GROUP}" -m 0750 "${STAGING_DIR}"
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

git -C "${SOURCE_DIR}" \
  -c core.autocrlf=false \
  -c core.eol=lf \
  archive \
  --format=tar \
  --output="${ARCHIVE_FILE}" \
  "${COMMIT_SHA}"
tar -xf "${ARCHIVE_FILE}" -C "${STAGING_DIR}"
rm -f -- "${ARCHIVE_FILE}"
printf '%s\n' "${COMMIT_SHA}" > "${STAGING_DIR}/.depress-release"

(
  cd "${STAGING_DIR}"
  "${COREPACK_BIN}" pnpm install --frozen-lockfile \
    --package-import-method=copy
  : "${DEPRESS_API_ORIGIN:?DEPRESS_API_ORIGIN is required for the Web build}"
  "${COREPACK_BIN}" pnpm build
)

DEPRESS_ROOT="${DEPRESS_ROOT}" \
DEPRESS_RELEASE_GROUP="${DEPRESS_RELEASE_GROUP}" \
  bash "${RELEASE_PERMISSIONS_BIN}" normalize "${STAGING_DIR}"
mv "${STAGING_DIR}" "${RELEASE_DIR}"
trap - EXIT
DEPRESS_ROOT="${DEPRESS_ROOT}" \
DEPRESS_RELEASE_GROUP="${DEPRESS_RELEASE_GROUP}" \
  bash "${RELEASE_PERMISSIONS_BIN}" verify "${RELEASE_DIR}"

HAD_CURRENT=0
HAD_PREVIOUS=0
OLD_CURRENT_TARGET=
OLD_PREVIOUS_TARGET=
assert_release_target() {
  local target=$1
  local releases_real resolved

  releases_real=$(realpath -e -- "${RELEASES_DIR}")
  resolved=$(realpath -e -- "$target") || return 1
  [[ -d "$resolved" && "$(dirname -- "$resolved")" == "$releases_real" ]]
}
if [[ -L "${CURRENT_LINK}" ]]; then
  HAD_CURRENT=1
  OLD_CURRENT_TARGET=$(readlink -f "${CURRENT_LINK}")
  assert_release_target "${OLD_CURRENT_TARGET}" || {
    echo "current target escapes the releases directory" >&2
    exit 1
  }
fi
if [[ -L "${PREVIOUS_LINK}" ]]; then
  HAD_PREVIOUS=1
  OLD_PREVIOUS_TARGET=$(readlink -f "${PREVIOUS_LINK}")
  assert_release_target "${OLD_PREVIOUS_TARGET}" || {
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

restore_activation() {
  restore_link "${CURRENT_LINK}" "${HAD_CURRENT}" "${OLD_CURRENT_TARGET}"
  restore_link "${PREVIOUS_LINK}" "${HAD_PREVIOUS}" "${OLD_PREVIOUS_TARGET}"
  rm -f -- "${CURRENT_LINK}.new" "${PREVIOUS_LINK}.new"
}

restart_all_services() {
  local unit
  for unit in "${SERVICE_UNITS[@]}"; do
    "${SYSTEMCTL_BIN}" restart "${unit}"
  done
}

run_release_health_check() {
  [[ -x "${HEALTH_CHECK_BIN}" ]] || {
    echo "health check is missing or not executable: ${HEALTH_CHECK_BIN}" >&2
    return 1
  }

  # Bounded readiness retry: the restarted services are Type=simple, so
  # `systemctl restart` returning does not prove the application is
  # actually listening yet (observed: Next.js took ~1.4s to report
  # "Ready" after restart). A single immediate health check races that
  # startup window and can trigger an unnecessary rollback on a release
  # that is, in fact, healthy a moment later. Retry a bounded, small,
  # deterministic number of times with a fixed interval; the same
  # health-check.sh remains the sole authority on "healthy" — this loop
  # only decides how long to keep asking it before giving up.
  #
  # Production observation: a Type=simple restart returning does not mean
  # the listener is ready. The API's normal cold start is ~12-14s. The
  # default below gives that cold start a bounded startup margin while
  # still failing (and rolling back) a persistently broken release in
  # well under a minute. Both values remain overridable via
  # HEALTH_CHECK_MAX_ATTEMPTS / HEALTH_CHECK_RETRY_INTERVAL_SECONDS.
  local max_attempts=${HEALTH_CHECK_MAX_ATTEMPTS:-30}
  local retry_interval=${HEALTH_CHECK_RETRY_INTERVAL_SECONDS:-1}
  local attempt=1
  while true; do
    if "${HEALTH_CHECK_BIN}"; then
      if [[ "${attempt}" -gt 1 ]]; then
        echo "release health check succeeded on attempt ${attempt}/${max_attempts}" >&2
      fi
      return 0
    fi
    if [[ "${attempt}" -ge "${max_attempts}" ]]; then
      echo "release health check failed after ${attempt}/${max_attempts} attempts" >&2
      return 1
    fi
    echo "release health check attempt ${attempt}/${max_attempts} failed; retrying in ${retry_interval}s" >&2
    sleep "${retry_interval}"
    attempt=$((attempt + 1))
  done
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
  ! restart_all_services ||
  ! run_release_health_check; then
  restore_activation
  if [[ "${HAD_CURRENT}" == "1" ]]; then
    "${SYSTEMCTL_BIN}" daemon-reload || true
    restart_all_services || true
  fi
  echo "service action failed; current and previous were restored" >&2
  exit 1
fi
echo "activated release ${COMMIT_SHA}"
