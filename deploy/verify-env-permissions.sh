#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "verify-env-permissions.sh must run as root" >&2
  exit 1
fi

ENV_DIR=${DEPRESS_ENV_DIR:-/etc/depress}
API_USER=${DEPRESS_API_USER:-depress-api}
API_GROUP=${DEPRESS_API_GROUP:-depress-api}
OUTBOX_USER=${DEPRESS_OUTBOX_USER:-depress-outbox}
OUTBOX_GROUP=${DEPRESS_OUTBOX_GROUP:-depress-outbox}
WORKER_USER=${DEPRESS_WORKER_USER:-depress-worker}
WORKER_GROUP=${DEPRESS_WORKER_GROUP:-depress-worker}
MIGRATION_USER=${DEPRESS_MIGRATION_USER:-depress-migration}
MIGRATION_GROUP=${DEPRESS_MIGRATION_GROUP:-depress-migration}
DOCKER_GROUP=${DEPRESS_DOCKER_GROUP:-docker}
API_ENV_FILE=${DEPRESS_API_ENV_FILE:-${ENV_DIR}/api.env}
OUTBOX_ENV_FILE=${DEPRESS_OUTBOX_ENV_FILE:-${ENV_DIR}/outbox.env}
WORKER_ENV_FILE=${DEPRESS_WORKER_ENV_FILE:-${ENV_DIR}/pointer-worker.env}
MIGRATION_ENV_FILE=${DEPRESS_MIGRATION_ENV_FILE:-${ENV_DIR}/migration.env}
readonly runtime_users=("$API_USER" "$OUTBOX_USER" "$WORKER_USER")

fail() {
  echo "environment permission check failed: $*" >&2
  exit 1
}

assert_identity() {
  local user=$1
  local primary_group=$2
  local supplementary_members

  id "${user}" >/dev/null 2>&1 || fail "missing user ${user}"
  getent group "${primary_group}" >/dev/null 2>&1 ||
    fail "missing group ${primary_group}"
  [[ $(id -gn "${user}") == "${primary_group}" ]] ||
    fail "${user} must use private primary group ${primary_group}"
  supplementary_members=$(getent group "${primary_group}" | cut -d: -f4)
  [[ -z "${supplementary_members}" ]] ||
    fail "private group ${primary_group} must not have supplementary members"
}

assert_directory_boundary() {
  local user
  [[ -d "$ENV_DIR" && ! -L "$ENV_DIR" ]] ||
    fail "${ENV_DIR} must be a real directory, not a symlink"
  [[ "$(stat -c '%U:%G:%a' "$ENV_DIR")" == "root:root:711" ]] ||
    fail "${ENV_DIR} must be root:root with mode 0711"
  for user in \
    "$API_USER" \
    "$OUTBOX_USER" \
    "$WORKER_USER" \
    "$MIGRATION_USER"; do
    runuser -u "$user" -- test -x "$ENV_DIR" ||
      fail "${user} cannot traverse ${ENV_DIR}"
    if runuser -u "$user" -- test -r "$ENV_DIR"; then
      fail "${user} can list ${ENV_DIR}"
    fi
  done
}

assert_metadata() {
  local path=$1
  local expected=$2
  local actual

  [[ -f "${path}" && ! -L "${path}" ]] ||
    fail "missing regular non-symlink file ${path}"
  actual=$(stat -c '%U:%G:%a' "${path}")
  [[ "${actual}" == "${expected}" ]] ||
    fail "${path} expected ${expected}, found ${actual}"
}

assert_readable() {
  local user=$1
  local path=$2

  runuser -u "${user}" -- test -r "${path}" ||
    fail "${user} cannot read its own environment file ${path}"
}

assert_not_readable() {
  local user=$1
  local path=$2

  if runuser -u "${user}" -- test -r "${path}"; then
    fail "${user} can read forbidden environment file ${path}"
  fi
}

assert_identity "$API_USER" "$API_GROUP"
assert_identity "$OUTBOX_USER" "$OUTBOX_GROUP"
assert_identity "$WORKER_USER" "$WORKER_GROUP"
assert_identity "$MIGRATION_USER" "$MIGRATION_GROUP"
getent group "$DOCKER_GROUP" >/dev/null 2>&1 ||
  fail "missing Docker group ${DOCKER_GROUP}"
assert_directory_boundary

assert_metadata "$API_ENV_FILE" "root:${API_GROUP}:640"
assert_metadata "$OUTBOX_ENV_FILE" "root:${OUTBOX_GROUP}:640"
assert_metadata "$WORKER_ENV_FILE" "root:${WORKER_GROUP}:640"
assert_metadata "$MIGRATION_ENV_FILE" "root:${MIGRATION_GROUP}:640"

test -r "$API_ENV_FILE"
test -r "$OUTBOX_ENV_FILE"
test -r "$WORKER_ENV_FILE"
test -r "$MIGRATION_ENV_FILE"

assert_readable "$API_USER" "$API_ENV_FILE"
assert_readable "$OUTBOX_USER" "$OUTBOX_ENV_FILE"
assert_readable "$WORKER_USER" "$WORKER_ENV_FILE"
assert_readable "$MIGRATION_USER" "$MIGRATION_ENV_FILE"

for user in "${runtime_users[@]}"; do
  for path in \
    "$API_ENV_FILE" \
    "$OUTBOX_ENV_FILE" \
    "$WORKER_ENV_FILE"; do
    case "${user}:${path}" in
      "${API_USER}:${API_ENV_FILE}" | \
      "${OUTBOX_USER}:${OUTBOX_ENV_FILE}" | \
      "${WORKER_USER}:${WORKER_ENV_FILE}")
        ;;
      *)
        assert_not_readable "${user}" "${path}"
        ;;
    esac
  done
  assert_not_readable "$user" "$MIGRATION_ENV_FILE"
done
for path in \
  "$API_ENV_FILE" \
  "$OUTBOX_ENV_FILE" \
  "$WORKER_ENV_FILE"; do
  assert_not_readable "$MIGRATION_USER" "$path"
done

if id -nG "$API_USER" | tr ' ' '\n' | grep -Fxq "$DOCKER_GROUP"; then
  fail "${API_USER} must not belong to ${DOCKER_GROUP}"
fi
if id -nG "$OUTBOX_USER" | tr ' ' '\n' | grep -Fxq "$DOCKER_GROUP"; then
  fail "${OUTBOX_USER} must not belong to ${DOCKER_GROUP}"
fi
if id -nG "$MIGRATION_USER" | tr ' ' '\n' | grep -Fxq "$DOCKER_GROUP"; then
  fail "${MIGRATION_USER} must not belong to ${DOCKER_GROUP}"
fi
id -nG "$WORKER_USER" | tr ' ' '\n' | grep -Fxq "$DOCKER_GROUP" ||
  fail "${WORKER_USER} must belong to ${DOCKER_GROUP}"

echo "environment permission isolation verified"
echo "env_permission_matrix=PASS"
echo "api_cross_read=DENIED"
echo "outbox_cross_read=DENIED"
echo "worker_cross_read=DENIED"
echo "migration_cross_read=DENIED"
echo "worker_docker=ALLOWED"
echo "api_docker=DENIED"
echo "outbox_docker=DENIED"
echo "migration_docker=DENIED"
