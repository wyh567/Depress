#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly exact_commit="8a83cfd9dee844efc4473b05a3547edf860f1ccb"
readonly staging_root="/mnt/d/depress-day10-wsl"
readonly release_archive="${staging_root}/release-${exact_commit}.tar"
readonly release_root="/opt/depress"
readonly release_dir="${release_root}/releases/${exact_commit}"
readonly current_link="${release_root}/current"
readonly config_dir="/etc/depress-day10"
readonly state_root="/var/lib/depress-day10"
readonly redis_data="${state_root}/redis"
readonly minio_data="${state_root}/minio"
readonly mc_config="${state_root}/mc-root"
readonly worker_runtime="/run/depress-worker"
readonly log_dir="/var/log/depress-day10"
readonly artifact_dir="${staging_root}/artifacts"
readonly test_results_dir="${staging_root}/test-results"
readonly signup_probe_email="day10-signup-probe@invalid.test"

# shellcheck disable=SC1091
source /mnt/d/depress/e2e/day10/provision-staging.sh

readonly -a app_units=(
  "depress-web-day10.service"
  "depress-api.service"
  "depress-outbox.service"
  "depress-pointer-worker.service"
  "depress-nginx-day10.service"
)
readonly -a infrastructure_units=(
  "postgresql@16-main.service"
  "depress-redis-day10.service"
  "depress-minio-day10.service"
)

runner_mode="${1:-}"
started_units=()
database_created=0
database_role_created=0
release_created=0
cleanup_started=0

usage() {
  echo "usage: run-staging.sh cleanup-proof|diagnose|focused|d10-010|remaining|preflight|single-insertion|stability|full|verify-clean" >&2
  exit 64
}

is_allowed_cleanup_path() {
  case "$1" in
    "$release_dir"|"$redis_data"|"$minio_data"|"$mc_config"|"$worker_runtime"|"$log_dir"|"$artifact_dir"|"$test_results_dir")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

clear_directory() {
  local target="$1"
  is_allowed_cleanup_path "$target" || {
    echo "refusing cleanup path: $target" >&2
    return 70
  }
  [[ "$(readlink -m -- "$target")" == "$target" ]] || {
    echo "refusing unresolved cleanup path: $target" >&2
    return 70
  }
  if [[ -d "$target" ]]; then
    find "$target" -depth -mindepth 1 -delete
  fi
}

remove_release() {
  if [[ -L "$current_link" && "$(readlink -f -- "$current_link")" == "$release_dir" ]]; then
    rm -- "$current_link"
  fi
  if [[ -d "$release_dir" ]]; then
    clear_directory "$release_dir"
    rmdir "$release_dir"
  fi
}

start_tracked_unit() {
  local unit="$1"
  if systemctl is-active --quiet "$unit"; then
    echo "refusing pre-existing active unit: $unit" >&2
    return 71
  fi
  systemctl start "$unit"
  started_units+=("$unit")
}

was_started() {
  local candidate="$1" tracked
  for tracked in "${started_units[@]}"; do
    [[ "$tracked" == "$candidate" ]] && return 0
  done
  return 1
}

wait_for_http() {
  local url="$1"
  for _ in $(seq 1 120); do
    curl --fail --silent --show-error --insecure "$url" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  echo "timed out waiting for health endpoint" >&2
  return 1
}

restore_failure_controls() {
  rm -f -- /etc/systemd/system/depress-pointer-worker.service.d/failure.conf
  if [[ -d /opt/depress-day10-failure-bin ]]; then
    find /opt/depress-day10-failure-bin -depth -mindepth 1 -delete
    rmdir /opt/depress-day10-failure-bin
  fi
  systemctl daemon-reload

  if systemctl is-active --quiet depress-minio-day10.service && [[ -f "${config_dir}/worker.env" ]]; then
    local worker_key
    worker_key="$(sed -n 's/^S3_ACCESS_KEY_ID=//p' "${config_dir}/worker.env")"
    MC_CONFIG_DIR="$mc_config" mc admin policy attach day10 day10-worker \
      --user "$worker_key" >/dev/null 2>&1 || true
  fi
}

remove_final_secrets() {
  local file
  for file in \
    "${config_dir}/api.env" \
    "${config_dir}/migration.env" \
    "${config_dir}/minio-root.env" \
    "${config_dir}/outbox.env" \
    "${config_dir}/seed-a.env" \
    "${config_dir}/seed-b.env" \
    "${config_dir}/tls.key" \
    "${config_dir}/worker.env" \
    "${staging_root}/e2e.env"; do
    rm -f -- "$file"
  done
}

cleanup() {
  local exit_status="$?"
  (( cleanup_started == 0 )) || exit "$exit_status"
  cleanup_started=1
  trap - EXIT INT TERM
  set +e

  restore_failure_controls

  local index unit
  for ((index=${#app_units[@]} - 1; index >= 0; index--)); do
    unit="${app_units[$index]}"
    was_started "$unit" && systemctl stop "$unit"
  done

  if (( database_created == 1 )) && systemctl is-active --quiet postgresql@16-main.service; then
    runuser -u postgres -- dropdb --if-exists --force depress_day10
  fi
  if (( database_role_created == 1 )) && systemctl is-active --quiet postgresql@16-main.service; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 \
      -c "DROP ROLE IF EXISTS depress_day10" >/dev/null
  fi

  for ((index=${#infrastructure_units[@]} - 1; index >= 0; index--)); do
    unit="${infrastructure_units[$index]}"
    was_started "$unit" && systemctl stop "$unit"
  done

  clear_directory "$worker_runtime"
  clear_directory "$redis_data"
  clear_directory "$minio_data"
  clear_directory "$mc_config"
  clear_directory "$log_dir"
  clear_directory "$artifact_dir"
  if [[ "$runner_mode" != "diagnose" &&
    ! ( "$runner_mode" =~ ^(d10-010|remaining|stability)$ && "$exit_status" -ne 0 ) ]]; then
    clear_directory "$test_results_dir"
  fi

  if (( release_created == 1 )); then
    remove_release
  fi
  rm -f -- "$release_archive"
  remove_day10_staging_config

  echo "cleanup-result=complete units=${#started_units[@]} database=$database_created role=$database_role_created release=$release_created ports=closed runtime=clean artifacts=removed"
  exit "$exit_status"
}

handle_signal() {
  local status="$1"
  exit "$status"
}

verify_clean() {
  local failed=0 unit
  for unit in "${app_units[@]}" "${infrastructure_units[@]}"; do
    if systemctl is-active --quiet "$unit"; then
      echo "active-unit=$unit"
      failed=1
    fi
  done
  if ss -lnt | awk '/:5432 |:16379 |:18443 |:19000 |:19001 / {found=1} END {exit !found}'; then
    echo "day10-listener=present"
    failed=1
  fi
  if find "$worker_runtime" -mindepth 1 -print -quit 2>/dev/null | grep -q .; then
    echo "worker-runtime=not-clean"
    failed=1
  fi
  if ps -eo args= | awk '/pnpm --dir \/opt\/depress\/current|nginx.*\/etc\/depress-day10|redis-server.*16379|minio.*19000|postgres.*depress_day10/ && !/awk/ {found=1} END {exit !found}'; then
    echo "day10-process=present"
    failed=1
  fi
  if docker ps -a --format '{{.Names}}' | grep -q 'day10'; then
    echo "day10-container=present"
    failed=1
  fi
  if docker volume ls --format '{{.Name}}' | grep -q 'day10'; then
    echo "day10-volume=present"
    failed=1
  fi
  if docker network ls --format '{{.Name}}' | grep -q 'day10'; then
    echo "day10-network=present"
    failed=1
  fi
  (( failed == 0 )) || return 1
  echo "verify-clean=pass listeners=none processes=none containers=none volumes=none networks=none runtime=clean"
}

prepare_release() {
  cmd.exe /d /s /c \
    "git -C D:\\depress archive --format=tar --output=D:\\depress-day10-wsl\\release-${exact_commit}.tar ${exact_commit}"
  [[ -f "$release_archive" ]] || return 1
  [[ ! -e "$current_link" && ! -d "$release_dir" ]] || {
    echo "stale release path exists" >&2
    return 1
  }
  install -d -m 0755 "${release_root}/releases" "$release_dir"
  release_created=1
  (
    umask 022
    tar -xf "$release_archive" -C "$release_dir"
    printf '%s\n' "$exact_commit" > "${release_dir}/.depress-release"
    /usr/local/bin/pnpm --dir "$release_dir" install --frozen-lockfile
    DEPRESS_API_ORIGIN="http://127.0.0.1:13001" \
      /usr/local/bin/pnpm --dir "$release_dir" build
  )
  ln -s "$release_dir" "$current_link"
}

prepare_database() {
  start_tracked_unit postgresql@16-main.service
  runuser -u postgres -- dropdb --if-exists --force depress_day10
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 \
    -c "DROP ROLE IF EXISTS depress_day10" >/dev/null
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE depress_day10 LOGIN PASSWORD '${day10_database_password}'" >/dev/null
  database_role_created=1
  runuser -u postgres -- createdb --owner=depress_day10 depress_day10
  database_created=1

  (
    set -a
    # shellcheck disable=SC1091
    source "${config_dir}/migration.env"
    set +a
    runuser -u depress-api --preserve-environment -- \
      /usr/local/bin/pnpm --dir "$release_dir" \
      --filter @depress/api db:migrate
  )

  local seed_file
  for seed_file in "${config_dir}/seed-a.env" "${config_dir}/seed-b.env"; do
    set -a
    # shellcheck disable=SC1090
    source "$seed_file"
    set +a
    runuser -u depress-api --preserve-environment -- \
      /usr/local/bin/pnpm --dir "$release_dir" \
      --filter @depress/api auth:seed-mentor
  done
}

prepare_redis() {
  install -d -o depress-redis -g depress-runtime -m 0750 "$redis_data"
  clear_directory "$redis_data"
  start_tracked_unit depress-redis-day10.service
}

prepare_minio() {
  install -d -o depress-s3 -g depress-runtime -m 0750 "$minio_data"
  install -d -o root -g root -m 0700 "$mc_config"
  clear_directory "$minio_data"
  clear_directory "$mc_config"
  start_tracked_unit depress-minio-day10.service
  wait_for_http "http://127.0.0.1:19000/minio/health/ready"

  (
    set -a
    # shellcheck disable=SC1091
    source "${config_dir}/minio-root.env"
    # shellcheck disable=SC1091
    source "${config_dir}/worker.env"
    set +a

    MC_CONFIG_DIR="$mc_config" mc alias set day10 http://127.0.0.1:19000 \
      "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    MC_CONFIG_DIR="$mc_config" mc mb --ignore-existing day10/depress-day10-artifacts >/dev/null
    MC_CONFIG_DIR="$mc_config" mc admin user add day10 \
      "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
    MC_CONFIG_DIR="$mc_config" mc admin policy create day10 day10-worker \
      "${config_dir}/worker-s3-policy.json" >/dev/null
    MC_CONFIG_DIR="$mc_config" mc admin policy attach day10 day10-worker \
      --user "$S3_ACCESS_KEY_ID" >/dev/null
  )
}

start_application() {
  local unit
  for unit in "${app_units[@]}"; do
    start_tracked_unit "$unit"
  done
  wait_for_http "https://127.0.0.1:18443/health/ready"
}

run_playwright() {
  local mode="$1"
  local trace_mode="${2:-off}"
  cmd.exe /d /s /c \
    "set DAY10_MODE=${mode}&&set DAY10_TRACE=${trace_mode}&&cd /d D:\\depress&&pnpm test:e2e:day10"
}

run_focused_playwright() {
  local events_file="${artifact_dir}/focused-sandbox-events.log"
  install -d -m 0700 "$artifact_dir"
  docker events \
    --filter type=container \
    --filter label=com.depress.managed=true \
    --filter label=com.depress.component=typst-sandbox \
    --format '{{.Action}} {{.Actor.ID}}' > "$events_file" &
  local events_pid="$!"
  sleep 0.25

  local playwright_status=0
  set +e
  run_playwright focused
  playwright_status="$?"
  set -e

  kill "$events_pid" 2>/dev/null || true
  wait "$events_pid" 2>/dev/null || true
  (( playwright_status == 0 )) || return "$playwright_status"

  local created_id
  created_id="$(awk '$1 == "create" { print $2 }' "$events_file" | sort -u)"
  [[ "$created_id" =~ ^[0-9a-f]{64}$ ]]
  [[ "$(awk -v id="$created_id" '$1 == "create" && $2 == id { count++ } END { print count + 0 }' "$events_file")" == "1" ]]
  [[ "$(awk -v id="$created_id" '$1 == "destroy" && $2 == id { count++ } END { print count + 0 }' "$events_file")" == "1" ]]
  ! docker container inspect "$created_id" >/dev/null 2>&1
  echo "sandbox-container-lifecycle=pass id-recorded=yes exact-destroy=yes remaining=0"
}

case "$runner_mode" in
  verify-clean)
    verify_clean
    exit 0
    ;;
  cleanup-proof|diagnose|focused|d10-010|remaining|preflight|single-insertion|stability|full)
    ;;
  *)
    usage
    ;;
esac

verify_clean
clear_directory "$test_results_dir"
clear_directory "$artifact_dir"
trap cleanup EXIT
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

provision_day10_staging
prepare_release
prepare_redis
prepare_minio
prepare_database
/bin/bash /mnt/d/depress/e2e/day10/worker-preflight.sh independent
start_application

if [[ "$runner_mode" == "preflight" || "$runner_mode" == "focused" || "$runner_mode" == "full" ]]; then
  /bin/bash /mnt/d/depress/e2e/day10/worker-preflight.sh idle
fi

[[ "$(cat "${current_link}/.depress-release")" == "$exact_commit" ]]
echo "staging-ready commit=${exact_commit} mode=${runner_mode}"

if [[ "$runner_mode" == "cleanup-proof" ]]; then
  echo "controlled-preflight-failure=triggered" >&2
  exit 97
fi

case "$runner_mode" in
  diagnose)
    run_playwright diagnose retain-on-failure
    ;;
  focused)
    run_focused_playwright
    ;;
  d10-010|remaining)
    run_playwright "$runner_mode" retain-on-failure
    ;;
  stability)
    run_playwright stability retain-on-failure
    ;;
  single-insertion)
    run_playwright single-insertion
    ;;
  *)
    run_playwright "$runner_mode"
    ;;
esac
