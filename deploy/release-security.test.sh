#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "release-security.test.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly RELEASE_SCRIPT="${SCRIPT_DIR}/release.sh"
SANDBOX=$(mktemp -d)

cleanup() {
  if [[ -n ${SANDBOX:-} && -d ${SANDBOX} && ${SANDBOX} == /tmp/* ]]; then
    rm -rf -- "${SANDBOX}"
  fi
}
trap cleanup EXIT

FAKE_COREPACK="${SANDBOX}/corepack"
FAKE_SYSTEMCTL="${SANDBOX}/systemctl"
FAKE_FAIL_SYSTEMCTL="${SANDBOX}/systemctl-fail"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${FAKE_COREPACK}"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${FAKE_SYSTEMCTL}"
printf '%s\n' '#!/usr/bin/env bash' 'exit 23' > "${FAKE_FAIL_SYSTEMCTL}"
chmod 0755 "${FAKE_COREPACK}" "${FAKE_SYSTEMCTL}" "${FAKE_FAIL_SYSTEMCTL}"

CASE_REPO=
CASE_ROOT=
CASE_SHA=
CASE_SYSTEMCTL=

fail() {
  echo "release security test failed: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

new_case() {
  local name=$1

  CASE_REPO="${SANDBOX}/${name}-repo"
  CASE_ROOT="${SANDBOX}/${name}-root"
  mkdir -p "${CASE_REPO}"
  git -C "${CASE_REPO}" init -q
  git -C "${CASE_REPO}" config user.name "DePress release test"
  git -C "${CASE_REPO}" config user.email "release-test@depress.invalid"
  printf '%s\n' "committed-${name}" > "${CASE_REPO}/tracked.txt"
  printf '%s\n' \
    ".env" \
    "node_modules/" \
    ".next/" \
    ".turbo/" \
    > "${CASE_REPO}/.gitignore"
  git -C "${CASE_REPO}" add .gitignore tracked.txt
  git -C "${CASE_REPO}" commit -qm "test fixture"
  CASE_SHA=$(git -C "${CASE_REPO}" rev-parse HEAD)
  CASE_SYSTEMCTL="${FAKE_SYSTEMCTL}"
}

run_release() {
  local sha=${1:-${CASE_SHA}}

  DEPRESS_ROOT="${CASE_ROOT}" \
    SYSTEMCTL_BIN="${CASE_SYSTEMCTL}" \
    COREPACK_BIN="${FAKE_COREPACK}" \
    DEPRESS_API_ORIGIN=http://127.0.0.1:3001 \
    bash "${RELEASE_SCRIPT}" "${CASE_REPO}" "${sha}"
}

expect_rejection() {
  local name=$1
  local sha=${2:-${CASE_SHA}}

  if run_release "${sha}" >"${SANDBOX}/${name}.log" 2>&1; then
    fail "${name} was accepted"
  fi
  pass "${name}"
}

new_case clean
run_release >/dev/null
[[ -f "${CASE_ROOT}/releases/${CASE_SHA}/tracked.txt" ]] ||
  fail "clean release omitted committed content"
[[ $(cat "${CASE_ROOT}/releases/${CASE_SHA}/.depress-release") == "${CASE_SHA}" ]] ||
  fail "clean release marker is incorrect"
pass "clean exact SHA releases"

new_case tracked-modified
printf '%s\n' "dirty" >> "${CASE_REPO}/tracked.txt"
expect_rejection "tracked modifications are rejected"

new_case staged
printf '%s\n' "staged" > "${CASE_REPO}/staged.txt"
git -C "${CASE_REPO}" add staged.txt
expect_rejection "staged changes are rejected"

new_case untracked
printf '%s\n' "untracked" > "${CASE_REPO}/untracked.txt"
expect_rejection "untracked files are rejected"

new_case ignored
mkdir -p \
  "${CASE_REPO}/node_modules/local" \
  "${CASE_REPO}/.next" \
  "${CASE_REPO}/.turbo"
printf '%s\n' "placeholder-only" > "${CASE_REPO}/.env"
printf '%s\n' "ignored" > "${CASE_REPO}/node_modules/local/file"
printf '%s\n' "ignored" > "${CASE_REPO}/.next/file"
printf '%s\n' "ignored" > "${CASE_REPO}/.turbo/file"
run_release >/dev/null
for forbidden in .env node_modules .next .turbo; do
  [[ ! -e "${CASE_ROOT}/releases/${CASE_SHA}/${forbidden}" ]] ||
    fail "ignored ${forbidden} entered the release"
done
pass "ignored environment and build outputs cannot enter archive"

new_case archive-fidelity
declare -a CRITICAL_SHELL_FILES=(
  "deploy/release.sh"
  "deploy/migrate.sh"
  "deploy/verify-env-permissions.sh"
  "e2e/day10/run-staging.sh"
  "e2e/day10/provision-staging.sh"
)
SOURCE_REPO=$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel)
for critical_path in "${CRITICAL_SHELL_FILES[@]}"; do
  mkdir -p "${CASE_REPO}/$(dirname "${critical_path}")"
  cp "${SOURCE_REPO}/${critical_path}" "${CASE_REPO}/${critical_path}"
done
git -C "${CASE_REPO}" add "${CRITICAL_SHELL_FILES[@]}"
git -C "${CASE_REPO}" commit -qm "archive fidelity fixture"
CASE_SHA=$(git -C "${CASE_REPO}" rev-parse HEAD)
git -C "${CASE_REPO}" config core.autocrlf true
mkdir -p \
  "${CASE_REPO}/node_modules/local" \
  "${CASE_REPO}/.next" \
  "${CASE_REPO}/.turbo"
printf '%s\n' "must-not-enter" > "${CASE_REPO}/.env"
printf '%s\n' "ignored" > "${CASE_REPO}/node_modules/local/file"
printf '%s\n' "ignored" > "${CASE_REPO}/.next/file"
printf '%s\n' "ignored" > "${CASE_REPO}/.turbo/file"
run_release >/dev/null
for critical_path in "${CRITICAL_SHELL_FILES[@]}"; do
  blob_file="${SANDBOX}/blob-$RANDOM"
  git -C "${CASE_REPO}" cat-file blob \
    "${CASE_SHA}:${critical_path}" > "$blob_file"
  cmp -s \
    "$blob_file" \
    "${CASE_ROOT}/releases/${CASE_SHA}/${critical_path}" ||
    fail "archive bytes differ from Git for a critical shell file"
  bash -n "${CASE_ROOT}/releases/${CASE_SHA}/${critical_path}"
  rm -f -- "$blob_file"
done
for forbidden in .git .env node_modules .next .turbo; do
  [[ ! -e "${CASE_ROOT}/releases/${CASE_SHA}/${forbidden}" ]] ||
    fail "forbidden ${forbidden} entered the byte-fidelity release"
done
pass "Git blobs and release archive shell files are byte-for-byte identical"

new_case head-mismatch
FIRST_SHA=${CASE_SHA}
printf '%s\n' "second commit" > "${CASE_REPO}/second.txt"
git -C "${CASE_REPO}" add second.txt
git -C "${CASE_REPO}" commit -qm "second fixture"
CASE_SHA=$(git -C "${CASE_REPO}" rev-parse HEAD)
expect_rejection "SHA different from HEAD is rejected" "${FIRST_SHA}"

new_case invalid-sha
expect_rejection "short SHA is rejected" "${CASE_SHA:0:12}"
expect_rejection "non-hex SHA is rejected" "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"

new_case conflict
mkdir -p "${CASE_ROOT}/releases/${CASE_SHA}"
printf '%s\n' "different content" > "${CASE_ROOT}/releases/${CASE_SHA}/conflict"
expect_rejection "conflicting release directory is rejected"
[[ -f "${CASE_ROOT}/releases/${CASE_SHA}/conflict" ]] ||
  fail "conflicting release content was modified"

new_case atomic
OLD_RELEASE="${CASE_ROOT}/releases/old"
mkdir -p "${OLD_RELEASE}"
ln -s "${OLD_RELEASE}" "${CASE_ROOT}/current"
run_release >/dev/null
[[ $(readlink -f "${CASE_ROOT}/current") == "${CASE_ROOT}/releases/${CASE_SHA}" ]] ||
  fail "current did not switch to the new release"
[[ $(readlink -f "${CASE_ROOT}/previous") == "${OLD_RELEASE}" ]] ||
  fail "previous did not retain the former current release"
pass "current symlink switches atomically and previous is retained"

new_case preserve-links
CURRENT_RELEASE="${CASE_ROOT}/releases/current-old"
PREVIOUS_RELEASE="${CASE_ROOT}/releases/previous-old"
mkdir -p "${CURRENT_RELEASE}" "${PREVIOUS_RELEASE}"
ln -s "${CURRENT_RELEASE}" "${CASE_ROOT}/current"
ln -s "${PREVIOUS_RELEASE}" "${CASE_ROOT}/previous"
printf '%s\n' "dirty" >> "${CASE_REPO}/tracked.txt"
expect_rejection "failed release preserves existing links"
[[ $(readlink -f "${CASE_ROOT}/current") == "${CURRENT_RELEASE}" ]] ||
  fail "failed release changed current"
[[ $(readlink -f "${CASE_ROOT}/previous") == "${PREVIOUS_RELEASE}" ]] ||
  fail "failed release changed previous"

new_case service-failure
CURRENT_RELEASE="${CASE_ROOT}/releases/current-old"
PREVIOUS_RELEASE="${CASE_ROOT}/releases/previous-old"
mkdir -p "${CURRENT_RELEASE}" "${PREVIOUS_RELEASE}"
ln -s "${CURRENT_RELEASE}" "${CASE_ROOT}/current"
ln -s "${PREVIOUS_RELEASE}" "${CASE_ROOT}/previous"
CASE_SYSTEMCTL="${FAKE_FAIL_SYSTEMCTL}"
expect_rejection "service action failure restores existing links"
[[ $(readlink -f "${CASE_ROOT}/current") == "${CURRENT_RELEASE}" ]] ||
  fail "service failure did not restore current"
[[ $(readlink -f "${CASE_ROOT}/previous") == "${PREVIOUS_RELEASE}" ]] ||
  fail "service failure did not restore previous"

echo "all release security tests passed"
