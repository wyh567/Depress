#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "migrate-security.test.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly MIGRATE_SCRIPT="${SCRIPT_DIR}/migrate.sh"
readonly TEST_USER="depress-migtest-$$"
readonly TEST_GROUP="$TEST_USER"
readonly ALT_GROUP="${TEST_GROUP}x"
SANDBOX=$(mktemp -d /var/tmp/depress-migrate-test.XXXXXX)
test_user_created=0
test_group_created=0
alt_group_created=0

cleanup() {
  local status=$?
  set +e
  if (( test_user_created == 1 )) && id "$TEST_USER" >/dev/null 2>&1; then
    if pgrep -u "$TEST_USER" >/dev/null 2>&1; then
      echo "migration security test left a live test process; refusing identity cleanup" >&2
      status=70
    else
      userdel "$TEST_USER" || status=70
    fi
  fi
  if (( alt_group_created == 1 )) && getent group "$ALT_GROUP" >/dev/null 2>&1; then
    groupdel "$ALT_GROUP" || status=70
  fi
  if (( test_group_created == 1 )) && getent group "$TEST_GROUP" >/dev/null 2>&1; then
    groupdel "$TEST_GROUP" || status=70
  fi
  if [[ -n ${SANDBOX:-} && -d ${SANDBOX} &&
    ${SANDBOX} == /var/tmp/depress-migrate-test.* ]]; then
    rm -rf -- "${SANDBOX}"
  fi
  exit "$status"
}
trap cleanup EXIT

! id "$TEST_USER" >/dev/null 2>&1
! getent group "$TEST_GROUP" >/dev/null 2>&1
! getent group "$ALT_GROUP" >/dev/null 2>&1
groupadd --system "$TEST_GROUP"
test_group_created=1
groupadd --system "$ALT_GROUP"
alt_group_created=1
useradd --system --no-create-home --shell /usr/sbin/nologin \
  --gid "$TEST_GROUP" "$TEST_USER"
test_user_created=1

readonly TEST_UID=$(id -u "$TEST_USER")
readonly TEST_GID=$(id -g "$TEST_USER")
readonly TEST_HOME=$(getent passwd "$TEST_USER" | cut -d: -f6)
readonly DATABASE_URL_MARKER="postgresql://migration-test.invalid/depress?marker=$$"
chmod 0755 "$SANDBOX"
DEPRESS_ROOT="${SANDBOX}/depress"
ENV_DIR="${SANDBOX}/etc/depress"
MIGRATION_ENV_FILE="${ENV_DIR}/migration.env"
RUNTIME_DIR="${SANDBOX}/runtime"
RESULT_DIR="${SANDBOX}/result"
FAKE_COREPACK="${SANDBOX}/corepack"
mkdir -p "${DEPRESS_ROOT}/releases/test" "${RESULT_DIR}" "${SANDBOX}/etc"
install -d -o root -g root -m 0711 "${ENV_DIR}"
ln -s "${DEPRESS_ROOT}/releases/test" "${DEPRESS_ROOT}/current"
chown "${TEST_USER}:${TEST_GROUP}" "${RESULT_DIR}"
chmod 0700 "${RESULT_DIR}"
[[ ! -e "$TEST_HOME" ]]
! id -nG "$TEST_USER" | tr ' ' '\n' | grep -Fxq docker

{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -euo pipefail'
  printf '%s\n' "[[ \$(id -u) == '${TEST_UID}' ]]"
  printf '%s\n' "[[ \$(id -g) == '${TEST_GID}' ]]"
  printf '%s\n' "[[ \${HOME} == '${RUNTIME_DIR}' ]]"
  printf '%s\n' "[[ \${COREPACK_HOME} == '${RUNTIME_DIR}/corepack' ]]"
  printf '%s\n' "[[ \${XDG_CACHE_HOME} == '${RUNTIME_DIR}/cache' ]]"
  printf '%s\n' '[[ -n ${DATABASE_URL} ]]'
  printf '%s\n' '[[ -z ${UNEXPECTED_VARIABLE+x} ]]'
  printf '%s\n' '[[ -z ${NPM_TOKEN+x} ]]'
  printf '%s\n' '[[ -z ${HTTPS_PROXY+x} ]]'
  printf '%s\n' '[[ $1 == pnpm ]]'
  printf '%s\n' "printf '%s\\n' cache-ok > '${RUNTIME_DIR}/corepack/fake-manager'"
  printf '%s\n' "printf '%s\\n' cache-ok > '${RUNTIME_DIR}/cache/fake-cache'"
  printf '%s\n' "printf '%s\\n' passed > '${RESULT_DIR}/executed'"
} > "${FAKE_COREPACK}"
chmod 0755 "${FAKE_COREPACK}"

write_migration_env() {
  printf '%s\n' "$@" > "${MIGRATION_ENV_FILE}"
  chown "root:${TEST_GROUP}" "${MIGRATION_ENV_FILE}"
  chmod 0640 "${MIGRATION_ENV_FILE}"
}

run_migration() {
  UNEXPECTED_VARIABLE=must-not-leak \
    NPM_TOKEN=must-not-leak \
    HTTPS_PROXY=http://must-not-leak.invalid \
    DEPRESS_ROOT="${DEPRESS_ROOT}" \
    MIGRATION_ENV_FILE="${MIGRATION_ENV_FILE}" \
    MIGRATION_USER="${TEST_USER}" \
    MIGRATION_RUNTIME_DIR="${MIGRATION_RUNTIME_OVERRIDE:-${RUNTIME_DIR}}" \
    COREPACK_BIN="${FAKE_COREPACK}" \
    bash "${MIGRATE_SCRIPT}"
}

remove_test_runtime() {
  [[ "$RUNTIME_DIR" == "${SANDBOX}/runtime" ]] || return 70
  if [[ -L "$RUNTIME_DIR" ]]; then
    rm -- "$RUNTIME_DIR"
  elif [[ -d "$RUNTIME_DIR" ]]; then
    find "$RUNTIME_DIR" -depth -mindepth 1 -delete
    rmdir "$RUNTIME_DIR"
  fi
}

expect_runtime_rejection() {
  local label=$1
  if run_migration >"${SANDBOX}/${label}.log" 2>&1; then
    echo "migration security test failed: ${label} runtime was accepted" >&2
    exit 1
  fi
}

write_migration_env "DATABASE_URL=${DATABASE_URL_MARKER}"
[[ "$(stat -c '%U:%G:%a' "${ENV_DIR}")" == "root:root:711" ]]
runuser -u "${TEST_USER}" -- test -x "${ENV_DIR}"
runuser -u "${TEST_USER}" -- test ! -r "${ENV_DIR}"
runuser -u "${TEST_USER}" -- test -r "${MIGRATION_ENV_FILE}"
run_migration >"${SANDBOX}/first.log" 2>&1
[[ -f "${RESULT_DIR}/executed" ]]
[[ "$(stat -c '%U:%G:%a' "$RUNTIME_DIR")" == "${TEST_USER}:${TEST_GROUP}:700" ]]
[[ "$(stat -c '%U:%G:%a' "${RUNTIME_DIR}/corepack")" == "${TEST_USER}:${TEST_GROUP}:700" ]]
[[ "$(stat -c '%U:%G:%a' "${RUNTIME_DIR}/cache")" == "${TEST_USER}:${TEST_GROUP}:700" ]]
[[ -f "${RUNTIME_DIR}/corepack/fake-manager" ]]
[[ -f "${RUNTIME_DIR}/cache/fake-cache" ]]
! grep -R -F -- "$DATABASE_URL_MARKER" "$RUNTIME_DIR" "${SANDBOX}/first.log"
echo "PASS: no-home migration identity uses a private runtime and whitelisted environment"

rm -f -- "${RESULT_DIR}/executed"
run_migration >"${SANDBOX}/repeat.log" 2>&1
[[ -f "${RESULT_DIR}/executed" ]]
! grep -R -F -- "$DATABASE_URL_MARKER" "$RUNTIME_DIR" "${SANDBOX}/repeat.log"
echo "PASS: a safe existing runtime and tool cache can be reused"

if runuser -u "$TEST_USER" -- env \
  DEPRESS_ROOT="$DEPRESS_ROOT" \
  MIGRATION_ENV_FILE="$MIGRATION_ENV_FILE" \
  MIGRATION_USER="$TEST_USER" \
  MIGRATION_RUNTIME_DIR="$RUNTIME_DIR" \
  COREPACK_BIN="$FAKE_COREPACK" \
  bash "$MIGRATE_SCRIPT" >"${SANDBOX}/non-root.log" 2>&1; then
  echo "migration security test failed: non-root invocation was accepted" >&2
  exit 1
fi
echo "PASS: non-root invocation is rejected"

remove_test_runtime
ln -s "$RESULT_DIR" "$RUNTIME_DIR"
expect_runtime_rejection symlink
remove_test_runtime

install -d -o root -g "$TEST_GROUP" -m 0700 "$RUNTIME_DIR"
expect_runtime_rejection wrong-owner
remove_test_runtime

install -d -o "$TEST_USER" -g "$ALT_GROUP" -m 0700 "$RUNTIME_DIR"
expect_runtime_rejection wrong-group
remove_test_runtime

install -d -o "$TEST_USER" -g "$TEST_GROUP" -m 0750 "$RUNTIME_DIR"
expect_runtime_rejection broad-mode
remove_test_runtime
echo "PASS: symlink, wrong owner/group, and broad mode fail closed"

MIGRATION_RUNTIME_OVERRIDE=/ \
  expect_runtime_rejection root-path
echo "PASS: unsafe root runtime is rejected"

chmod 0750 "${ENV_DIR}"
if run_migration >"${SANDBOX}/parent-permission.log" 2>&1; then
  echo "migration security test failed: inaccessible env parent was accepted" >&2
  exit 1
fi
chmod 0711 "${ENV_DIR}"

write_migration_env \
  "DATABASE_URL=${DATABASE_URL_MARKER}" \
  "UNEXPECTED_VARIABLE=must-not-pass"
if run_migration >"${SANDBOX}/invalid.log" 2>&1; then
  echo "migration security test failed: extra env assignment was accepted" >&2
  exit 1
fi

write_migration_env "DATABASE_URL="
if run_migration >"${SANDBOX}/empty.log" 2>&1; then
  echo "migration security test failed: empty DATABASE_URL was accepted" >&2
  exit 1
fi
echo "PASS: inaccessible and invalid migration env files remain rejected"

! grep -R -F -- "$DATABASE_URL_MARKER" "$RUNTIME_DIR" "${SANDBOX}"/*.log
echo "PASS: database URL is absent from runtime files and logs"
