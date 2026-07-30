#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "verify-env-permissions.test.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly VERIFY_SCRIPT="${SCRIPT_DIR}/verify-env-permissions.sh"
readonly SUFFIX="$$"
readonly API_USER="d10a-${SUFFIX}"
readonly OUTBOX_USER="d10o-${SUFFIX}"
readonly WORKER_USER="d10w-${SUFFIX}"
readonly MIGRATION_USER="d10m-${SUFFIX}"
readonly DOCKER_GROUP="d10d-${SUFFIX}"
readonly -a TEST_USERS=(
  "$API_USER"
  "$OUTBOX_USER"
  "$WORKER_USER"
  "$MIGRATION_USER"
)
readonly -a TEST_GROUPS=(
  "$API_USER"
  "$OUTBOX_USER"
  "$WORKER_USER"
  "$MIGRATION_USER"
  "$DOCKER_GROUP"
)
SANDBOX=$(mktemp -d)
ENV_DIR="${SANDBOX}/etc/depress"
created_users=()
created_groups=()

cleanup() {
  local user group
  set +e
  for user in "${created_users[@]}"; do
    if id "$user" >/dev/null 2>&1 && ! pgrep -u "$user" >/dev/null 2>&1; then
      userdel "$user"
    fi
  done
  for group in "${created_groups[@]}"; do
    if getent group "$group" >/dev/null 2>&1; then
      groupdel "$group"
    fi
  done
  if [[ -n ${SANDBOX:-} && -d ${SANDBOX} && ${SANDBOX} == /tmp/* ]]; then
    rm -rf -- "${SANDBOX}"
  fi
}
trap cleanup EXIT

for user in "${TEST_USERS[@]}"; do
  ! id "$user" >/dev/null 2>&1 ||
    { echo "test identity already exists" >&2; exit 1; }
done
for group in "${TEST_GROUPS[@]}"; do
  ! getent group "$group" >/dev/null 2>&1 ||
    { echo "test group already exists" >&2; exit 1; }
done

for group in "${TEST_GROUPS[@]}"; do
  groupadd --system "$group"
  created_groups=("$group" "${created_groups[@]}")
done
for user in "${TEST_USERS[@]}"; do
  useradd --system --no-create-home --shell /usr/sbin/nologin \
    --gid "$user" "$user"
  created_users=("$user" "${created_users[@]}")
done
usermod -aG "$DOCKER_GROUP" "$WORKER_USER"

chmod 0711 "$SANDBOX"
install -d -o root -g root -m 0711 "${SANDBOX}/etc"
install -d -o root -g root -m 0711 "$ENV_DIR"
touch \
  "${ENV_DIR}/api.env" \
  "${ENV_DIR}/outbox.env" \
  "${ENV_DIR}/worker.env" \
  "${ENV_DIR}/migration.env"
chown "root:${API_USER}" "${ENV_DIR}/api.env"
chown "root:${OUTBOX_USER}" "${ENV_DIR}/outbox.env"
chown "root:${WORKER_USER}" "${ENV_DIR}/worker.env"
chown "root:${MIGRATION_USER}" "${ENV_DIR}/migration.env"
chmod 0640 "${ENV_DIR}"/*.env

run_verify() {
  DEPRESS_ENV_DIR="$ENV_DIR" \
    DEPRESS_API_USER="$API_USER" \
    DEPRESS_API_GROUP="$API_USER" \
    DEPRESS_OUTBOX_USER="$OUTBOX_USER" \
    DEPRESS_OUTBOX_GROUP="$OUTBOX_USER" \
    DEPRESS_WORKER_USER="$WORKER_USER" \
    DEPRESS_WORKER_GROUP="$WORKER_USER" \
    DEPRESS_MIGRATION_USER="$MIGRATION_USER" \
    DEPRESS_MIGRATION_GROUP="$MIGRATION_USER" \
    DEPRESS_DOCKER_GROUP="$DOCKER_GROUP" \
    DEPRESS_WORKER_ENV_FILE="${ENV_DIR}/worker.env" \
    bash "$VERIFY_SCRIPT"
}

run_verify > "${SANDBOX}/positive.log"
grep -Fxq "env_permission_matrix=PASS" "${SANDBOX}/positive.log"
grep -Fxq "worker_docker=ALLOWED" "${SANDBOX}/positive.log"
echo "PASS: root:root 0711 permits only the intended file reads"

chmod 0750 "$ENV_DIR"
if run_verify >"${SANDBOX}/parent-0750.log" 2>&1; then
  echo "permission test failed: root:root 0750 parent was accepted" >&2
  exit 1
fi
chmod 0711 "$ENV_DIR"
echo "PASS: an untraversable parent directory is rejected"

REAL_ENV_DIR="$ENV_DIR"
mv "$REAL_ENV_DIR" "${REAL_ENV_DIR}.real"
ln -s "${REAL_ENV_DIR}.real" "$REAL_ENV_DIR"
if run_verify >"${SANDBOX}/parent-symlink.log" 2>&1; then
  echo "permission test failed: symlink parent was accepted" >&2
  exit 1
fi
rm -- "$REAL_ENV_DIR"
mv "${REAL_ENV_DIR}.real" "$REAL_ENV_DIR"
echo "PASS: a symlink environment directory is rejected"

if runuser -u "$API_USER" -- test -r "${ENV_DIR}/worker.env"; then
  echo "permission test failed: API can read Worker env" >&2
  exit 1
fi
if runuser -u "$MIGRATION_USER" -- test -r "${ENV_DIR}/api.env"; then
  echo "permission test failed: Migration can read API env" >&2
  exit 1
fi
echo "PASS: cross-service reads remain denied"

echo "all environment permission tests passed"
