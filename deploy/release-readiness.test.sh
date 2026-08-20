#!/usr/bin/env bash
set -euo pipefail

# T-06E: verifies deploy/release.sh's bounded readiness retry around the
# health check — not the permission/archive behavior release-security.test.sh
# already covers. Needs real users/groups (release-permissions.sh normalize
# and verify chown to them) so, like release-security.test.sh, this requires
# root and is not portable to the Windows development machine; it is a
# standalone script, not wired into CI.

if [[ ${EUID} -ne 0 ]]; then
  echo "release-readiness.test.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly RELEASE_SCRIPT="${SCRIPT_DIR}/release.sh"
SANDBOX=$(mktemp -d)
chmod 0711 "$SANDBOX"
readonly SUFFIX="${BASHPID}"
readonly RELEASE_GROUP="dprr${SUFFIX}"
readonly -a TEST_USERS=("rrw${SUFFIX}" "rra${SUFFIX}" "rro${SUFFIX}" "rrj${SUFFIX}" "rrm${SUFFIX}" "rrc${SUFFIX}")
readonly -a TEST_GROUPS=("rgrw${SUFFIX}" "rgra${SUFFIX}" "rgro${SUFFIX}" "rgrj${SUFFIX}" "rgrm${SUFFIX}" "rgrc${SUFFIX}")
created_users=()
created_groups=()

cleanup() {
  local user group
  for user in "${created_users[@]}"; do
    userdel "$user" 2>/dev/null || true
  done
  for group in "${created_groups[@]}"; do
    groupdel "$group" 2>/dev/null || true
  done
  if [[ -n ${SANDBOX:-} && -d ${SANDBOX} && ${SANDBOX} == /tmp/* ]]; then
    rm -rf -- "${SANDBOX}"
  fi
}
trap cleanup EXIT

FAKE_COREPACK="${SANDBOX}/corepack"
FAKE_SYSTEMCTL="${SANDBOX}/systemctl"
FAKE_HEALTH="${SANDBOX}/health-check"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${FAKE_COREPACK}"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${FAKE_SYSTEMCTL}"

# Configurable fake health check: fails on the first
# HEALTH_FAIL_COUNT attempts (read from a file, so each release run can
# reconfigure it), then succeeds. Every invocation appends to
# HEALTH_ATTEMPT_LOG so tests can assert exactly how many times it ran.
cat > "${FAKE_HEALTH}" <<'HEALTH'
#!/usr/bin/env bash
set -euo pipefail
: "${HEALTH_ATTEMPT_LOG:?}"
: "${HEALTH_FAIL_COUNT_FILE:?}"
echo x >> "${HEALTH_ATTEMPT_LOG}"
attempt=$(wc -l < "${HEALTH_ATTEMPT_LOG}")
fail_count=$(cat "${HEALTH_FAIL_COUNT_FILE}")
if (( attempt <= fail_count )); then
  echo "fake health check attempt ${attempt} failing (configured to fail ${fail_count} times)" >&2
  exit 1
fi
exit 0
HEALTH
chmod 0755 "${FAKE_COREPACK}" "${FAKE_SYSTEMCTL}" "${FAKE_HEALTH}"

groupadd --system "$RELEASE_GROUP"
created_groups+=("$RELEASE_GROUP")
for group in "${TEST_GROUPS[@]}"; do
  groupadd --system "$group"
  created_groups=("$group" "${created_groups[@]}")
done
for index in "${!TEST_USERS[@]}"; do
  useradd --system --no-create-home --shell /usr/sbin/nologin \
    --gid "${TEST_GROUPS[$index]}" "${TEST_USERS[$index]}"
  created_users=("${TEST_USERS[$index]}" "${created_users[@]}")
  usermod -aG "$RELEASE_GROUP" "${TEST_USERS[$index]}"
done

fail() {
  echo "release readiness test failed: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

CASE_REPO=
CASE_ROOT=
CASE_SHA=
HEALTH_ATTEMPT_LOG=
HEALTH_FAIL_COUNT_FILE=

new_case() {
  local name=$1

  CASE_REPO="${SANDBOX}/${name}-repo"
  CASE_ROOT="${SANDBOX}/${name}-root"
  mkdir -p "${CASE_REPO}"
  git -C "${CASE_REPO}" init -q
  git -C "${CASE_REPO}" config user.name "DePress release readiness test"
  git -C "${CASE_REPO}" config user.email "release-readiness-test@depress.invalid"
  printf '%s\n' "committed-${name}" > "${CASE_REPO}/tracked.txt"
  printf '%s\n' ".env" "node_modules/" ".next/" ".turbo/" > "${CASE_REPO}/.gitignore"
  git -C "${CASE_REPO}" add .gitignore tracked.txt
  git -C "${CASE_REPO}" commit -qm "test fixture"
  CASE_SHA=$(git -C "${CASE_REPO}" rev-parse HEAD)

  HEALTH_ATTEMPT_LOG="${SANDBOX}/${name}-health-attempts.log"
  HEALTH_FAIL_COUNT_FILE="${SANDBOX}/${name}-health-fail-count"
  : > "${HEALTH_ATTEMPT_LOG}"
}

attempt_count() {
  wc -l < "${HEALTH_ATTEMPT_LOG}" | tr -d ' '
}

run_release() {
  local max_attempts=$1
  local retry_interval=$2

  DEPRESS_ROOT="${CASE_ROOT}" \
    DEPRESS_RELEASE_GROUP="$RELEASE_GROUP" \
    DEPRESS_WEB_USER="${TEST_USERS[0]}" DEPRESS_WEB_GROUP="${TEST_GROUPS[0]}" \
    DEPRESS_API_USER="${TEST_USERS[1]}" DEPRESS_API_GROUP="${TEST_GROUPS[1]}" \
    DEPRESS_OUTBOX_USER="${TEST_USERS[2]}" DEPRESS_OUTBOX_GROUP="${TEST_GROUPS[2]}" \
    DEPRESS_WORKER_USER="${TEST_USERS[3]}" DEPRESS_WORKER_GROUP="${TEST_GROUPS[3]}" \
    DEPRESS_MIGRATION_USER="${TEST_USERS[4]}" DEPRESS_MIGRATION_GROUP="${TEST_GROUPS[4]}" \
    DEPRESS_CLEANUP_USER="${TEST_USERS[5]}" DEPRESS_CLEANUP_GROUP="${TEST_GROUPS[5]}" \
    SYSTEMCTL_BIN="${FAKE_SYSTEMCTL}" \
    COREPACK_BIN="${FAKE_COREPACK}" \
    HEALTH_CHECK_BIN="${FAKE_HEALTH}" \
    HEALTH_ATTEMPT_LOG="${HEALTH_ATTEMPT_LOG}" \
    HEALTH_FAIL_COUNT_FILE="${HEALTH_FAIL_COUNT_FILE}" \
    HEALTH_CHECK_MAX_ATTEMPTS="${max_attempts}" \
    HEALTH_CHECK_RETRY_INTERVAL_SECONDS="${retry_interval}" \
    DEPRESS_API_ORIGIN=http://127.0.0.1:3001 \
    bash "${RELEASE_SCRIPT}" "${CASE_REPO}" "${CASE_SHA}"
}

run_release_with_default_max() {
  local retry_interval=$1

  DEPRESS_ROOT="${CASE_ROOT}" \
    DEPRESS_RELEASE_GROUP="$RELEASE_GROUP" \
    DEPRESS_WEB_USER="${TEST_USERS[0]}" DEPRESS_WEB_GROUP="${TEST_GROUPS[0]}" \
    DEPRESS_API_USER="${TEST_USERS[1]}" DEPRESS_API_GROUP="${TEST_GROUPS[1]}" \
    DEPRESS_OUTBOX_USER="${TEST_USERS[2]}" DEPRESS_OUTBOX_GROUP="${TEST_GROUPS[2]}" \
    DEPRESS_WORKER_USER="${TEST_USERS[3]}" DEPRESS_WORKER_GROUP="${TEST_GROUPS[3]}" \
    DEPRESS_MIGRATION_USER="${TEST_USERS[4]}" DEPRESS_MIGRATION_GROUP="${TEST_GROUPS[4]}" \
    DEPRESS_CLEANUP_USER="${TEST_USERS[5]}" DEPRESS_CLEANUP_GROUP="${TEST_GROUPS[5]}" \
    SYSTEMCTL_BIN="${FAKE_SYSTEMCTL}" \
    COREPACK_BIN="${FAKE_COREPACK}" \
    HEALTH_CHECK_BIN="${FAKE_HEALTH}" \
    HEALTH_ATTEMPT_LOG="${HEALTH_ATTEMPT_LOG}" \
    HEALTH_FAIL_COUNT_FILE="${HEALTH_FAIL_COUNT_FILE}" \
    HEALTH_CHECK_RETRY_INTERVAL_SECONDS="${retry_interval}" \
    DEPRESS_API_ORIGIN=http://127.0.0.1:3001 \
    bash "${RELEASE_SCRIPT}" "${CASE_REPO}" "${CASE_SHA}"
}

# ---- D: immediate success — no unnecessary retry/sleep ----
new_case immediate-success
printf '%s' 0 > "${HEALTH_FAIL_COUNT_FILE}"
run_release 10 0.05 >"${SANDBOX}/immediate-success.log" 2>&1 ||
  fail "immediate success was rejected: $(cat "${SANDBOX}/immediate-success.log")"
[[ "$(attempt_count)" == "1" ]] ||
  fail "immediate success made $(attempt_count) health check attempts, expected exactly 1"
pass "immediate health-check success requires exactly one attempt, no retry"

# ---- B: transient failure then success — release succeeds, no rollback ----
new_case transient-failure
printf '%s' 2 > "${HEALTH_FAIL_COUNT_FILE}"
run_release 10 0.05 >"${SANDBOX}/transient-failure.log" 2>&1 ||
  fail "transient failure then success was rejected: $(cat "${SANDBOX}/transient-failure.log")"
[[ "$(attempt_count)" == "3" ]] ||
  fail "transient failure case made $(attempt_count) health check attempts, expected exactly 3"
[[ $(readlink -f "${CASE_ROOT}/current") == "${CASE_ROOT}/releases/${CASE_SHA}" ]] ||
  fail "transient failure case did not activate the new release after eventual success"
grep -q "attempt 1/10 failed; retrying" "${SANDBOX}/transient-failure.log" ||
  fail "transient failure case did not log a retry"
grep -q "succeeded on attempt 3/10" "${SANDBOX}/transient-failure.log" ||
  fail "transient failure case did not log the eventual success attempt number"
pass "transient health-check failures (2) followed by success (3rd attempt) activate the release with no rollback"

# ---- C: persistent failure — bounded retries, then rollback ----
new_case persistent-failure
printf '%s' 999 > "${HEALTH_FAIL_COUNT_FILE}"
CURRENT_RELEASE="${CASE_ROOT}/releases/current-old"
PREVIOUS_RELEASE="${CASE_ROOT}/releases/previous-old"
mkdir -p "${CASE_ROOT}" "${CURRENT_RELEASE}" "${PREVIOUS_RELEASE}"
ln -s "${CURRENT_RELEASE}" "${CASE_ROOT}/current"
ln -s "${PREVIOUS_RELEASE}" "${CASE_ROOT}/previous"
if run_release 3 0.05 >"${SANDBOX}/persistent-failure.log" 2>&1; then
  fail "persistent failure was accepted"
fi
[[ "$(attempt_count)" == "3" ]] ||
  fail "persistent failure case made $(attempt_count) health check attempts, expected exactly 3 (the configured maximum)"
[[ $(readlink -f "${CASE_ROOT}/current") == "${CURRENT_RELEASE}" ]] ||
  fail "persistent failure case did not restore current"
[[ $(readlink -f "${CASE_ROOT}/previous") == "${PREVIOUS_RELEASE}" ]] ||
  fail "persistent failure case did not restore previous"
grep -q "failed after 3/3 attempts" "${SANDBOX}/persistent-failure.log" ||
  fail "persistent failure case did not log the final bounded-retry failure"
pass "persistent health-check failure retries exactly up to the configured maximum, then rolls back current/previous"

# ---- E: default budget accommodates a slow-starting API (13th attempt) ----
new_case default-budget-eventual-success
printf '%s' 12 > "${HEALTH_FAIL_COUNT_FILE}"
run_release_with_default_max 0.01 >"${SANDBOX}/default-budget-eventual-success.log" 2>&1 ||
  fail "default-budget eventual success was rejected: $(cat "${SANDBOX}/default-budget-eventual-success.log")"
[[ "$(attempt_count)" == "13" ]] ||
  fail "default-budget eventual success case made $(attempt_count) health check attempts, expected exactly 13"
[[ $(readlink -f "${CASE_ROOT}/current") == "${CASE_ROOT}/releases/${CASE_SHA}" ]] ||
  fail "default-budget eventual success case did not activate the new release after eventual success"
grep -q "succeeded on attempt 13/30" "${SANDBOX}/default-budget-eventual-success.log" ||
  fail "default-budget eventual success case did not log the eventual success attempt number against the default max"
pass "default HEALTH_CHECK_MAX_ATTEMPTS (unset, falls back to 30) tolerates 12 failures before a 13th-attempt success, activating the release with no rollback"

# ---- F: default budget is still bounded — persistent failure rolls back at attempt 30 ----
new_case default-budget-persistent-failure
printf '%s' 999 > "${HEALTH_FAIL_COUNT_FILE}"
CURRENT_RELEASE="${CASE_ROOT}/releases/current-old"
PREVIOUS_RELEASE="${CASE_ROOT}/releases/previous-old"
mkdir -p "${CASE_ROOT}" "${CURRENT_RELEASE}" "${PREVIOUS_RELEASE}"
ln -s "${CURRENT_RELEASE}" "${CASE_ROOT}/current"
ln -s "${PREVIOUS_RELEASE}" "${CASE_ROOT}/previous"
if run_release_with_default_max 0.01 >"${SANDBOX}/default-budget-persistent-failure.log" 2>&1; then
  fail "default-budget persistent failure was accepted"
fi
[[ "$(attempt_count)" == "30" ]] ||
  fail "default-budget persistent failure case made $(attempt_count) health check attempts, expected exactly 30 (the default maximum)"
[[ $(readlink -f "${CASE_ROOT}/current") == "${CURRENT_RELEASE}" ]] ||
  fail "default-budget persistent failure case did not restore current"
[[ $(readlink -f "${CASE_ROOT}/previous") == "${PREVIOUS_RELEASE}" ]] ||
  fail "default-budget persistent failure case did not restore previous"
grep -q "failed after 30/30 attempts" "${SANDBOX}/default-budget-persistent-failure.log" ||
  fail "default-budget persistent failure case did not log the final bounded-retry failure at the default maximum"
pass "default HEALTH_CHECK_MAX_ATTEMPTS (unset, falls back to 30) is still bounded: persistent failure retries exactly 30 times, then rolls back current/previous"

echo "all release readiness tests passed"
