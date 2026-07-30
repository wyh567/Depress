#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "migrate-security.test.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly MIGRATE_SCRIPT="${SCRIPT_DIR}/migrate.sh"
readonly TEST_USER=nobody
readonly TEST_GROUP=$(id -gn "${TEST_USER}")
readonly TEST_UID=$(id -u "${TEST_USER}")
readonly TEST_GID=$(id -g "${TEST_USER}")
SANDBOX=$(mktemp -d)

cleanup() {
  if [[ -n ${SANDBOX:-} && -d ${SANDBOX} && ${SANDBOX} == /tmp/* ]]; then
    rm -rf -- "${SANDBOX}"
  fi
}
trap cleanup EXIT

chmod 0755 "${SANDBOX}"
DEPRESS_ROOT="${SANDBOX}/depress"
ENV_DIR="${SANDBOX}/etc/depress"
MIGRATION_ENV_FILE="${ENV_DIR}/migration.env"
RESULT_DIR="${SANDBOX}/result"
FAKE_COREPACK="${SANDBOX}/corepack"
mkdir -p "${DEPRESS_ROOT}/releases/test" "${RESULT_DIR}" "${SANDBOX}/etc"
install -d -o root -g root -m 0711 "${ENV_DIR}"
ln -s "${DEPRESS_ROOT}/releases/test" "${DEPRESS_ROOT}/current"
chown "${TEST_USER}:${TEST_GROUP}" "${RESULT_DIR}"
chmod 0700 "${RESULT_DIR}"

{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -euo pipefail'
  printf '%s\n' "[[ \$(id -u) == '${TEST_UID}' ]]"
  printf '%s\n' "[[ \$(id -g) == '${TEST_GID}' ]]"
  printf '%s\n' '[[ ${DATABASE_URL} == postgresql://placeholder.invalid/depress ]]'
  printf '%s\n' '[[ -z ${UNEXPECTED_VARIABLE+x} ]]'
  printf '%s\n' "printf '%s\\n' passed > '${RESULT_DIR}/executed'"
} > "${FAKE_COREPACK}"
chmod 0755 "${FAKE_COREPACK}"

write_migration_env() {
  printf '%s\n' "$@" > "${MIGRATION_ENV_FILE}"
  chown "root:${TEST_GROUP}" "${MIGRATION_ENV_FILE}"
  chmod 0640 "${MIGRATION_ENV_FILE}"
}

run_migration() {
  DEPRESS_ROOT="${DEPRESS_ROOT}" \
    MIGRATION_ENV_FILE="${MIGRATION_ENV_FILE}" \
    MIGRATION_USER="${TEST_USER}" \
    COREPACK_BIN="${FAKE_COREPACK}" \
    bash "${MIGRATE_SCRIPT}"
}

write_migration_env "DATABASE_URL=postgresql://placeholder.invalid/depress"
[[ "$(stat -c '%U:%G:%a' "${ENV_DIR}")" == "root:root:711" ]]
runuser -u "${TEST_USER}" -- test -x "${ENV_DIR}"
runuser -u "${TEST_USER}" -- test ! -r "${ENV_DIR}"
runuser -u "${TEST_USER}" -- test -r "${MIGRATION_ENV_FILE}"
for denied_user in depress-api depress-outbox depress-worker; do
  if id "${denied_user}" >/dev/null 2>&1; then
    runuser -u "${denied_user}" -- test ! -r "${MIGRATION_ENV_FILE}"
  fi
done
run_migration
[[ -f "${RESULT_DIR}/executed" ]]
echo "PASS: only the migration identity reads the env before the downgraded command"
echo "PASS: migration runs with the target UID/GID and exports only DATABASE_URL"

chmod 0750 "${ENV_DIR}"
if run_migration >"${SANDBOX}/parent-permission.log" 2>&1; then
  echo "migration security test failed: inaccessible parent directory was accepted" >&2
  exit 1
fi
chmod 0711 "${ENV_DIR}"
echo "PASS: migration fails closed when its identity cannot traverse the env directory"

rm -f -- "${RESULT_DIR}/executed"
write_migration_env \
  "DATABASE_URL=postgresql://placeholder.invalid/depress" \
  "UNEXPECTED_VARIABLE=must-not-pass"
if run_migration >"${SANDBOX}/invalid.log" 2>&1; then
  echo "migration security test failed: extra assignment was accepted" >&2
  exit 1
fi
[[ ! -e "${RESULT_DIR}/executed" ]]
echo "PASS: migration env with an extra assignment is rejected"

rm -f -- "${RESULT_DIR}/executed"
write_migration_env "DATABASE_URL="
if run_migration >"${SANDBOX}/empty.log" 2>&1; then
  echo "migration security test failed: empty DATABASE_URL was accepted" >&2
  exit 1
fi
[[ ! -e "${RESULT_DIR}/executed" ]]
echo "PASS: empty migration DATABASE_URL is rejected"
