#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "verify-env-permissions.test.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly VERIFY_SCRIPT="${SCRIPT_DIR}/verify-env-permissions.sh"
readonly IDENTITY_RUNNER="${SCRIPT_DIR}/run-as-identity.sh"
# shellcheck disable=SC1090
source "$IDENTITY_RUNNER"
readonly SUFFIX="$$"
readonly API_USER="d10a-${SUFFIX}"
readonly OUTBOX_USER="d10o-${SUFFIX}"
readonly WORKER_USER="d10w-${SUFFIX}"
readonly MIGRATION_USER="d10m-${SUFFIX}"
readonly WEB_USER="d10b-${SUFFIX}"
readonly DOCKER_GROUP="d10d-${SUFFIX}"
readonly RELEASE_GROUP="d10r-${SUFFIX}"
readonly -a TEST_USERS=(
  "$API_USER"
  "$OUTBOX_USER"
  "$WORKER_USER"
  "$MIGRATION_USER"
  "$WEB_USER"
)
readonly -a TEST_GROUPS=(
  "$API_USER"
  "$OUTBOX_USER"
  "$WORKER_USER"
  "$MIGRATION_USER"
  "$WEB_USER"
  "$DOCKER_GROUP"
  "$RELEASE_GROUP"
)
SANDBOX=$(mktemp -d)
OPERATOR_CWD=$(mktemp -d /root/depress-env-operator-cwd.XXXXXX)
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
  if [[ -n ${OPERATOR_CWD:-} && -d ${OPERATOR_CWD} && ! -L ${OPERATOR_CWD} &&
    ${OPERATOR_CWD} == /root/depress-env-operator-cwd.* ]]; then
    rmdir "$OPERATOR_CWD"
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
for user in "${TEST_USERS[@]}"; do
  usermod -aG "$RELEASE_GROUP" "$user"
done

chmod 0711 "$SANDBOX"
install -d -o root -g root -m 0711 "${SANDBOX}/etc"
install -d -o root -g root -m 0711 "$ENV_DIR"
touch \
  "${ENV_DIR}/api.env" \
  "${ENV_DIR}/outbox.env" \
  "${ENV_DIR}/worker.env" \
  "${ENV_DIR}/migration.env" \
  "${ENV_DIR}/web.env"
chown "root:${API_USER}" "${ENV_DIR}/api.env"
chown "root:${OUTBOX_USER}" "${ENV_DIR}/outbox.env"
chown "root:${WORKER_USER}" "${ENV_DIR}/worker.env"
chown "root:${MIGRATION_USER}" "${ENV_DIR}/migration.env"
chown "root:${WEB_USER}" "${ENV_DIR}/web.env"
chmod 0640 "${ENV_DIR}"/*.env
chmod 0700 "$OPERATOR_CWD"
cd "$OPERATOR_CWD"
for user in "${TEST_USERS[@]}"; do
  [[ "$(run_as_identity_from_safe_cwd "$user" /bin/pwd)" == / ]]
done

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
    DEPRESS_WEB_USER="$WEB_USER" \
    DEPRESS_WEB_GROUP="$WEB_USER" \
    DEPRESS_DOCKER_GROUP="$DOCKER_GROUP" \
    DEPRESS_RELEASE_GROUP="$RELEASE_GROUP" \
    DEPRESS_WORKER_ENV_FILE="${ENV_DIR}/worker.env" \
    DEPRESS_WEB_ENV_FILE="${ENV_DIR}/web.env" \
    bash "$VERIFY_SCRIPT"
}

run_verify > "${SANDBOX}/positive.log"
grep -Fxq "env_permission_matrix=PASS" "${SANDBOX}/positive.log"
grep -Fxq "worker_docker=ALLOWED" "${SANDBOX}/positive.log"
grep -Fxq "web_cross_read=DENIED" "${SANDBOX}/positive.log"
grep -Fxq "web_docker=DENIED" "${SANDBOX}/positive.log"
grep -Fxq "release_group_membership=PASS" "${SANDBOX}/positive.log"
echo "PASS: root:root 0711 permits only the intended file reads"

gpasswd -d "$WEB_USER" "$RELEASE_GROUP" >/dev/null
if run_verify >"${SANDBOX}/missing-release-group.log" 2>&1; then
  echo "permission test failed: missing Release group membership was accepted" >&2
  exit 1
fi
usermod -aG "$RELEASE_GROUP" "$WEB_USER"
echo "PASS: all identities require Release group membership"

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

REAL_API_ENV="${ENV_DIR}/api.env"
mv "$REAL_API_ENV" "${REAL_API_ENV}.real"
ln -s "${REAL_API_ENV}.real" "$REAL_API_ENV"
if run_verify >"${SANDBOX}/file-symlink.log" 2>&1; then
  echo "permission test failed: symlink environment file was accepted" >&2
  exit 1
fi
rm -- "$REAL_API_ENV"
mv "${REAL_API_ENV}.real" "$REAL_API_ENV"
echo "PASS: a symlink environment file is rejected"

chown "${API_USER}:${OUTBOX_USER}" "$REAL_API_ENV"
if run_verify >"${SANDBOX}/wrong-owner-group.log" 2>&1; then
  echo "permission test failed: wrong environment owner/group was accepted" >&2
  exit 1
fi
chown "root:${API_USER}" "$REAL_API_ENV"
echo "PASS: wrong environment owner/group is rejected"

chmod 0644 "$REAL_API_ENV"
if run_verify >"${SANDBOX}/wide-mode.log" 2>&1; then
  echo "permission test failed: over-wide environment mode was accepted" >&2
  exit 1
fi
chmod 0640 "$REAL_API_ENV"
echo "PASS: over-wide environment mode is rejected"

if run_as_identity_from_safe_cwd "$API_USER" \
  /usr/bin/test -r "${ENV_DIR}/worker.env"; then
  echo "permission test failed: API can read Worker env" >&2
  exit 1
fi
if run_as_identity_from_safe_cwd "$MIGRATION_USER" \
  /usr/bin/test -r "${ENV_DIR}/api.env"; then
  echo "permission test failed: Migration can read API env" >&2
  exit 1
fi
if run_as_identity_from_safe_cwd "$WEB_USER" \
  /usr/bin/test -r "${ENV_DIR}/api.env"; then
  echo "permission test failed: Web can read API env" >&2
  exit 1
fi
echo "PASS: cross-service reads remain denied"

echo "all environment permission tests passed"
