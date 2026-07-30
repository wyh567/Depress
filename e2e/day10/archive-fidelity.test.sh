#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
STAGING_TEST_ROOT=/mnt/d/depress-day10-wsl
install -d -m 0700 "$STAGING_TEST_ROOT"
SANDBOX=$(mktemp -d "${STAGING_TEST_ROOT}/archive-fidelity.XXXXXX")

cleanup() {
  if [[ -n ${SANDBOX:-} && -d ${SANDBOX} &&
    ${SANDBOX} == "${STAGING_TEST_ROOT}/archive-fidelity."* ]]; then
    rm -rf -- "${SANDBOX}"
  fi
}
trap cleanup EXIT

FIXTURE_REPO="${SANDBOX}/repo"
EXTRACTED="${SANDBOX}/extracted"
ARCHIVE="${SANDBOX}/candidate.tar"
mkdir -p "$FIXTURE_REPO" "$EXTRACTED"
declare -a CRITICAL_SHELL_FILES=(
  "deploy/release.sh"
  "deploy/migrate.sh"
  "deploy/verify-env-permissions.sh"
  "e2e/day10/run-staging.sh"
  "e2e/day10/provision-staging.sh"
)
for path in "${CRITICAL_SHELL_FILES[@]}"; do
  mkdir -p "${FIXTURE_REPO}/$(dirname "$path")"
  cp "${REPO_ROOT}/${path}" "${FIXTURE_REPO}/${path}"
done
printf '%s\n' \
  ".env" \
  "node_modules/" \
  ".next/" \
  ".turbo/" \
  > "${FIXTURE_REPO}/.gitignore"
git -C "$FIXTURE_REPO" init -q
git -C "$FIXTURE_REPO" config user.name "DePress archive fidelity test"
git -C "$FIXTURE_REPO" config user.email "archive-test@depress.invalid"
git -C "$FIXTURE_REPO" add .gitignore "${CRITICAL_SHELL_FILES[@]}"
git -C "$FIXTURE_REPO" commit -qm "archive fixture"
FIXTURE_SHA=$(git -C "$FIXTURE_REPO" rev-parse HEAD)
git -C "$FIXTURE_REPO" config core.autocrlf true

mkdir -p \
  "${FIXTURE_REPO}/node_modules/local" \
  "${FIXTURE_REPO}/.next" \
  "${FIXTURE_REPO}/.turbo"
printf '%s\n' "must-not-enter" > "${FIXTURE_REPO}/.env"
printf '%s\n' "ignored" > "${FIXTURE_REPO}/node_modules/local/file"
printf '%s\n' "ignored" > "${FIXTURE_REPO}/.next/file"
printf '%s\n' "ignored" > "${FIXTURE_REPO}/.turbo/file"

WINDOWS_REPO=$(wslpath -w "$FIXTURE_REPO")
WINDOWS_ARCHIVE=$(wslpath -w "$ARCHIVE")
cmd.exe /d /s /c \
  "git -C ${WINDOWS_REPO} -c core.autocrlf=false -c core.eol=lf archive --format=tar --output=${WINDOWS_ARCHIVE} ${FIXTURE_SHA}"
tar -xf "$ARCHIVE" -C "$EXTRACTED"

for path in "${CRITICAL_SHELL_FILES[@]}"; do
  BLOB_FILE="${SANDBOX}/blob-$RANDOM"
  git -C "$FIXTURE_REPO" cat-file blob \
    "${FIXTURE_SHA}:${path}" > "$BLOB_FILE"
  cmp -s "$BLOB_FILE" "${EXTRACTED}/${path}" || {
    echo "archive fidelity test failed: archive bytes differ from Git" >&2
    exit 1
  }
  bash -n "${EXTRACTED}/${path}"
  rm -f -- "$BLOB_FILE"
done
for forbidden in .git .env node_modules .next .turbo; do
  [[ ! -e "${EXTRACTED}/${forbidden}" ]] || {
    echo "archive fidelity test failed: forbidden path entered archive" >&2
    exit 1
  }
done

echo "PASS: Windows git archive matches Git blobs byte-for-byte"
echo "PASS: archived shell files parse on Linux"
echo "PASS: repository metadata, secrets, and build outputs are absent"
