#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "verify-env-permissions.sh must run as root" >&2
  exit 1
fi

ENV_DIR=${DEPRESS_ENV_DIR:-/etc/depress}
readonly runtime_users=(depress-api depress-outbox depress-worker)

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

assert_metadata() {
  local path=$1
  local expected=$2
  local actual

  [[ -f "${path}" ]] || fail "missing ${path}"
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

assert_identity depress-api depress-api
assert_identity depress-outbox depress-outbox
assert_identity depress-worker depress-worker
assert_identity depress-migration depress-migration

assert_metadata "${ENV_DIR}/api.env" "root:depress-api:640"
assert_metadata "${ENV_DIR}/outbox.env" "root:depress-outbox:640"
assert_metadata "${ENV_DIR}/pointer-worker.env" "root:depress-worker:640"
assert_metadata "${ENV_DIR}/migration.env" "root:depress-migration:640"

test -r "${ENV_DIR}/api.env"
test -r "${ENV_DIR}/outbox.env"
test -r "${ENV_DIR}/pointer-worker.env"
test -r "${ENV_DIR}/migration.env"

assert_readable depress-api "${ENV_DIR}/api.env"
assert_readable depress-outbox "${ENV_DIR}/outbox.env"
assert_readable depress-worker "${ENV_DIR}/pointer-worker.env"
assert_readable depress-migration "${ENV_DIR}/migration.env"

for user in "${runtime_users[@]}"; do
  for path in \
    "${ENV_DIR}/api.env" \
    "${ENV_DIR}/outbox.env" \
    "${ENV_DIR}/pointer-worker.env"; do
    case "${user}:${path}" in
      "depress-api:${ENV_DIR}/api.env" | \
      "depress-outbox:${ENV_DIR}/outbox.env" | \
      "depress-worker:${ENV_DIR}/pointer-worker.env")
        ;;
      *)
        assert_not_readable "${user}" "${path}"
        ;;
    esac
  done
  assert_not_readable "${user}" "${ENV_DIR}/migration.env"
done
for path in \
  "${ENV_DIR}/api.env" \
  "${ENV_DIR}/outbox.env" \
  "${ENV_DIR}/pointer-worker.env"; do
  assert_not_readable depress-migration "${path}"
done

if id -nG depress-api | tr ' ' '\n' | grep -Fxq docker; then
  fail "depress-api must not belong to docker"
fi
if id -nG depress-outbox | tr ' ' '\n' | grep -Fxq docker; then
  fail "depress-outbox must not belong to docker"
fi
if id -nG depress-migration | tr ' ' '\n' | grep -Fxq docker; then
  fail "depress-migration must not belong to docker"
fi
id -nG depress-worker | tr ' ' '\n' | grep -Fxq docker ||
  fail "depress-worker must belong to docker"

echo "environment permission isolation verified"
