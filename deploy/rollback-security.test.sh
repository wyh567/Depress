#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "rollback-security.test.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

SANDBOX=$(mktemp -d)
chmod 0711 "$SANDBOX"
readonly SUFFIX="${BASHPID}"
readonly RELEASE_GROUP="dprb${SUFFIX}"
readonly -a TEST_USERS=("dbw${SUFFIX}" "dba${SUFFIX}" "dbo${SUFFIX}" "dbj${SUFFIX}" "dbm${SUFFIX}" "dbc${SUFFIX}")
readonly -a TEST_GROUPS=("dgbw${SUFFIX}" "dgba${SUFFIX}" "dgbo${SUFFIX}" "dgbj${SUFFIX}" "dgbm${SUFFIX}" "dgbc${SUFFIX}")
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
  rm -rf -- "${SANDBOX}"
}
trap cleanup EXIT

ROOT="${SANDBOX}/depress"
OK_SYSTEMCTL="${SANDBOX}/systemctl"
FAIL_SYSTEMCTL="${SANDBOX}/systemctl-fail"
HEALTH="${SANDBOX}/health-check"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${OK_SYSTEMCTL}"
printf '%s\n' '#!/usr/bin/env bash' 'exit 23' > "${FAIL_SYSTEMCTL}"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${HEALTH}"
chmod 0755 "${OK_SYSTEMCTL}" "${FAIL_SYSTEMCTL}" "${HEALTH}"

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

run_rollback() {
  local systemctl_bin=$1
  local target=$2

  DEPRESS_ROOT="$ROOT" DEPRESS_RELEASE_GROUP="$RELEASE_GROUP" \
    DEPRESS_WEB_USER="${TEST_USERS[0]}" DEPRESS_WEB_GROUP="${TEST_GROUPS[0]}" \
    DEPRESS_API_USER="${TEST_USERS[1]}" DEPRESS_API_GROUP="${TEST_GROUPS[1]}" \
    DEPRESS_OUTBOX_USER="${TEST_USERS[2]}" DEPRESS_OUTBOX_GROUP="${TEST_GROUPS[2]}" \
    DEPRESS_WORKER_USER="${TEST_USERS[3]}" DEPRESS_WORKER_GROUP="${TEST_GROUPS[3]}" \
    DEPRESS_MIGRATION_USER="${TEST_USERS[4]}" DEPRESS_MIGRATION_GROUP="${TEST_GROUPS[4]}" \
    DEPRESS_CLEANUP_USER="${TEST_USERS[5]}" DEPRESS_CLEANUP_GROUP="${TEST_GROUPS[5]}" \
    SYSTEMCTL_BIN="$systemctl_bin" HEALTH_CHECK_BIN="$HEALTH" \
    bash "${SCRIPT_DIR}/rollback.sh" "$target"
}

OLD_SHA=1111111111111111111111111111111111111111
NEW_SHA=2222222222222222222222222222222222222222
mkdir -p "${ROOT}/releases/${OLD_SHA}" "${ROOT}/releases/${NEW_SHA}"
printf '%s\n' "${OLD_SHA}" > "${ROOT}/releases/${OLD_SHA}/.depress-release"
printf '%s\n' "${NEW_SHA}" > "${ROOT}/releases/${NEW_SHA}/.depress-release"
for release in "${ROOT}/releases/${OLD_SHA}" "${ROOT}/releases/${NEW_SHA}"; do
  DEPRESS_ROOT="$ROOT" DEPRESS_RELEASE_GROUP="$RELEASE_GROUP" \
    DEPRESS_WEB_USER="${TEST_USERS[0]}" DEPRESS_WEB_GROUP="${TEST_GROUPS[0]}" \
    DEPRESS_API_USER="${TEST_USERS[1]}" DEPRESS_API_GROUP="${TEST_GROUPS[1]}" \
    DEPRESS_OUTBOX_USER="${TEST_USERS[2]}" DEPRESS_OUTBOX_GROUP="${TEST_GROUPS[2]}" \
    DEPRESS_WORKER_USER="${TEST_USERS[3]}" DEPRESS_WORKER_GROUP="${TEST_GROUPS[3]}" \
    DEPRESS_MIGRATION_USER="${TEST_USERS[4]}" DEPRESS_MIGRATION_GROUP="${TEST_GROUPS[4]}" \
    DEPRESS_CLEANUP_USER="${TEST_USERS[5]}" DEPRESS_CLEANUP_GROUP="${TEST_GROUPS[5]}" \
    bash "${SCRIPT_DIR}/release-permissions.sh" normalize "$release" >/dev/null
done
ln -s "${ROOT}/releases/${OLD_SHA}" "${ROOT}/current"
ln -s "${ROOT}/releases/${NEW_SHA}" "${ROOT}/previous"

run_rollback "$OK_SYSTEMCTL" "$NEW_SHA"
[[ "$(readlink -f "${ROOT}/current")" == "${ROOT}/releases/${NEW_SHA}" ]]
[[ "$(readlink -f "${ROOT}/previous")" == "${ROOT}/releases/${OLD_SHA}" ]]
echo "PASS: successful rollback switches Web and backend release pointers together"

rm -f "${ROOT}/current" "${ROOT}/previous"
ln -s "${ROOT}/releases/${OLD_SHA}" "${ROOT}/current"
ln -s "${ROOT}/releases/${NEW_SHA}" "${ROOT}/previous"
if run_rollback "$FAIL_SYSTEMCTL" "$NEW_SHA" >"${SANDBOX}/failure.log" 2>&1; then
  echo "rollback security test failed: service failure was accepted" >&2
  exit 1
fi
[[ "$(readlink -f "${ROOT}/current")" == "${ROOT}/releases/${OLD_SHA}" ]]
[[ "$(readlink -f "${ROOT}/previous")" == "${ROOT}/releases/${NEW_SHA}" ]]
echo "PASS: failed rollback restores both release pointers"

rm -f "${ROOT}/current" "${ROOT}/previous"
mkdir "${SANDBOX}/outside-release"
ln -s "${SANDBOX}/outside-release" "${ROOT}/current"
ln -s "${ROOT}/releases/${NEW_SHA}" "${ROOT}/previous"
if run_rollback "$OK_SYSTEMCTL" "$NEW_SHA" >"${SANDBOX}/escape.log" 2>&1; then
  echo "rollback security test failed: escaping current target was accepted" >&2
  exit 1
fi
[[ "$(readlink -f "${ROOT}/current")" == "${SANDBOX}/outside-release" ]]
echo "PASS: rollback rejects a current target outside releases"

echo "all rollback security tests passed"
