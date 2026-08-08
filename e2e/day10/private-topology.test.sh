#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "private-topology.test.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/identity-topology.sh"

SANDBOX=$(mktemp -d)
readonly exact_commit=1111111111111111111111111111111111111111
readonly run_id="topology-test-$$"
readonly config_dir="/etc/depress-day10"
readonly staging_root="${SANDBOX}/staging"
readonly state_root="${SANDBOX}/state"
readonly identity_state_file="${state_root}/identities-${run_id}.state"
readonly migration_runtime="/run/depress-day10-migration-${run_id}"
readonly migration_runtime_state_file="${state_root}/migration-runtime-${run_id}.state"
readonly log_dir="${SANDBOX}/log"
readonly redis_data="${SANDBOX}/redis"
readonly postgres_port=15432
DAY10_SYSTEMD_UNIT_DIR="${SANDBOX}/units"
export DAY10_SYSTEMD_UNIT_DIR
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/provision-staging.sh"

cleanup() {
  local status=$?
  local cleanup_status=0
  set +e
  remove_day10_staging_config || cleanup_status=$?
  remove_migration_runtime || cleanup_status=$?
  remove_day10_private_identities || cleanup_status=$?
  if [[ -n ${SANDBOX:-} && -d ${SANDBOX} && ${SANDBOX} == /tmp/* ]]; then
    rm -rf -- "${SANDBOX}"
  fi
  if (( status == 0 && cleanup_status != 0 )); then
    status=$cleanup_status
  fi
  exit "$status"
}
trap cleanup EXIT

[[ ! -e "$config_dir" && ! -L "$config_dir" ]] || {
  echo "topology test refuses a pre-existing config path" >&2
  exit 71
}
for identity in "${day10_private_users[@]}"; do
  ! id "$identity" >/dev/null 2>&1 || {
    echo "topology test refuses a pre-existing user" >&2
    exit 71
  }
done
for identity in "${day10_private_groups[@]}"; do
  ! getent group "$identity" >/dev/null 2>&1 || {
    echo "topology test refuses a pre-existing group" >&2
    exit 71
  }
done
! getent group "$day10_release_group" >/dev/null 2>&1 || {
  echo "topology test refuses a pre-existing release group" >&2
  exit 71
}

install -d -m 0755 "$DAY10_SYSTEMD_UNIT_DIR"
printf '%s\n' \
  "[Unit]" \
  "Description=Topology test Docker dependency" \
  "[Service]" \
  "Type=oneshot" \
  "ExecStart=/usr/bin/true" \
  > "${DAY10_SYSTEMD_UNIT_DIR}/docker.service"

SYSTEMD_UNIT_PATH="${DAY10_SYSTEMD_UNIT_DIR}:/etc/systemd/system:/usr/lib/systemd/system" \
  provision_day10_staging

ln -s "$log_dir" "$migration_runtime"
if register_migration_runtime >"${SANDBOX}/preexisting-runtime.log" 2>&1; then
  echo "topology test failed: pre-existing migration runtime was accepted" >&2
  exit 1
fi
rm -- "$migration_runtime"
register_migration_runtime

install -d -o "$day10_migration_user" -g "$day10_migration_group" \
  -m 0700 "$migration_runtime"
run_as_identity_from_safe_cwd "$day10_migration_user" \
  /usr/bin/touch "${migration_runtime}/cache-probe"
[[ "$(stat -c '%U:%G:%a' "$migration_runtime")" == "${day10_migration_user}:${day10_migration_group}:700" ]]
[[ "$(stat -c '%U:%G:%a' "$migration_runtime_state_file")" == "root:root:600" ]]

[[ "$(stat -c '%U:%G:%a' "$config_dir")" == "root:root:711" ]]
[[ "$(stat -c '%U:%G:%a' "${config_dir}/tls")" == "root:root:700" ]]
[[ "$(stat -c '%U:%G:%a' "${config_dir}/tls/tls.key")" == "root:root:600" ]]
grep -Fxq "User=${day10_api_user}" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-api.service"
grep -Fxq "Group=${day10_api_group}" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-api.service"
grep -Fxq "User=${day10_outbox_user}" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-outbox.service"
grep -Fxq "Group=${day10_outbox_group}" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-outbox.service"
grep -Fxq "User=${day10_worker_user}" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-pointer-worker.service"
grep -Fxq "Group=${day10_worker_group}" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-pointer-worker.service"
grep -Fxq "SupplementaryGroups=${day10_docker_group}" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-pointer-worker.service"
grep -Fxq "User=${day10_web_user}" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-web-day10.service"
grep -Fxq "Group=${day10_web_group}" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-web-day10.service"
grep -Fxq "EnvironmentFile=/etc/depress-day10/web.env" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-web-day10.service"
grep -Fxq "ReadOnlyPaths=/opt/depress" \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-web-day10.service"
[[ "$(readlink "${DAY10_SYSTEMD_UNIT_DIR}/depress-web.service")" == \
  "depress-web-day10.service" ]]
! grep -q '^SupplementaryGroups=' \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-api.service"
! grep -q '^SupplementaryGroups=' \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-outbox.service"
! grep -q '^SupplementaryGroups=' \
  "${DAY10_SYSTEMD_UNIT_DIR}/depress-web-day10.service"
for identity in "${day10_private_users[@]}"; do
  [[ " $(id -nG "$identity") " == *" ${day10_release_group} "* ]]
  [[ "$(id -gn "$identity")" == "$identity" ]]
done

DEPRESS_ENV_DIR="$config_dir" \
  DEPRESS_API_USER="$day10_api_user" \
  DEPRESS_API_GROUP="$day10_api_group" \
  DEPRESS_OUTBOX_USER="$day10_outbox_user" \
  DEPRESS_OUTBOX_GROUP="$day10_outbox_group" \
  DEPRESS_WORKER_USER="$day10_worker_user" \
  DEPRESS_WORKER_GROUP="$day10_worker_group" \
  DEPRESS_MIGRATION_USER="$day10_migration_user" \
  DEPRESS_MIGRATION_GROUP="$day10_migration_group" \
  DEPRESS_WEB_USER="$day10_web_user" \
  DEPRESS_WEB_GROUP="$day10_web_group" \
  DEPRESS_RELEASE_GROUP="$day10_release_group" \
  DEPRESS_DOCKER_GROUP="$day10_docker_group" \
  DEPRESS_WORKER_ENV_FILE="${config_dir}/worker.env" \
  DEPRESS_WEB_ENV_FILE="${config_dir}/web.env" \
  bash "${SCRIPT_DIR}/../../deploy/verify-env-permissions.sh" \
  > "${SANDBOX}/permission-evidence.log"
grep -Fxq "env_permission_matrix=PASS" \
  "${SANDBOX}/permission-evidence.log"
grep -Fxq "worker_docker=ALLOWED" \
  "${SANDBOX}/permission-evidence.log"
grep -Fxq "migration_docker=DENIED" \
  "${SANDBOX}/permission-evidence.log"

remove_day10_staging_config
remove_migration_runtime
remove_day10_private_identities
[[ ! -e "$migration_runtime" && ! -L "$migration_runtime" ]]
[[ ! -e "$migration_runtime_state_file" && ! -L "$migration_runtime_state_file" ]]
for identity in "${day10_private_users[@]}"; do
  ! id "$identity" >/dev/null 2>&1
done
! getent group "$day10_release_group" >/dev/null 2>&1

echo "PASS: disposable users, private groups, env permissions, and units agree"
echo "PASS: unmarked pre-existing migration runtime is rejected"
echo "PASS: marked migration runtime is removed before disposable identities"
