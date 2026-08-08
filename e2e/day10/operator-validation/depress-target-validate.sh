#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly validation_type="NON_CANDIDATE_DIRTY_TREE_VALIDATION"
readonly baseline_sha="@@BASELINE_SHA@@"
readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly bundle_sha256="$(tr -d '[:space:]' < "${script_dir}/bundle.sha256")"
readonly validation_id="${bundle_sha256:0:40}"
readonly evidence_dir="${script_dir}/evidence"
readonly raw_dir="${evidence_dir}/root-only-${validation_id}"
readonly durable_evidence="${evidence_dir}/durable-evidence.txt"
readonly evidence_run_id="${evidence_dir}/validation-run-id"
readonly operator_result="${script_dir}/operator-result-${validation_id}.tar.gz"
readonly operator_root="/var/lib/depress-target-validation"
readonly operator_marker="${operator_root}/${validation_id}.marker"
readonly staging_root="/var/tmp/depress-day10-validation"
readonly source_dir="${staging_root}/source-${validation_id}"
readonly source_archive="/var/tmp/depress-validation-source-${validation_id}.tar"
readonly production_env_dir="/etc/depress"
readonly production_release="/opt/depress/releases/${validation_id}"
readonly production_unit="/etc/systemd/system/depress-web.service"
readonly node_version="v22.23.1"
readonly minio_release="RELEASE.2025-04-22T22-12-26Z"
readonly mc_release="RELEASE.2025-04-16T18-13-26Z"
# shellcheck source=deploy/resource-gates.sh
source "${script_dir}/depress-resource-gates.sh"
# shellcheck source=e2e/day10/operator-validation/mode-manifest.sh
source "${script_dir}/depress-mode-manifest.sh"

sampler_pid=""
current_stage="initialization"
owned_resources_created=false
cleanup_status="cleanup_not_required_no_owned_resources_created"
target_memtotal_kib=""
target_memtotal_bytes=""
target_memavailable_bytes=""
target_cpu_count=""
target_swap_total_bytes=""
target_swap_used_bytes=""
target_disk_available_bytes=""
diagnostic_capture_status="NOT_RUN"
journal_cursor=""
web_invocation_id=""
failure_classification="UNCLASSIFIED"

fail() {
  printf 'validation-failure stage=%s message=%s\n' "$current_stage" "$*" >&2
  exit 1
}

require_root() {
  [[ "$EUID" -eq 0 ]] || {
    echo "validation must run as root from Alibaba Cloud Workbench" >&2
    exit 1
  }
  [[ "$bundle_sha256" =~ ^[0-9a-f]{64}$ ]] || {
    echo "invalid bundle SHA-256 marker" >&2
    exit 1
  }
}

verify_trusted_bundle_path() {
  local current="$script_dir"
  local owner mode

  while [[ "$current" != / ]]; do
    [[ -d "$current" && ! -L "$current" ]] ||
      fail "bundle directory chain contains a symlink or non-directory"
    owner="$(stat -c '%U:%G' "$current")"
    mode="$(stat -c '%a' "$current")"
    [[ "$owner" == root:root && "$mode" =~ ^[0-7]{3,4}$ ]] ||
      fail "bundle directory chain is not root-owned"
    (( (8#$mode & 0022) == 0 )) ||
      fail "bundle directory chain is writable by group or others"
    current="$(dirname "$current")"
  done
}

assert_evidence_security() {
  [[ -d "$evidence_dir" && ! -L "$evidence_dir" &&
    "$(stat -c '%U:%G:%a' "$evidence_dir")" == root:root:700 ]] ||
    fail "evidence directory ownership or mode changed"
  [[ -f "$durable_evidence" && ! -L "$durable_evidence" &&
    "$(stat -c '%U:%G:%a' "$durable_evidence")" == root:root:600 ]] ||
    fail "durable evidence ownership or mode changed"
  [[ -f "$evidence_run_id" && ! -L "$evidence_run_id" &&
    "$(stat -c '%U:%G:%a' "$evidence_run_id")" == root:root:600 &&
    "$(cat "$evidence_run_id")" == "$validation_id" ]] ||
    fail "evidence run binding changed"
}

initialize_evidence() {
  verify_trusted_bundle_path
  [[ ! -e "$operator_result" && ! -L "$operator_result" &&
    ! -e "${operator_result}.sha256" && ! -L "${operator_result}.sha256" ]] ||
    fail "refusing to overwrite a pre-existing operator result"
  [[ ! -e "$evidence_dir" && ! -L "$evidence_dir" ]] ||
    fail "refusing to overwrite a pre-existing evidence path"
  install -d -o root -g root -m 0700 "$evidence_dir"
  install -d -o root -g root -m 0700 "$raw_dir"
  printf '%s\n' "$validation_id" > "$evidence_run_id"
  chmod 0600 "$evidence_run_id"
  install -o root -g root -m 0600 /dev/null "$durable_evidence"
  assert_evidence_security
  write_durable_evidence IN_PROGRESS ""
}

write_durable_evidence() {
  local result=$1
  local exit_code=$2

  assert_evidence_security
  {
    printf 'baseline_sha=%s\n' "$baseline_sha"
    printf 'bundle_sha256=%s\n' "$bundle_sha256"
    printf 'validation_type=%s\n' "$validation_type"
    printf 'stage=%s\n' "$current_stage"
    printf 'final_result=%s\n' "$result"
    printf 'final_exit_code=%s\n' "$exit_code"
    printf 'target_memtotal_kib=%s\n' "$target_memtotal_kib"
    printf 'target_memtotal_bytes=%s\n' "$target_memtotal_bytes"
    printf 'target_memavailable_bytes=%s\n' "$target_memavailable_bytes"
    printf 'target_cpu_count=%s\n' "$target_cpu_count"
    printf 'target_swap_total_bytes=%s\n' "$target_swap_total_bytes"
    printf 'target_swap_used_bytes=%s\n' "$target_swap_used_bytes"
    printf 'target_disk_available_bytes=%s\n' "$target_disk_available_bytes"
    printf 'owned_resources_created=%s\n' "$owned_resources_created"
    printf 'cleanup_status=%s\n' "$cleanup_status"
    printf 'diagnostic_capture_status=%s\n' "$diagnostic_capture_status"
    printf 'failure_classification=%s\n' "$failure_classification"
    printf 'operator_result_archive=%s\n' "$(basename "$operator_result")"
  } > "$durable_evidence"
  chmod 0600 "$durable_evidence"
}

phase() {
  current_stage=$1
  write_durable_evidence IN_PROGRESS ""
  printf 'phase=%s\n' "$current_stage"
}

collect_target_resources() {
  local swap_values
  local df_exact="${raw_dir}/df-root-exact.txt"

  target_memtotal_kib="$(
    read_memtotal_kib /proc/meminfo 2>/dev/null || true
  )"
  if is_nonnegative_integer "$target_memtotal_kib"; then
    target_memtotal_bytes="$((target_memtotal_kib * 1024))"
  fi
  target_memavailable_bytes="$(
    read_memavailable_bytes /proc/meminfo 2>/dev/null || true
  )"
  target_cpu_count="$(nproc 2>/dev/null || true)"
  swap_values="$(read_enabled_swap_bytes /proc/swaps 2>/dev/null || true)"
  read -r target_swap_total_bytes target_swap_used_bytes <<< "$swap_values"
  if df -B1 -P / > "$df_exact" 2>/dev/null; then
    target_disk_available_bytes="$(
      read_df_available_bytes "$df_exact" 2>/dev/null || true
    )"
  fi
}

verify_bundle() {
  phase bundle-integrity
  [[ "$bundle_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    fail "invalid bundle SHA-256 marker"
  [[ "$(sha256sum "${script_dir}/payload.sha256" | awk '{ print $1 }')" == \
    "$bundle_sha256" ]] || fail "payload manifest digest mismatch"
  (
    cd "$script_dir"
    sha256sum --check --strict payload.sha256
  ) > "${raw_dir}/bundle-integrity.log"
}

record_preflight() {
  local port resource

  phase target-preflight
  collect_target_resources
  write_durable_evidence IN_PROGRESS ""

  cat /etc/os-release > "${raw_dir}/os-release.txt"
  nproc > "${raw_dir}/nproc.txt"
  cat /proc/meminfo > "${raw_dir}/meminfo-before.txt"
  cat /proc/swaps > "${raw_dir}/swaps-before.txt"
  uname -m > "${raw_dir}/architecture.txt"
  ss -lntup > "${raw_dir}/listeners-before.txt"

  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 22.04 ]] ||
    fail "target must be Ubuntu 22.04"
  [[ "$(uname -m)" == x86_64 ]] || fail "target must be x86_64"
  cpu_gate_passes "$target_cpu_count" ||
    fail "target must expose at least 2 vCPU"
  ram_class_gate_passes "$target_memtotal_kib" ||
    fail "target RAM is below the 4 GiB class minimum (${MIN_4G_CLASS_MEMTOTAL_KIB} kB MemTotal)"
  swap_gate_passes "$target_swap_total_bytes" ||
    fail "enabled target swap is below ${MIN_SWAP_TOTAL_BYTES} bytes"
  disk_gate_passes "$target_disk_available_bytes" ||
    fail "target has less than ${MIN_ROOT_DISK_AVAILABLE_BYTES} bytes free on /"

  for command_name in systemd systemd-analyze runuser install openssl curl ss; do
    command -v "$command_name" >> "${raw_dir}/required-commands-before.txt" ||
      fail "missing pre-install command: ${command_name}"
  done
  for port in 80 443 3000 3001 5432 6379 9000 9001 13000 13001 15432 16379 18443 19000 19001 2375 2376; do
    ! ss -H -lnt "sport = :${port}" | grep -q . ||
      fail "unknown listener already owns validation port ${port}"
  done
  for resource in \
    /etc/depress /etc/depress-day10 /opt/depress \
    /var/lib/depress-day10 /var/log/depress-day10 /run/depress-day10 \
    "$operator_root" "$staging_root" "$source_archive"; do
    [[ ! -e "$resource" && ! -L "$resource" ]] ||
      fail "unknown pre-existing DePress resource: ${resource}"
  done
  for resource in \
    depress-web depress-api depress-outbox depress-worker depress-migration \
    depress-day10-web depress-day10-api depress-day10-outbox \
    depress-day10-worker depress-day10-migration depress-redis depress-s3; do
    ! id "$resource" >/dev/null 2>&1 ||
      fail "unknown pre-existing DePress identity: ${resource}"
  done
  for resource in depress-release depress-day10-release; do
    ! getent group "$resource" >/dev/null 2>&1 ||
      fail "unknown pre-existing DePress group: ${resource}"
  done
  if systemctl list-unit-files --no-legend |
    awk '{ print $1 }' |
    grep -Eq '^depress(-|\.)'; then
    fail "unknown pre-existing DePress unit"
  fi
  if command -v docker >/dev/null 2>&1; then
    ! docker ps -a --format '{{.Labels}}' |
      grep -q 'com.depress.managed=true' ||
      fail "unknown pre-existing managed container"
    ! docker volume ls --format '{{.Labels}}' |
      grep -q 'com.depress.managed=true' ||
      fail "unknown pre-existing managed volume"
    ! docker network ls --format '{{.Labels}}' |
      grep -q 'com.depress.managed=true' ||
      fail "unknown pre-existing managed network"
  fi
}

verify_systemd_runtime() {
  phase systemd-runtime
  systemd --version > "${raw_dir}/systemd-version.txt"
  [[ "$(systemd --version | awk 'NR == 1 { print $2 }')" == 249 ]] ||
    fail "target must use systemd major 249"
}

print_expected_marker() {
  printf '%s\n' \
    "validation_type=${validation_type}" \
    "validation_id=${validation_id}" \
    "bundle_sha256=${bundle_sha256}" \
    "baseline_sha=${baseline_sha}" \
    "identity_names=depress-day10-web,depress-day10-api,depress-day10-outbox,depress-day10-worker,depress-day10-migration,depress-day10-release,depress-web,depress-api,depress-outbox,depress-worker,depress-migration,depress-release,depress-redis,depress-s3,depress-runtime" \
    "config_paths=/etc/depress,/etc/depress-day10" \
    "staging_path=${staging_root}" \
    "source_path=${source_dir}" \
    "source_archive=${source_archive}" \
    "release_paths=/opt/depress,/opt/depress-day10-failure-bin" \
    "runtime_paths=/var/lib/depress-day10,/var/log/depress-day10,/var/tmp/depress-day10-runs,/run/depress-day10,/run/depress-day10-web,/run/depress-day10-worker,/var/lib/depress-web,/var/cache/depress-web" \
    "unit_paths=/etc/systemd/system/depress-nginx-day10.service,/etc/systemd/system/depress-web.service,/etc/systemd/system/depress-web-day10.service,/etc/systemd/system/depress-pointer-worker.service,/etc/systemd/system/depress-pointer-worker.service.d,/etc/systemd/system/depress-outbox.service,/etc/systemd/system/depress-api.service,/etc/systemd/system/depress-minio-day10.service,/etc/systemd/system/depress-redis-day10.service" \
    "docker_label=com.depress.managed=true"
}

create_owned_resources_and_marker() {
  local marker_tmp

  phase ownership-marker
  install -d -o root -g root -m 0700 "$staging_root" "$source_dir"
  if ! install -d -o root -g root -m 0700 "$operator_root"; then
    rmdir "$source_dir" "$staging_root" 2>/dev/null || true
    fail "could not create operator marker directory"
  fi
  marker_tmp="${operator_root}/.${validation_id}.marker.tmp"
  if ! print_expected_marker > "$marker_tmp" ||
    ! chmod 0600 "$marker_tmp" ||
    ! chown root:root "$marker_tmp" ||
    ! mv -T "$marker_tmp" "$operator_marker"; then
    rm -f -- "$marker_tmp"
    rmdir "$source_dir" "$staging_root" "$operator_root" 2>/dev/null || true
    fail "could not bind the first owned resource to its operator marker"
  fi
  owned_resources_created=true
  write_durable_evidence IN_PROGRESS ""
}

install_official_dependencies() {
  local install_tmp

  phase install-official-dependencies
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y \
    ca-certificates curl git gnupg jq openssl xz-utils time tar \
    nginx postgresql postgresql-client redis-server \
    fonts-liberation fonts-noto-core fonts-noto-cjk poppler-utils
  systemctl stop nginx redis-server postgresql 2>/dev/null || true

  install_tmp="$(mktemp -d)"
  curl --fail --silent --show-error --location \
    "https://nodejs.org/download/release/${node_version}/SHASUMS256.txt" \
    -o "${install_tmp}/SHASUMS256.txt"
  curl --fail --silent --show-error --location \
    "https://nodejs.org/download/release/${node_version}/node-${node_version}-linux-x64.tar.xz" \
    -o "${install_tmp}/node-${node_version}-linux-x64.tar.xz"
  (
    cd "$install_tmp"
    grep " node-${node_version}-linux-x64.tar.xz\$" SHASUMS256.txt |
      sha256sum --check --strict
  )
  tar -xJf "${install_tmp}/node-${node_version}-linux-x64.tar.xz" \
    -C /usr/local --strip-components=1
  /usr/local/bin/corepack enable --install-directory /usr/local/bin
  /usr/local/bin/corepack prepare pnpm@9.15.4 --activate
  ln -sfn /usr/local/bin/corepack /usr/bin/corepack

  install -d -m 0755 /etc/apt/keyrings
  curl --fail --silent --show-error --location \
    https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod 0644 /etc/apt/keyrings/docker.asc
  printf '%s\n' \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  for binary in "minio:${minio_release}" "mc:${mc_release}"; do
    name="${binary%%:*}"
    release="${binary#*:}"
    curl --fail --silent --show-error --location \
      "https://dl.min.io/$([[ "$name" == minio ]] && echo server || echo client)/${name}/release/linux-amd64/archive/${name}.${release}" \
      -o "${install_tmp}/${name}.${release}"
    curl --fail --silent --show-error --location \
      "https://dl.min.io/$([[ "$name" == minio ]] && echo server || echo client)/${name}/release/linux-amd64/archive/${name}.${release}.sha256sum" \
      -o "${install_tmp}/${name}.${release}.sha256sum"
    (cd "$install_tmp" && sha256sum --check --strict "${name}.${release}.sha256sum")
    install -o root -g root -m 0755 "${install_tmp}/${name}.${release}" \
      "/usr/local/bin/${name}"
  done
  rm -rf -- "$install_tmp"
}

restore_dirty_tree() {
  local mode path
  declare -A expected_modes=()

  phase restore-dirty-tree
  load_mode_manifest "${script_dir}/changed-files.mode" expected_modes ||
    fail "invalid changed-file mode manifest"
  verify_mode_manifest_paths "${script_dir}/changed-files.mode" \
    "${script_dir}/changed-files.txt" ||
    fail "mode manifest path set differs from changed files"
  tar -xf "${script_dir}/baseline.tar" -C "$source_dir"
  (
    cd "$source_dir"
    git -c core.autocrlf=false -c core.eol=lf \
      apply --no-index --binary "${script_dir}/dirty-tree.patch"
  )
  while IFS= read -r path; do
    [[ -n "$path" && "$path" != /* && "$path" != *".."* ]] ||
      fail "unsafe new-file path in manifest"
    mode="${expected_modes[$path]:-}"
    mode_manifest_mode_is_allowed "$mode" ||
      fail "new file is missing an allowed expected mode"
    install -D -m "$mode" "${script_dir}/new-files/${path}" \
      "${source_dir}/${path}"
  done < "${script_dir}/new-files.txt"
  while IFS= read -r path; do
    mode="${expected_modes[$path]:-}"
    restore_exact_mode "$mode" "${source_dir}/${path}" ||
      fail "could not restore exact changed-file mode"
  done < "${script_dir}/changed-files.txt"
  (
    cd "$source_dir"
    sha256sum --check --strict "${script_dir}/changed-files.sha256"
  ) > "${raw_dir}/restored-file-hashes.log"
  verify_mode_manifest_tree "${script_dir}/changed-files.mode" "$source_dir" ||
    fail "restored changed-file mode mismatch"
  [[ ! -e "${source_dir}/.git" ]] || fail "restored source contains .git"
  find "$source_dir" -type f \( -name '*.sh' -o -name '*.bash' \) -print0 |
    xargs -0 -r bash -n
  if find "$source_dir" -type f \( -name '*.sh' -o -name '*.bash' \) -print0 |
    xargs -0 -r grep -Il $'\r'; then
    fail "restored shell file contains CR bytes"
  fi
  mapfile -t top_entries < <(
    find "$source_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort
  )
  tar -C "$source_dir" -cf "$source_archive" "${top_entries[@]}"
  sha256sum "$source_archive" > "${raw_dir}/source-archive.sha256"
}

start_sampler() {
  (
    while true; do
      printf 'sample_time=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      awk '/MemAvailable:|SwapTotal:|SwapFree:/ { print }' /proc/meminfo
      df -B1 /
      ps -eo pid,user,rss,comm,args --sort=-rss | head -n 25
      docker system df 2>/dev/null || true
      journalctl --disk-usage 2>/dev/null || true
      sleep 2
    done
  ) > "${raw_dir}/resource-samples.log" 2>&1 &
  sampler_pid=$!
}

stop_sampler() {
  if [[ -n "$sampler_pid" ]] && kill -0 "$sampler_pid" 2>/dev/null; then
    kill -TERM "$sampler_pid"
    wait "$sampler_pid" 2>/dev/null || true
  fi
  sampler_pid=""
}

run_regression() {
  phase regression
  (
    umask 022
    cd "$source_dir"
    /usr/bin/time -v -o "${raw_dir}/install-time.txt" \
      pnpm install --frozen-lockfile
    pnpm lint
    pnpm typecheck
    pnpm test
    DEPRESS_API_ORIGIN=http://127.0.0.1:3001 \
      /usr/bin/time -v -o "${raw_dir}/build-time.txt" pnpm build
    pnpm exec playwright install --with-deps chromium
  ) 2>&1 | tee "${raw_dir}/regression.log"
}

release_tree_digest() {
  find "$production_release" -xdev -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 -r sha256sum |
    sha256sum |
    awk '{ print $1 }'
}

record_journal_cursor() {
  local cursor_output="${raw_dir}/journal-cursor-before.txt"

  if ! journalctl -n 0 --show-cursor --no-pager > "$cursor_output" 2>&1; then
    diagnostic_capture_status=FAILURE
    chmod 0600 "$cursor_output"
    return 1
  fi
  journal_cursor="$(sed -n 's/^-- cursor: //p' "$cursor_output" | tail -n 1)"
  [[ -n "$journal_cursor" && "$journal_cursor" == *=* && "$journal_cursor" != -* &&
    "$journal_cursor" =~ ^[A-Za-z0-9_.:=\;-]+$ &&
    "$journal_cursor" != *$'\n'* && "$journal_cursor" != *$'\r'* ]] || {
    diagnostic_capture_status=FAILURE
    chmod 0600 "$cursor_output"
    return 1
  }
  printf 'unit=depress-web.service\njournal_cursor=%s\n' "$journal_cursor" \
    > "$cursor_output"
  chmod 0600 "$cursor_output"
}

capture_production_web_evidence() {
  if env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    bash "${source_dir}/e2e/day10/operator-validation/capture-service-evidence.sh" \
      depress-web.service "$journal_cursor" "$raw_dir"; then
    diagnostic_capture_status=SUCCESS
    web_invocation_id="$(sed -n 's/^InvocationID=//p' \
      "${raw_dir}/systemd-web-exec-status.txt")"
    return 0
  fi
  diagnostic_capture_status=FAILURE
  return 1
}

create_production_identities_and_env() {
  local user env_name
  local -a users=(depress-web depress-api depress-outbox depress-worker depress-migration)

  groupadd --system depress-release
  for user in "${users[@]}"; do
    groupadd --system "$user"
    useradd --system --no-create-home --shell /usr/sbin/nologin \
      --gid "$user" --comment "DePress validation ${validation_id}" "$user"
    usermod -aG depress-release "$user"
  done
  usermod -aG docker depress-worker
  install -d -o root -g root -m 0711 "$production_env_dir"
  for env_name in api outbox pointer-worker migration; do
    printf '%s\n' 'VALIDATION_PLACEHOLDER=true' \
      > "${production_env_dir}/${env_name}.env"
  done
  printf '%s\n' \
    "NODE_ENV=production" "HOSTNAME=127.0.0.1" "PORT=3000" \
    "NEXT_TELEMETRY_DISABLED=1" \
    "DEPRESS_API_ORIGIN=http://127.0.0.1:3001" \
    > "${production_env_dir}/web.env"
  chown root:depress-api "${production_env_dir}/api.env"
  chown root:depress-outbox "${production_env_dir}/outbox.env"
  chown root:depress-worker "${production_env_dir}/pointer-worker.env"
  chown root:depress-migration "${production_env_dir}/migration.env"
  chown root:depress-web "${production_env_dir}/web.env"
  chmod 0640 "$production_env_dir"/*.env
  bash "${source_dir}/deploy/verify-env-permissions.sh" \
    > "${raw_dir}/production-identity-matrix.txt"
  chmod 0600 "${raw_dir}/production-identity-matrix.txt"
}

remove_production_identities_and_env() {
  local user
  rm -- \
    "${production_env_dir}/api.env" \
    "${production_env_dir}/outbox.env" \
    "${production_env_dir}/pointer-worker.env" \
    "${production_env_dir}/migration.env" \
    "${production_env_dir}/web.env"
  rmdir "$production_env_dir"
  for user in depress-web depress-api depress-outbox depress-worker depress-migration; do
    userdel "$user"
    groupdel "$user"
  done
  groupdel depress-release
}

initialize_release_permission_capture_files() {
  [[ $# -eq 3 ]] || return 64
  local capture_file

  for capture_file in "$@"; do
    [[ "$capture_file" == /* && ! -e "$capture_file" && ! -L "$capture_file" ]] ||
      return 1
    install -o root -g root -m 0600 /dev/null "$capture_file"
  done
}

verify_production_web_unit() {
  local production_web_ready=false
  local require_hook next_entry before_digest after_digest
  local root_code login_code
  local release_permission_status=0
  local release_permission_stderr="${raw_dir}/release-permission-stderr.txt"
  local identity_check_summary="${raw_dir}/identity-check-summary.txt"

  phase production-web-unit
  create_production_identities_and_env
  install -d -o root -g depress-release -m 0750 /opt/depress /opt/depress/releases
  install -d -o root -g depress-release -m 0750 "$production_release"
  tar -xf "$source_archive" -C "$production_release"
  (
    umask 022
    pnpm --dir "$production_release" install --frozen-lockfile \
      --package-import-method=copy
    DEPRESS_API_ORIGIN=http://127.0.0.1:3001 \
      pnpm --dir "$production_release" build
  )
  printf '%s\n' "$validation_id" > "${production_release}/.depress-release"
  initialize_release_permission_capture_files \
    "${raw_dir}/release-permission-matrix.txt" \
    "$release_permission_stderr" \
    "$identity_check_summary"
  set +e
  DEPRESS_ROOT=/opt/depress DEPRESS_RELEASE_GROUP=depress-release \
    DEPRESS_IDENTITY_CHECK_SUMMARY="$identity_check_summary" \
    bash "${source_dir}/deploy/release-permissions.sh" \
      normalize "$production_release" \
      > "${raw_dir}/release-permission-matrix.txt" \
      2> "$release_permission_stderr"
  release_permission_status=$?
  set -e
  chmod 0600 \
    "${raw_dir}/release-permission-matrix.txt" \
    "$identity_check_summary" "$release_permission_stderr"
  if (( release_permission_status != 0 )); then
    cat "$release_permission_stderr" >&2
    if grep -Fq 'classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT' \
      "$release_permission_stderr"; then
      failure_classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT
    else
      failure_classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT
    fi
    printf 'command_category=release-permission-matrix target_identity=all safe_cwd=/ command_exit_code=%s release_check_result=FAIL diagnostic_capture_status=SUCCESS\n' \
      "$release_permission_status" >> "$identity_check_summary"
    fail "Release permission validation failed classification=${failure_classification}"
  fi
  require_hook="$(find "$production_release/node_modules/.pnpm" \
    -path '*/next/dist/server/require-hook.js' -type f -print -quit)"
  [[ -n "$require_hook" ]] || fail "Next.js require-hook.js is missing"
  next_entry="${production_release}/apps/web/node_modules/.bin/next"
  if ! bash "${source_dir}/deploy/run-as-identity.sh" depress-web \
    /usr/bin/test -r "$require_hook"; then
    failure_classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT
    fail "depress-web cannot read Next.js require-hook.js"
  fi
  if ! bash "${source_dir}/deploy/run-as-identity.sh" depress-web \
    /usr/bin/test -x "$next_entry"; then
    failure_classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT
    fail "depress-web cannot execute the Next.js entry point"
  fi
  namei -l "$require_hook" > "${raw_dir}/release-runtime-namei.txt"
  stat -c '%A %a %U:%G %n' \
    /opt/depress /opt/depress/releases "$production_release" \
    "$production_release/node_modules" "$production_release/node_modules/.pnpm" \
    "$require_hook" > "${raw_dir}/release-runtime-stat.txt"
  if command -v getfacl >/dev/null 2>&1; then
    getfacl -p /opt/depress /opt/depress/releases "$production_release" \
      "$require_hook" > "${raw_dir}/release-runtime-acl.txt"
  else
    printf 'getfacl_status=UNAVAILABLE\n' > "${raw_dir}/release-runtime-acl.txt"
  fi
  chmod 0600 "${raw_dir}/release-runtime-"*.txt
  ln -s "$production_release" /opt/depress/current
  [[ "$(readlink -f /opt/depress/current)" == "$production_release" ]] ||
    fail "current link escaped the production release"
  before_digest="$(release_tree_digest)"
  printf 'release_tree_sha256_before=%s\n' "$before_digest" \
    > "${raw_dir}/release-tree-digest.txt"
  chmod 0600 "${raw_dir}/release-tree-digest.txt"

  env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    bash "${source_dir}/deploy/systemd/verify-depress-web-unit.sh" \
      "${source_dir}/deploy/systemd/depress-web.service" \
      "${raw_dir}/systemd-web-verify.log"
  install -o root -g root -m 0644 \
    "${source_dir}/deploy/systemd/depress-web.service" "$production_unit"
  systemctl daemon-reload
  record_journal_cursor || fail "could not bind Web diagnostics to a journal cursor"
  if ! systemctl start depress-web.service; then
    capture_production_web_evidence || true
    fail "production Web unit failed to start"
  fi
  for _ in $(seq 1 120); do
    if curl --fail --silent http://127.0.0.1:3000/ >/dev/null 2>&1 &&
      curl --fail --silent http://127.0.0.1:3000/login >/dev/null 2>&1; then
      production_web_ready=true
      break
    fi
    systemctl is-active --quiet depress-web.service || break
    sleep 0.25
  done
  [[ "$production_web_ready" == true ]] || {
    capture_production_web_evidence || true
    fail "production Web root and login did not become reachable"
  }
  for _ in $(seq 1 60); do
    systemctl is-active --quiet depress-web.service || {
      capture_production_web_evidence || true
      fail "production Web unit stopped during the stability window"
    }
    curl --fail --silent http://127.0.0.1:3000/ >/dev/null 2>&1 || {
      capture_production_web_evidence || true
      fail "production Web root failed during the stability window"
    }
    sleep 1
  done
  capture_production_web_evidence ||
    fail "diagnostic_capture_status=FAILURE"
  systemctl is-active --quiet depress-web.service ||
    fail "production Web unit is not active"
  grep -Fxq 'ActiveState=active' "${raw_dir}/systemd-web-exec-status.txt" ||
    fail "production Web ActiveState is not active"
  grep -Fxq 'SubState=running' "${raw_dir}/systemd-web-exec-status.txt" ||
    fail "production Web SubState is not running"
  grep -Fxq 'Result=success' "${raw_dir}/systemd-web-exec-status.txt" ||
    fail "production Web ExecStart result is not successful"
  [[ "$web_invocation_id" =~ ^[0-9a-f]{32}$ ]] ||
    fail "production Web evidence is not invocation-bound"
  grep -Fxq 'loopback_listener_3000=PRESENT' \
    "${raw_dir}/production-web-listener.txt" ||
    fail "production Web is not listening on 127.0.0.1:3000"
  grep -Fxq 'public_listener_3000=ABSENT' \
    "${raw_dir}/production-web-listener.txt" ||
    fail "production Web exposed port 3000 publicly"
  root_code="$(sed -n 's/^root_http_code=//p' "${raw_dir}/production-web-health.txt")"
  login_code="$(sed -n 's/^login_http_code=//p' "${raw_dir}/production-web-health.txt")"
  [[ "$root_code" =~ ^2[0-9]{2}$ && "$login_code" =~ ^2[0-9]{2}$ ]] ||
    fail "production Web health endpoints did not return success"
  grep -Fxq 'root_curl_exit=0' "${raw_dir}/production-web-health.txt" ||
    fail "production Web root curl failed"
  grep -Fxq 'login_curl_exit=0' "${raw_dir}/production-web-health.txt" ||
    fail "production Web login curl failed"
  ! grep -Eq 'EACCES|Failed to start|Main process exited|Failed with result' \
    "${raw_dir}/systemd-web-journal.log" || {
      if grep -Fq EACCES "${raw_dir}/systemd-web-journal.log"; then
        failure_classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT
      fi
      fail "production Web journal contains a startup or permission failure"
    }
  after_digest="$(release_tree_digest)"
  printf 'release_tree_sha256_after=%s\n' "$after_digest" \
    >> "${raw_dir}/release-tree-digest.txt"
  [[ "$before_digest" == "$after_digest" ]] ||
    fail "production Web mutated the immutable release"
  set +e
  DEPRESS_ROOT=/opt/depress DEPRESS_RELEASE_GROUP=depress-release \
    DEPRESS_IDENTITY_CHECK_SUMMARY="$identity_check_summary" \
    bash "${source_dir}/deploy/release-permissions.sh" \
      verify "$production_release" \
      >> "${raw_dir}/release-permission-matrix.txt" \
      2>> "$release_permission_stderr"
  release_permission_status=$?
  set -e
  if (( release_permission_status != 0 )); then
    if grep -Fq 'classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT' \
      "$release_permission_stderr"; then
      failure_classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT
    else
      failure_classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT
    fi
    printf 'command_category=release-permission-matrix target_identity=all safe_cwd=/ command_exit_code=%s release_check_result=FAIL diagnostic_capture_status=SUCCESS\n' \
      "$release_permission_status" >> "$identity_check_summary"
    fail "post-start Release permission validation failed classification=${failure_classification}"
  fi
  bash "${source_dir}/deploy/run-as-identity.sh" depress-web \
    /usr/bin/test -w /var/lib/depress-web ||
    fail "production Web cannot write StateDirectory"
  bash "${source_dir}/deploy/run-as-identity.sh" depress-web \
    /usr/bin/test -w /var/cache/depress-web ||
    fail "production Web cannot write CacheDirectory"

  systemctl stop depress-web.service
  rm -- "$production_unit"
  systemctl daemon-reload
  rm -- /opt/depress/current
  rm -rf -- "$production_release"
  rmdir /opt/depress/releases /opt/depress
  rm -rf -- /var/lib/depress-web /var/cache/depress-web
  remove_production_identities_and_env
}

prepare_harness_accounts_and_images() {
  phase harness-prerequisites
  groupadd --system depress-runtime
  useradd --system --no-create-home --shell /usr/sbin/nologin \
    --gid depress-runtime --comment "DePress validation ${validation_id}" depress-redis
  useradd --system --no-create-home --shell /usr/sbin/nologin \
    --gid depress-runtime --comment "DePress validation ${validation_id}" depress-s3
  docker pull \
    "postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
  docker pull \
    "ghcr.io/typst/typst@sha256:b23ba03da5c085a2c8780bc9f2296db937abe1d0c75348cf2f8a9273199c3a14"
}

run_targeted_deployment_tests() {
  phase targeted-deployment-tests
  (
    cd "$source_dir"
    bash deploy/run-as-identity.test.sh
    bash deploy/host-preflight.test.sh
    bash deploy/systemd/depress-web.test.sh
    bash deploy/nginx/depress-nginx.test.sh
    bash deploy/health-check.test.sh
    bash deploy/release-permissions.test.sh
    bash deploy/release-security.test.sh
    bash deploy/rollback-security.test.sh
    bash deploy/verify-env-permissions.test.sh
    bash deploy/migrate-security.test.sh
    bash e2e/day10/archive-fidelity.test.sh
    bash e2e/day10/private-topology.test.sh
    bash e2e/day10/operator-validation/capture-service-evidence.test.sh
    bash e2e/day10/operator-validation/create-operator-result.test.sh
    bash e2e/day10/operator-validation/operator-validation.test.sh
  ) 2>&1 | tee "${raw_dir}/targeted-deployment-tests.log"
}

run_full_topology_smoke() {
  local source_archive_sha

  phase full-non-candidate-topology-smoke
  source_archive_sha="$(sha256sum "$source_archive" | awk '{ print $1 }')"
  DAY10_VALIDATION_TYPE="$validation_type" \
    DAY10_BUNDLE_SHA256="$bundle_sha256" \
    DAY10_CHANGED_SHA256_FILE="${script_dir}/changed-files.sha256" \
    DAY10_SOURCE_ARCHIVE="$source_archive" \
    DAY10_SOURCE_ARCHIVE_SHA256="$source_archive_sha" \
    DAY10_EXPECTED_CHANGED_FILES_FILE="${script_dir}/changed-files.txt" \
    DAY10_STAGING_ROOT="$staging_root" \
    bash "${source_dir}/e2e/day10/run-staging.sh" \
      full "$validation_id" "$baseline_sha" "$source_dir" EMPTY_DISPOSABLE_HOST \
    2>&1 | tee "${raw_dir}/full-topology-smoke.log"
}

capture_acceptance_evidence() {
  local result_file="${staging_root}/acceptance-results.json"

  phase capture-acceptance-evidence
  [[ -f "$result_file" && ! -L "$result_file" ]] ||
    fail "full Smoke did not write acceptance evidence"
  jq -e '
    ([.cases[] | select(.id | test("^D10-0(09|1[0-9])$"))] | length) == 11 and
    ([.cases[] | select(.id | test("^D10-0(09|1[0-9])$") and .status == "PASS")] | length) == 11 and
    (.pdfs | length) >= 1
  ' "$result_file" >/dev/null ||
    fail "acceptance evidence is incomplete"
  install -o root -g root -m 0600 "$result_file" \
    "${raw_dir}/acceptance-results.json"
}

run_cleanup() {
  bash "${script_dir}/depress-target-cleanup.sh"
}

cleanup_validation_resources() {
  phase cleanup
  stop_sampler
  run_cleanup
  cleanup_status="cleanup_succeeded_owned_resources_removed"
  write_durable_evidence IN_PROGRESS ""
}

write_success_evidence() {
  phase durable-evidence
  failure_classification=NONE
  write_durable_evidence SUCCESS 0
  {
    printf 'web_unit_verify=PASS\n'
    printf 'targeted_deployment_tests=PASS\n'
    printf 'full_topology_smoke=PASS\n'
    printf 'acceptance_evidence=PASS\n'
  } >> "$durable_evidence"
  chmod 0600 "$durable_evidence"
}

generate_operator_result() {
  local classification=$1

  {
    printf 'target_memtotal_kib=%s\n' "$target_memtotal_kib"
    printf 'target_cpu_count=%s\n' "$target_cpu_count"
    printf 'target_swap_total_bytes=%s\n' "$target_swap_total_bytes"
    printf 'target_swap_used_bytes=%s\n' "$target_swap_used_bytes"
    printf 'target_disk_available_bytes=%s\n' "$target_disk_available_bytes"
  } > "${raw_dir}/resource-summary.txt"
  printf 'cleanup_status=%s\nowned_resources_created=%s\n' \
    "$cleanup_status" "$owned_resources_created" > "${raw_dir}/cleanup-summary.txt"
  printf 'stage=%s\nfailure_classification=%s\n' \
    "$current_stage" "$classification" > "${raw_dir}/failure-classification.txt"
  chmod 0600 \
    "${raw_dir}/resource-summary.txt" \
    "${raw_dir}/cleanup-summary.txt" \
    "${raw_dir}/failure-classification.txt"
  bash "${script_dir}/create-operator-result.sh" \
    "$validation_id" "$evidence_dir" "$raw_dir" "$operator_result"
}

on_exit() {
  local status=$?
  local cleanup_exit=0

  trap - EXIT
  set +e
  stop_sampler
  if ((status != 0)); then
    if [[ "$failure_classification" == UNCLASSIFIED ]]; then
      failure_classification=OPERATOR_VALIDATION_FAILURE
    fi
    if [[ "$owned_resources_created" == true ]]; then
      run_cleanup
      cleanup_exit=$?
      case "$cleanup_exit" in
        0) cleanup_status="cleanup_succeeded_owned_resources_removed" ;;
        70) cleanup_status="cleanup_refused_marker_invalid" ;;
        *) cleanup_status="cleanup_failed_owned_resources_may_remain" ;;
      esac
    else
      cleanup_status="cleanup_not_required_no_owned_resources_created"
    fi
    write_durable_evidence FAILURE "$status" || true
    generate_operator_result "$failure_classification" ||
      echo "operator-result-generation=FAILURE" >&2
  fi
  exit "$status"
}

main() {
  require_root
  initialize_evidence
  trap on_exit EXIT
  verify_bundle
  record_preflight
  verify_systemd_runtime
  create_owned_resources_and_marker
  install_official_dependencies
  restore_dirty_tree
  start_sampler
  run_regression
  verify_production_web_unit
  prepare_harness_accounts_and_images
  run_targeted_deployment_tests
  run_full_topology_smoke
  capture_acceptance_evidence
  cleanup_validation_resources
  write_success_evidence
  generate_operator_result NONE
  trap - EXIT
  printf 'validation-result=SUCCESS type=%s evidence=%s operator_result=%s\n' \
    "$validation_type" "$durable_evidence" "$operator_result"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
