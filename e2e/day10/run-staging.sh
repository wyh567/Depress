#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# shellcheck disable=SC1091
source /mnt/d/depress/e2e/day10/candidate-gate.sh
# shellcheck disable=SC1091
source /mnt/d/depress/e2e/day10/identity-topology.sh

readonly runner_mode="${1:-}"
readonly exact_commit="${2:-}"
readonly expected_parent="${3:-}"
readonly source_dir="${4:-}"
readonly residue_classification="${5:-}"
readonly approved_changed_files_file="${DAY10_EXPECTED_CHANGED_FILES_FILE:-}"
readonly source_branch="feature/phase4-mentor-mvp"
readonly staging_root="/mnt/d/depress-day10-wsl"
readonly release_archive="${staging_root}/release-${exact_commit}.tar"
readonly release_root="/opt/depress"
readonly release_dir="${release_root}/releases/${exact_commit}"
readonly current_link="${release_root}/current"
readonly config_dir="/etc/depress-day10"
readonly state_root="/var/lib/depress-day10"
readonly postgres_state_file="${state_root}/postgres-harness.state"
readonly postgres_port=15432
readonly postgres_compose_file="${config_dir}/postgres-compose.yml"
readonly postgres_env_file="${config_dir}/postgres.env"
readonly postgres_compose_project="depress-day10-${runner_mode}-${exact_commit:0:12}"
readonly postgres_image="postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
readonly redis_data="${state_root}/redis"
readonly minio_data="${state_root}/minio"
readonly mc_config="${state_root}/mc-root"
readonly worker_runtime="$day10_worker_runtime"
readonly log_dir="/var/log/depress-day10"
readonly artifact_dir="${staging_root}/artifacts"
readonly test_results_dir="${staging_root}/test-results"
readonly signup_probe_email="day10-signup-probe@invalid.test"
readonly observability_root="/var/tmp/depress-day10-runs"
readonly run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}"
readonly migration_runtime="/run/depress-day10-migration-${run_id}"
readonly migration_runtime_state_file="${state_root}/migration-runtime-${run_id}.state"
readonly run_dir="${observability_root}/${run_id}"
readonly run_state_file="${run_dir}/state.log"
readonly run_log_file="${run_dir}/runner.log"
readonly identity_state_file="${state_root}/identities-${run_id}.state"
readonly run_log_limit_bytes=$((16 * 1024 * 1024))

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
  "depress-redis-day10.service"
  "depress-minio-day10.service"
)
readonly -a selected_ports=(13000 13001 15432 16379 18443 19000 19001)

started_units=()
database_created=0
database_role_created=0
database_started=0
postgres_container_id=""
release_created=0
cleanup_started=0
cleanup_trigger=""
current_phase="initializing"
first_failure_code=""
terminating_signal="NONE"
playwright_spawned="no"
playwright_launcher_pid=""
logger_pid=""
runner_parent_pid="$PPID"

usage() {
  echo "usage: DAY10_EXPECTED_CHANGED_FILES_FILE=/external/approved.txt run-staging.sh candidate-preflight|cleanup-proof|database-gate|diagnose|focused|d10-010|observability-nonzero-probe|observability-success-probe|observability-term-probe|remaining|preflight|single-insertion|smoke|stability|full|verify-clean <40-character-candidate-sha> <40-character-parent-sha> <clean-source-directory> <residue-classification>" >&2
  exit 64
}

timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

record_state() {
  local key="$1"
  local value="${2//$'\r'/_}"
  value="${value//$'\n'/_}"
  printf '%s=%s\n' "$key" "$value" >> "$run_state_file"
}

stream_logger() {
  local log_file="$1"
  local byte_count=0
  local line line_bytes
  local truncated=0
  local marker="[durable-log-truncated-at-${run_log_limit_bytes}-bytes]"
  local payload_limit=$((run_log_limit_bytes - ${#marker} - 1))
  LC_ALL=C
  trap '' PIPE

  while IFS= read -r line || [[ -n "$line" ]]; do
    line_bytes=$((${#line} + 1))
    if (( byte_count + line_bytes <= payload_limit )); then
      printf '%s\n' "$line" >> "$log_file"
      byte_count=$((byte_count + line_bytes))
    elif (( truncated == 0 )); then
      printf '%s\n' "$marker" >> "$log_file"
      truncated=1
    fi
    printf '%s\n' "$line" >&9 2>/dev/null || :
  done
}

initialize_observability() {
  local runner_sid parent_comm
  install -d -m 0700 "$observability_root"
  mkdir -m 0700 "$run_dir"
  : > "$run_state_file"
  : > "$run_log_file"
  chmod 0600 "$run_state_file" "$run_log_file"

  runner_sid="$(ps -o sid= -p "$$" | tr -d ' ')"
  parent_comm="$(ps -o comm= -p "$runner_parent_pid" | tr -d ' ')"
  record_state run_id "$run_id"
  record_state runner_pid "$$"
  record_state runner_ppid "$runner_parent_pid"
  record_state runner_sid "$runner_sid"
  record_state parent_comm "${parent_comm:-unavailable}"
  record_state started_at "$(timestamp)"
  record_state current_phase "$current_phase"
  record_state playwright_spawned "$playwright_spawned"
  record_state terminating_signal "$terminating_signal"

  local stream_fifo="${run_dir}/stream.fifo"
  mkfifo -m 0600 "$stream_fifo"
  exec 9>&1
  stream_logger "$run_log_file" < "$stream_fifo" &
  logger_pid="$!"
  exec > "$stream_fifo" 2>&1
  rm -f -- "$stream_fifo"
  record_state logger_pid "$logger_pid"
  echo "observability-run-id=${run_id} runner-pid=$$"
}

phase_begin() {
  current_phase="$1"
  record_state current_phase "$current_phase"
  record_state phase_start "$(timestamp)"
  record_state "phase_${current_phase}_start" "$(timestamp)"
  echo "phase-start=${current_phase}"
}

phase_end() {
  local phase="$1"
  record_state phase_end "$(timestamp)"
  record_state "phase_${phase}_end" "$(timestamp)"
  echo "phase-end=${phase}"
}

run_phase() {
  local phase="$1"
  shift
  phase_begin "$phase"
  "$@"
  phase_end "$phase"
}

handle_err() {
  local status="$?"
  if [[ -z "$first_failure_code" ]]; then
    first_failure_code="$status"
    cleanup_trigger="ERR"
    record_state first_failure_code "$first_failure_code"
    record_state first_failure_phase "$current_phase"
    record_state first_failure_at "$(timestamp)"
    record_state cleanup_trigger "$cleanup_trigger"
  fi
  return "$status"
}

is_allowed_cleanup_path() {
  case "$1" in
    "$release_dir"|"$redis_data"|"$minio_data"|"$mc_config"|"$worker_runtime"|"$migration_runtime"|"$log_dir"|"$artifact_dir"|"$test_results_dir")
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

stop_disposable_postgres() {
  (( database_started == 1 )) || return 0
  [[ -f "$postgres_state_file" && -f "$postgres_compose_file" ]] || {
    echo "refusing PostgreSQL cleanup without exact state and Compose files" >&2
    return 70
  }
  grep -Fxq "candidate=${exact_commit}" "$postgres_state_file" || {
    echo "refusing PostgreSQL cleanup after candidate ownership changed" >&2
    return 70
  }
  grep -Fxq "project=${postgres_compose_project}" "$postgres_state_file" || {
    echo "refusing PostgreSQL cleanup after Compose ownership changed" >&2
    return 70
  }

  local candidate_label project_label component_label
  if [[ -n "$postgres_container_id" ]] &&
    docker container inspect "$postgres_container_id" >/dev/null 2>&1; then
    candidate_label="$(
      docker container inspect --format \
        '{{ index .Config.Labels "com.depress.candidate" }}' \
        "$postgres_container_id"
    )"
    project_label="$(
      docker container inspect --format \
        '{{ index .Config.Labels "com.docker.compose.project" }}' \
        "$postgres_container_id"
    )"
    component_label="$(
      docker container inspect --format \
        '{{ index .Config.Labels "com.depress.component" }}' \
        "$postgres_container_id"
    )"
    [[ "$candidate_label" == "$exact_commit" &&
      "$project_label" == "$postgres_compose_project" &&
      "$component_label" == "day10-postgres" ]] || {
      echo "refusing PostgreSQL cleanup after container labels changed" >&2
      return 70
    }
  fi

  docker compose \
    -p "$postgres_compose_project" \
    -f "$postgres_compose_file" \
    down --volumes --remove-orphans --timeout 15
  [[ -z "$(
    docker ps -aq \
      --filter "label=com.docker.compose.project=${postgres_compose_project}"
  )" ]]
  [[ -z "$(
    docker volume ls -q \
      --filter "label=com.docker.compose.project=${postgres_compose_project}"
  )" ]]
  [[ -z "$(
    docker network ls -q \
      --filter "label=com.docker.compose.project=${postgres_compose_project}"
  )" ]]
  database_started=0
  rm -f -- "$postgres_state_file"
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
    "$postgres_env_file" \
    "${config_dir}/seed-a.env" \
    "${config_dir}/seed-b.env" \
    "${config_dir}/tls/tls.key" \
    "${config_dir}/worker.env" \
    "${staging_root}/e2e.env"; do
    rm -f -- "$file"
  done
}

cleanup() {
  local trap_status="$?"
  local original_exit_status="${first_failure_code:-$trap_status}"
  (( cleanup_started == 0 )) || exit "$original_exit_status"
  cleanup_started=1
  trap - ERR EXIT HUP INT TERM
  set +e

  if [[ -z "$cleanup_trigger" ]]; then
    if ! kill -0 "$runner_parent_pid" 2>/dev/null; then
      cleanup_trigger="PARENT_LOSS"
    else
      cleanup_trigger="EXIT"
    fi
  fi
  record_state cleanup_trigger "$cleanup_trigger"
  record_state original_exit_code "$original_exit_status"
  record_state terminating_signal "$terminating_signal"
  record_state cleanup_start "$(timestamp)"
  echo "cleanup-start trigger=${cleanup_trigger} original-exit=${original_exit_status}"

  if [[ -n "$playwright_launcher_pid" ]] &&
    kill -0 "$playwright_launcher_pid" 2>/dev/null; then
    kill -TERM "$playwright_launcher_pid" 2>/dev/null
    wait "$playwright_launcher_pid" 2>/dev/null
  fi

  restore_failure_controls

  local index unit
  for ((index=${#app_units[@]} - 1; index >= 0; index--)); do
    unit="${app_units[$index]}"
    was_started "$unit" && systemctl stop "$unit"
  done

  local postgres_cleanup_complete=1
  if (( database_started == 1 )); then
    stop_disposable_postgres || postgres_cleanup_complete=0
  fi

  for ((index=${#infrastructure_units[@]} - 1; index >= 0; index--)); do
    unit="${infrastructure_units[$index]}"
    was_started "$unit" && systemctl stop "$unit"
  done

  clear_directory "$worker_runtime"
  local migration_runtime_cleanup_complete=1
  remove_migration_runtime || migration_runtime_cleanup_complete=0
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
  local config_cleanup_complete=1
  local identity_cleanup_complete=1
  remove_day10_staging_config || config_cleanup_complete=0
  if (( config_cleanup_complete == 1 )); then
    remove_day10_private_identities || identity_cleanup_complete=0
  else
    identity_cleanup_complete=0
  fi

  local final_exit_status="$original_exit_status"
  local final_result="FAILURE"
  if (( postgres_cleanup_complete == 0 ||
    migration_runtime_cleanup_complete == 0 ||
    config_cleanup_complete == 0 ||
    identity_cleanup_complete == 0 )); then
    echo "cleanup-result=partial postgres=${postgres_cleanup_complete} migration-runtime=${migration_runtime_cleanup_complete} config=${config_cleanup_complete} identities=${identity_cleanup_complete}" >&2
    if (( final_exit_status == 0 )); then
      final_exit_status=70
    fi
  else
    echo "cleanup-result=complete units=${#started_units[@]} database=$database_created role=$database_role_created postgres-container=${postgres_container_id:-none} project=${postgres_compose_project} release=$release_created ports=closed runtime=clean migration-runtime=removed artifacts=removed"
  fi
  if (( final_exit_status == 0 )); then
    final_result="SUCCESS"
  fi
  record_state cleanup_end "$(timestamp)"
  record_state final_result "$final_result"
  record_state final_exit_code "$final_exit_status"
  echo "cleanup-end final-result=${final_result} final-exit=${final_exit_status}"

  exec 1>&9 2>&1
  wait "$logger_pid" 2>/dev/null
  exec 9>&-
  exit "$final_exit_status"
}

handle_signal() {
  local signal_name="$1"
  local status="$2"
  terminating_signal="$signal_name"
  cleanup_trigger="$signal_name"
  if [[ -z "$first_failure_code" ]]; then
    first_failure_code="$status"
  fi
  record_state terminating_signal "$terminating_signal"
  record_state signal_at "$(timestamp)"
  record_state cleanup_trigger "$cleanup_trigger"
  exit "$status"
}

verify_clean() {
  local failed=0 unit identity
  for unit in "${app_units[@]}" "${infrastructure_units[@]}"; do
    if systemctl is-active --quiet "$unit"; then
      echo "active-unit=$unit"
      failed=1
    fi
  done
  if ss -lnt | awk '/:13000 |:13001 |:15432 |:16379 |:18443 |:19000 |:19001 / {found=1} END {exit !found}'; then
    echo "day10-listener=present"
    failed=1
  fi
  if find "$worker_runtime" -mindepth 1 -print -quit 2>/dev/null | grep -q .; then
    echo "worker-runtime=not-clean"
    failed=1
  fi
  if find /run -maxdepth 1 \( -type d -o -type l \) \
    -name 'depress-day10-migration-*' -print -quit 2>/dev/null | grep -q .; then
    echo "migration-runtime=present"
    failed=1
  fi
  if find "$state_root" -maxdepth 1 \( -type f -o -type l \) \
    -name 'migration-runtime-*.state' -print -quit 2>/dev/null | grep -q .; then
    echo "migration-runtime-marker=present"
    failed=1
  fi
  if ps -eo args= | awk '/pnpm --dir \/opt\/depress\/current|nginx.*\/etc\/depress-day10|redis-server.*16379|minio.*19000|postgres.*\/var\/lib\/depress-day10\/postgres/ && !/awk/ {found=1} END {exit !found}'; then
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
  for identity in "${day10_private_users[@]}"; do
    if id "$identity" >/dev/null 2>&1; then
      echo "day10-user=present"
      failed=1
    fi
  done
  for identity in "${day10_private_groups[@]}"; do
    if getent group "$identity" >/dev/null 2>&1; then
      echo "day10-group=present"
      failed=1
    fi
  done
  if [[ -e "$config_dir" || -L "$config_dir" ]]; then
    echo "day10-config=present"
    failed=1
  fi
  (( failed == 0 )) || return 1
  echo "verify-clean=pass listeners=none processes=none containers=none volumes=none networks=none identities=none runtime=clean"
}

preflight_candidate() {
  [[ "$exact_commit" =~ ^[0-9a-f]{40}$ ]] || {
    echo "candidate SHA must be exactly 40 lowercase hexadecimal characters" >&2
    return 64
  }
  [[ "$expected_parent" =~ ^[0-9a-f]{40}$ ]] || {
    echo "parent SHA must be exactly 40 lowercase hexadecimal characters" >&2
    return 64
  }
  [[ -n "$source_dir" && -e "${source_dir}/.git" ]] || {
    echo "clean source directory is required" >&2
    return 64
  }
  [[ "$(readlink -m -- "$source_dir")" == "$source_dir" ]] || {
    echo "source directory must be canonical" >&2
    return 64
  }
  [[ "$source_dir" == "${staging_root}/candidate-${exact_commit}" ]] || {
    echo "source directory must be the exact candidate worktree" >&2
    return 64
  }
  [[ "$residue_classification" != "UNKNOWN_OWNERSHIP" ]] || {
    echo "refusing rehearsal with unknown resource ownership" >&2
    return 72
  }
  [[ "$residue_classification" == "SYSTEM_POSTGRES_SERVICE" ]] || {
    echo "unexpected residue classification for this rehearsal" >&2
    return 72
  }

  [[ -n "$approved_changed_files_file" &&
    "$approved_changed_files_file" == /* &&
    -f "$approved_changed_files_file" &&
    ! -L "$approved_changed_files_file" ]] || {
    echo "an external approved changed-files manifest is required" >&2
    return 64
  }

  local manifest_real source_real release_real config_real staging_real
  manifest_real="$(readlink -f -- "$approved_changed_files_file")"
  source_real="$(readlink -f -- "$source_dir")"
  release_real="$(readlink -m -- "$release_root")"
  config_real="$(readlink -m -- "$config_dir")"
  staging_real="$(readlink -m -- "$staging_root")"
  [[ "$manifest_real" != "$source_real" &&
    "$manifest_real" != "$source_real/"* &&
    "$manifest_real" != "$release_real" &&
    "$manifest_real" != "$release_real/"* &&
    "$manifest_real" != "$config_real" &&
    "$manifest_real" != "$config_real/"* &&
    "$manifest_real" != "$staging_real" &&
    "$manifest_real" != "$staging_real/"* ]] || {
    echo "approved manifest must be outside source, staging, config, and release paths" >&2
    return 64
  }

  local local_head remote_head actual_parent parent_line windows_source
  windows_source="$(wslpath -w "$source_dir")"
  local_head="$(
    cmd.exe /d /s /c "git -C ${windows_source} rev-parse HEAD" |
      tr -d '\r'
  )"
  remote_head="$(
    cmd.exe /d /s /c \
      "git -C ${windows_source} ls-remote --exit-code origin refs/heads/${source_branch}" |
      tr -d '\r' |
      awk 'NR == 1 { print $1 }'
  )"
  parent_line="$(
    cmd.exe /d /s /c \
      "git -C ${windows_source} rev-list --parents -n 1 ${exact_commit}" |
      tr -d '\r'
  )"
  [[ "$(awk '{ print NF }' <<< "$parent_line")" == "2" ]] || {
    echo "candidate must have exactly one parent" >&2
    return 64
  }
  actual_parent="$(awk '{ print $2 }' <<< "$parent_line")"
  [[ -z "$(
    cmd.exe /d /s /c \
      "git -C ${windows_source} status --porcelain --untracked-files=all" |
      tr -d '\r'
  )" ]]
  [[ "$local_head" == "$exact_commit" ]]
  [[ "$remote_head" == "$exact_commit" ]]
  [[ "$actual_parent" == "$expected_parent" ]]

  local actual_nul="${run_dir}/actual-changed-files.nul"
  local actual_manifest="${run_dir}/actual-changed-files.txt"
  local path manifest_status
  local -a changed_files=()
  cmd.exe /d /s /c \
    "git -C ${windows_source} diff --name-only -z ${expected_parent} ${exact_commit}" \
    > "$actual_nul"
  while IFS= read -r -d '' path; do
    changed_files+=("$path")
  done < "$actual_nul"
  rm -f -- "$actual_nul"
  if (( ${#changed_files[@]} == 0 )); then
    : > "$actual_manifest"
  else
    printf '%s\n' "${changed_files[@]}" |
      LC_ALL=C sort > "$actual_manifest"
  fi
  if validate_changed_files_manifest \
    "$manifest_real" "$actual_manifest"; then
    rm -f -- "$actual_manifest"
  else
    manifest_status=$?
    rm -f -- "$actual_manifest"
    return "$manifest_status"
  fi

  local port
  for port in "${selected_ports[@]}"; do
    ! ss -H -lnt "sport = :${port}" | grep -q .
  done
  [[ "$release_dir" == *"$exact_commit"* ]]
  [[ "$config_real" != "$source_real" &&
    "$config_real" != "$source_real/"* &&
    "$release_real" != "$source_real" &&
    "$release_real" != "$source_real/"* &&
    "$(readlink -m -- "$release_archive")" != "$source_real/"* ]]

  echo "preflight=pass clean-source=yes local=${local_head} remote=${remote_head} parent=${actual_parent} ports=free ownership=${residue_classification} release=${release_dir} secrets=external"
}

verify_release_archive_fidelity() {
  local verification_dir="${run_dir}/archive-fidelity"
  local archive_list="${verification_dir}/archive.list"
  local path normalized blob_file archive_file archive_sha
  local -a shell_paths=(
    "deploy/release.sh"
    "deploy/migrate.sh"
    "deploy/verify-env-permissions.sh"
    "e2e/day10/run-staging.sh"
    "e2e/day10/provision-staging.sh"
  )

  install -d -m 0700 "$verification_dir"
  tar -tf "$release_archive" > "$archive_list"
  while IFS= read -r path; do
    normalized=${path%/}
    case "/${normalized}/" in
      */.git/*|*/node_modules/*|*/.next/*|*/.turbo/*)
        echo "release archive contains a forbidden repository or build path" >&2
        return 1
        ;;
    esac
    if [[ -n "$normalized" ]] && candidate_path_is_sensitive "$normalized"; then
      echo "release archive contains a forbidden secret-like filename" >&2
      return 1
    fi
  done < "$archive_list"

  for path in "${shell_paths[@]}"; do
    blob_file="${verification_dir}/blob-$RANDOM"
    archive_file="${verification_dir}/archive-$RANDOM"
    git -c safe.directory="$source_dir" -C "$source_dir" \
      cat-file blob "${exact_commit}:${path}" > "$blob_file"
    tar -xOf "$release_archive" "$path" > "$archive_file"
    cmp -s "$blob_file" "$archive_file" || {
      echo "release archive differs from a Git blob" >&2
      return 1
    }
    bash -n "$archive_file"
    rm -f -- "$blob_file" "$archive_file"
  done
  archive_sha="$(sha256sum "$release_archive" | awk '{ print $1 }')"
  find "$verification_dir" -depth -mindepth 1 -delete
  rmdir "$verification_dir"
  echo "archive-byte-fidelity=PASS files=${#shell_paths[@]} sha256=${archive_sha}"
}

prepare_release() {
  local windows_source windows_archive
  windows_source="$(wslpath -w "$source_dir")"
  windows_archive="$(wslpath -w "$release_archive")"
  cmd.exe /d /s /c \
    "git -C ${windows_source} -c core.autocrlf=false -c core.eol=lf archive --format=tar --output=${windows_archive} ${exact_commit}"
  [[ -f "$release_archive" ]] || return 1
  verify_release_archive_fidelity
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
  install -d -m 0755 "$state_root"
  printf '%s\n' \
    "POSTGRES_DB=depress_day10" \
    "POSTGRES_USER=depress_day10" \
    "POSTGRES_PASSWORD=${day10_database_password}" \
    "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256" \
    > "$postgres_env_file"
  chmod 0600 "$postgres_env_file"

  cat > "$postgres_compose_file" <<COMPOSE
services:
  postgres:
    image: ${postgres_image}
    pull_policy: never
    labels:
      com.depress.managed: "true"
      com.depress.component: "day10-postgres"
      com.depress.candidate: "${exact_commit}"
    env_file:
      - ${postgres_env_file}
    ports:
      - "127.0.0.1:${postgres_port}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U depress_day10 -d depress_day10"]
      interval: 1s
      timeout: 3s
      retries: 60
      start_period: 2s
volumes:
  postgres-data:
    labels:
      com.depress.managed: "true"
      com.depress.component: "day10-postgres"
      com.depress.candidate: "${exact_commit}"
networks:
  default:
    labels:
      com.depress.managed: "true"
      com.depress.component: "day10-postgres"
      com.depress.candidate: "${exact_commit}"
COMPOSE
  chmod 0600 "$postgres_compose_file"
  printf '%s\n' \
    "candidate=${exact_commit}" \
    "project=${postgres_compose_project}" \
    "port=${postgres_port}" \
    "compose=${postgres_compose_file}" \
    > "$postgres_state_file"
  chmod 0600 "$postgres_state_file"
  database_started=1

  docker compose \
    -p "$postgres_compose_project" \
    -f "$postgres_compose_file" \
    up -d --wait --wait-timeout 60 --no-build --pull never postgres
  postgres_container_id="$(
    docker compose \
      -p "$postgres_compose_project" \
      -f "$postgres_compose_file" \
      ps -q postgres
  )"
  [[ "$postgres_container_id" =~ ^[0-9a-f]{64}$ ]]
  printf '%s\n' \
    "container=${postgres_container_id}" \
    >> "$postgres_state_file"
  [[ "$(
    docker container inspect --format \
      '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' \
      "$postgres_container_id"
  )" == "healthy" ]]
  [[ "$(docker container port "$postgres_container_id" 5432/tcp)" == "127.0.0.1:${postgres_port}" ]]

  [[ "$(
    PGPASSWORD="$day10_database_password" psql \
      --host=127.0.0.1 \
      --port="$postgres_port" \
      --username=depress_day10 \
      --dbname=depress_day10 \
      --no-password \
      --tuples-only \
      --no-align \
      --command='SELECT current_database()'
  )" == "depress_day10" ]]
  database_role_created=1
  database_created=1

  local migration_first migration_rerun
  migration_first="$(
    DEPRESS_ROOT="$release_root" \
      MIGRATION_ENV_FILE="${config_dir}/migration.env" \
      MIGRATION_USER="$day10_migration_user" \
      MIGRATION_RUNTIME_DIR="$migration_runtime" \
      COREPACK_BIN=/usr/local/bin/corepack \
      bash "${release_dir}/deploy/migrate.sh"
  )"
  [[ "$migration_first" == *"Applied 5 migration(s)"* ]]
  echo "migration-first=Applied 5 migration(s)"
  migration_rerun="$(
    DEPRESS_ROOT="$release_root" \
      MIGRATION_ENV_FILE="${config_dir}/migration.env" \
      MIGRATION_USER="$day10_migration_user" \
      MIGRATION_RUNTIME_DIR="$migration_runtime" \
      COREPACK_BIN=/usr/local/bin/corepack \
      bash "${release_dir}/deploy/migrate.sh"
  )"
  [[ "$migration_rerun" == *"Applied 0 migration(s)"* ]]
  echo "migration-rerun=Applied 0 migration(s)"

  if [[ "$runner_mode" != "database-gate" ]]; then
    local seed_file
    for seed_file in "${config_dir}/seed-a.env" "${config_dir}/seed-b.env"; do
      set -a
      # shellcheck disable=SC1090
      source "$seed_file"
      set +a
      runuser -u "$day10_api_user" --preserve-environment -- \
        /usr/local/bin/pnpm --dir "$release_dir" \
        --filter @depress/api auth:seed-mentor
    done
  fi

  echo "postgres-ready project=${postgres_compose_project} container=${postgres_container_id} binding=127.0.0.1:${postgres_port} health=healthy auth=pass"
}

hold_database_health() {
  local events_file="${artifact_dir}/postgres-health-events.log"
  local event_status
  install -d -m 0700 "$artifact_dir"
  set +e
  timeout --signal=TERM 30s docker events \
    --filter "container=${postgres_container_id}" \
    --filter event=die \
    --filter event=health_status \
    --format '{{.Action}}' \
    > "$events_file"
  event_status="$?"
  set -e
  [[ "$event_status" == "124" ]]
  ! grep -Eq '^(die|health_status: unhealthy)$' "$events_file"
  [[ "$(
    docker container inspect --format \
      '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' \
      "$postgres_container_id"
  )" == "healthy" ]]
  echo "postgres-health-window=pass seconds=30"
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

verify_day10_env_permissions() {
  DEPRESS_ENV_DIR="$config_dir" \
    DEPRESS_API_USER="$day10_api_user" \
    DEPRESS_API_GROUP="$day10_api_group" \
    DEPRESS_OUTBOX_USER="$day10_outbox_user" \
    DEPRESS_OUTBOX_GROUP="$day10_outbox_group" \
    DEPRESS_WORKER_USER="$day10_worker_user" \
    DEPRESS_WORKER_GROUP="$day10_worker_group" \
    DEPRESS_MIGRATION_USER="$day10_migration_user" \
    DEPRESS_MIGRATION_GROUP="$day10_migration_group" \
    DEPRESS_DOCKER_GROUP="$day10_docker_group" \
    DEPRESS_WORKER_ENV_FILE="${config_dir}/worker.env" \
    bash "${release_dir}/deploy/verify-env-permissions.sh"
}

run_playwright() {
  local mode="$1"
  local trace_mode="${2:-off}"
  local chromium_assignment=""
  local playwright_status
  if [[ "$mode" == "smoke" ]]; then
    chromium_assignment="set DAY10_CHROMIUM_EXECUTABLE=D:\\depress-day10-wsl\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe&&"
  fi
  set +e
  cmd.exe /d /s /c \
    "${chromium_assignment}set DAY10_MODE=${mode}&&set DAY10_TRACE=${trace_mode}&&set DAY10_CANDIDATE_SHA=${exact_commit}&&cd /d D:\\depress&&pnpm test:e2e:day10" &
  playwright_launcher_pid="$!"
  playwright_spawned="yes"
  record_state playwright_spawned "$playwright_spawned"
  record_state playwright_launcher_pid "$playwright_launcher_pid"
  record_state playwright_spawned_at "$(timestamp)"
  wait "$playwright_launcher_pid"
  playwright_status="$?"
  playwright_launcher_pid=""
  set -e
  record_state playwright_exit_code "$playwright_status"
  record_state playwright_exited_at "$(timestamp)"
  return "$playwright_status"
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

initialize_observability
trap cleanup EXIT
trap handle_err ERR
trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

case "$runner_mode" in
  verify-clean)
    run_phase verify-clean verify_clean
    exit 0
    ;;
  candidate-preflight)
    run_phase candidate-preflight preflight_candidate
    run_phase verify-clean verify_clean
    exit 0
    ;;
  observability-success-probe)
    phase_begin observability-success-probe
    echo "observability-success-probe=pass"
    phase_end observability-success-probe
    exit 0
    ;;
  observability-nonzero-probe)
    phase_begin observability-nonzero-probe
    echo "observability-nonzero-probe=23" >&2
    /bin/bash -c 'exit 23'
    exit 99
    ;;
  observability-term-probe)
    phase_begin observability-term-probe
    echo "observability-term-probe=TERM"
    kill -TERM "$$"
    exit 99
    ;;
  cleanup-proof|database-gate|diagnose|focused|d10-010|remaining|preflight|single-insertion|smoke|stability|full)
    ;;
  *)
    usage
    ;;
esac

run_phase candidate-preflight preflight_candidate
run_phase verify-clean-before verify_clean
phase_begin clear-prior-evidence
clear_directory "$test_results_dir"
clear_directory "$artifact_dir"
phase_end clear-prior-evidence
run_phase provision provision_day10_staging
run_phase migration-runtime-register register_migration_runtime
run_phase prepare-release prepare_release
run_phase env-permission-matrix verify_day10_env_permissions

if [[ "$runner_mode" == "database-gate" ]]; then
  system_postgres_pid_before="$(
    systemctl show postgresql@16-main.service -p MainPID --value
  )"
  [[ "$system_postgres_pid_before" =~ ^[0-9]+$ && "$system_postgres_pid_before" != "0" ]]
  run_phase prepare-database prepare_database
  run_phase database-health-window hold_database_health
  [[ "$(
    systemctl show postgresql@16-main.service -p MainPID --value
  )" == "$system_postgres_pid_before" ]]
  echo "database-gate=pass system-postgres-pid=${system_postgres_pid_before}"
  phase_begin SUCCESS
  phase_end SUCCESS
  exit 0
fi

run_phase prepare-redis prepare_redis
run_phase prepare-minio prepare_minio
run_phase prepare-database prepare_database
run_phase worker-preflight-independent /bin/bash /mnt/d/depress/e2e/day10/worker-preflight.sh independent
run_phase start-application start_application

if [[ "$runner_mode" == "preflight" || "$runner_mode" == "focused" || "$runner_mode" == "full" ]]; then
  run_phase worker-preflight-idle /bin/bash /mnt/d/depress/e2e/day10/worker-preflight.sh idle
fi

[[ "$(cat "${current_link}/.depress-release")" == "$exact_commit" ]]
echo "staging-ready commit=${exact_commit} mode=${runner_mode}"

if [[ "$runner_mode" == "cleanup-proof" ]]; then
  echo "controlled-preflight-failure=triggered" >&2
  exit 97
fi

phase_begin playwright
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
  smoke)
    run_playwright smoke
    ;;
  single-insertion)
    run_playwright single-insertion
    ;;
  *)
    run_playwright "$runner_mode"
    ;;
esac
phase_end playwright
phase_begin SUCCESS
phase_end SUCCESS
exit 0
