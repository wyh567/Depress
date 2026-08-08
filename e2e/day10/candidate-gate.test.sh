#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/candidate-gate.sh"

SANDBOX=$(mktemp -d)
cleanup() {
  if [[ -n ${SANDBOX:-} && -d ${SANDBOX} && ${SANDBOX} == /tmp/* ]]; then
    rm -rf -- "${SANDBOX}"
  fi
}
trap cleanup EXIT

fail() {
  echo "candidate gate test failed: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

write_lines() {
  local target=$1
  shift
  printf '%s\n' "$@" > "$target"
}

expect_rejection() {
  local label=$1
  if validate_changed_files_manifest \
    "${SANDBOX}/approved.txt" "${SANDBOX}/actual.txt" \
    >"${SANDBOX}/rejected.log" 2>&1; then
    fail "$label"
  fi
  pass "$label"
}

write_lines "${SANDBOX}/actual.txt" \
  "deploy/README.md" \
  "deploy/release.sh"
cp "${SANDBOX}/actual.txt" "${SANDBOX}/approved.txt"
validate_changed_files_manifest \
  "${SANDBOX}/approved.txt" "${SANDBOX}/actual.txt" >/dev/null
pass "an exact approved manifest is accepted"

write_lines "${SANDBOX}/approved.txt" "deploy/README.md"
expect_rejection "a manifest missing a changed file is rejected"

write_lines "${SANDBOX}/approved.txt" \
  "deploy/README.md" \
  "deploy/release.sh" \
  "deploy/verify-env-permissions.sh"
expect_rejection "a manifest with an extra file is rejected"

write_lines "${SANDBOX}/approved.txt" \
  "deploy/README.md" \
  "deploy/README.md"
expect_rejection "duplicate manifest paths are rejected"

write_lines "${SANDBOX}/approved.txt" \
  "/etc/depress/api.env" \
  "deploy/release.sh"
expect_rejection "absolute manifest paths are rejected"

write_lines "${SANDBOX}/approved.txt" \
  "../outside" \
  "deploy/release.sh"
expect_rejection "parent traversal is rejected"

write_lines "${SANDBOX}/approved.txt" \
  "deploy\\README.md" \
  "deploy/release.sh"
expect_rejection "backslash paths are rejected"

: > "${SANDBOX}/actual.txt"
cp "${SANDBOX}/actual.txt" "${SANDBOX}/approved.txt"
expect_rejection "an empty candidate diff is rejected"

write_lines "${SANDBOX}/actual.txt" ".env"
cp "${SANDBOX}/actual.txt" "${SANDBOX}/approved.txt"
expect_rejection "a tracked .env candidate path is rejected"

write_lines "${SANDBOX}/actual.txt" \
  ".env.example" \
  "deploy/env.production.example"
cp "${SANDBOX}/actual.txt" "${SANDBOX}/approved.txt"
validate_changed_files_manifest \
  "${SANDBOX}/approved.txt" "${SANDBOX}/actual.txt" >/dev/null
pass "approved environment examples are not mistaken for secrets"

REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
CURRENT_PARENT=87473f231d360e1a93e9dd295b1cd6fb2be1ddb9
CURRENT_HEAD=99e45fe8e0abf9d115e60ac32539efe8efd9ad6b
git -C "$REPO_ROOT" diff --name-only "$CURRENT_PARENT" "$CURRENT_HEAD" |
  LC_ALL=C sort > "${SANDBOX}/actual.txt"
cp "${SANDBOX}/actual.txt" "${SANDBOX}/approved.txt"
validate_changed_files_manifest \
  "${SANDBOX}/approved.txt" "${SANDBOX}/actual.txt" >/dev/null
[[ "$(awk 'END { print NR + 0 }' "${SANDBOX}/actual.txt")" == "12" ]] ||
  fail "current production hardening fixture is not the expected multi-file candidate"
pass "the current multi-file production hardening candidate is accepted"

write_lines "${SANDBOX}/actual.txt" \
  "docs/a.md" \
  "docs/b.md" \
  "docs/c.md"
cp "${SANDBOX}/actual.txt" "${SANDBOX}/approved.txt"
validate_changed_files_manifest \
  "${SANDBOX}/approved.txt" "${SANDBOX}/actual.txt" >/dev/null
pass "a three-Markdown candidate remains valid when externally approved"

echo "all candidate gate tests passed"
