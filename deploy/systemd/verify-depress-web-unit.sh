#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  echo "usage: $0 UNIT_FILE NEW_LOG_FILE" >&2
  exit 64
}

[[ $# -eq 2 ]] || usage
readonly unit_file=$1
readonly log_file=$2
readonly log_parent="$(dirname "$log_file")"
readonly analyzer_request="${SYSTEMD_ANALYZE_BIN:-systemd-analyze}"
readonly expected_systemd_major="${SYSTEMD_VERIFY_EXPECTED_MAJOR:-249}"
readonly expected_exec_start="${SYSTEMD_VERIFY_EXPECTED_EXEC_START:-ExecStart=/usr/bin/corepack pnpm --dir /opt/depress/current --filter @depress/web start --hostname 127.0.0.1 --port 3000}"
readonly expected_working_directory="${SYSTEMD_VERIFY_EXPECTED_WORKING_DIRECTORY:-WorkingDirectory=/opt/depress/current}"
readonly expected_environment_file="${SYSTEMD_VERIFY_EXPECTED_ENVIRONMENT_FILE:-EnvironmentFile=/etc/depress/web.env}"
readonly filesystem_root="${SYSTEMD_VERIFY_FS_ROOT:-/}"
readonly analyzer_ld_library_path="${SYSTEMD_ANALYZE_LD_LIBRARY_PATH:-}"
readonly test_mode="${SYSTEMD_VERIFY_TEST_MODE:-false}"

reject() {
  local message=$1

  if [[ -d "$log_parent" && ! -L "$log_parent" &&
    ! -e "$log_file" && ! -L "$log_file" ]]; then
    install -m 0600 /dev/null "$log_file"
    printf 'isolated-systemd-verify=FAIL message=%s\n' "$message" > "$log_file"
  fi
  printf 'isolated-systemd-verify=FAIL message=%s\n' "$message" >&2
  exit 1
}

safe_absolute_path() {
  local path=${1:-}
  [[ "$path" == /* && "$path" != *".."* &&
    "$path" != *$'\n'* && "$path" != *$'\r'* ]]
}

rooted_path() {
  local path=$1

  if [[ "$filesystem_root" == / ]]; then
    printf '%s\n' "$path"
  else
    printf '%s%s\n' "${filesystem_root%/}" "$path"
  fi
}

resolve_analyzer() {
  if [[ "$analyzer_request" == /* ]]; then
    [[ -x "$analyzer_request" && ! -d "$analyzer_request" ]] || return 1
    printf '%s\n' "$analyzer_request"
  else
    command -v -- "$analyzer_request"
  fi
}

[[ "$EUID" -eq 0 ]] || reject "verification must run as root"
[[ -f "$unit_file" && ! -L "$unit_file" ]] || reject "unit file is missing or a symlink"
[[ -d "$log_parent" && ! -L "$log_parent" ]] || reject "log parent is missing or a symlink"
[[ ! -e "$log_file" && ! -L "$log_file" ]] || reject "refusing to overwrite a verify log"
if [[ "$test_mode" != true ]] &&
  [[ -n "${SYSTEMD_ANALYZE_BIN+x}${SYSTEMD_ANALYZE_LD_LIBRARY_PATH+x}${SYSTEMD_VERIFY_EXPECTED_MAJOR+x}${SYSTEMD_VERIFY_EXPECTED_EXEC_START+x}${SYSTEMD_VERIFY_EXPECTED_WORKING_DIRECTORY+x}${SYSTEMD_VERIFY_EXPECTED_ENVIRONMENT_FILE+x}${SYSTEMD_VERIFY_FS_ROOT+x}" ]]; then
  reject "verification overrides require explicit test mode"
fi
[[ "$(stat -c '%U:%G' "$unit_file")" == root:root ]] || reject "unit file is not root-owned"
readonly unit_file_mode="$(stat -c '%a' "$unit_file")"
(( (8#$unit_file_mode & 0022) == 0 )) || reject "unit file is group/other writable"
[[ "$(stat -c '%U:%G' "$log_parent")" == root:root ]] || reject "log parent is not root-owned"
readonly log_parent_mode="$(stat -c '%a' "$log_parent")"
(( (8#$log_parent_mode & 0022) == 0 )) || reject "log parent is group/other writable"
safe_absolute_path "$filesystem_root" || reject "filesystem root is not an absolute safe path"
[[ -d "$filesystem_root" && ! -L "$filesystem_root" ]] || reject "filesystem root is missing or a symlink"
[[ "$(stat -c '%U:%G' "$filesystem_root")" == root:root ]] || reject "filesystem root is not root-owned"
readonly filesystem_root_mode="$(stat -c '%a' "$filesystem_root")"
(( (8#$filesystem_root_mode & 0022) == 0 )) || reject "filesystem root is group/other writable"
[[ "$expected_systemd_major" =~ ^[0-9]+$ ]] || reject "expected systemd major is invalid"

[[ "$(grep -Fxc "$expected_exec_start" "$unit_file")" -eq 1 ]] || reject "ExecStart does not match the production contract"
[[ "$(grep -Fxc "$expected_working_directory" "$unit_file")" -eq 1 ]] || reject "WorkingDirectory does not match the production contract"
[[ "$(grep -Fxc "$expected_environment_file" "$unit_file")" -eq 1 ]] || reject "EnvironmentFile does not match the production contract"

readonly exec_command="${expected_exec_start#ExecStart=}"
readonly exec_path="${exec_command%% *}"
readonly working_directory="${expected_working_directory#WorkingDirectory=}"
readonly environment_file="${expected_environment_file#EnvironmentFile=}"
safe_absolute_path "$exec_path" || reject "ExecStart executable path is invalid"
safe_absolute_path "$working_directory" || reject "WorkingDirectory path is invalid"
safe_absolute_path "$environment_file" || reject "EnvironmentFile path is invalid"

readonly rooted_exec_path="$(rooted_path "$exec_path")"
readonly rooted_working_directory="$(rooted_path "$working_directory")"
readonly rooted_environment_file="$(rooted_path "$environment_file")"
[[ -x "$rooted_exec_path" && ! -d "$rooted_exec_path" ]] || reject "ExecStart executable is missing"
[[ -d "$rooted_working_directory" ]] || reject "WorkingDirectory is missing"
[[ -f "$rooted_environment_file" && ! -L "$rooted_environment_file" ]] || reject "EnvironmentFile is missing or a symlink"

analyzer="$(resolve_analyzer)" || reject "systemd-analyze is unavailable"
readonly analyzer
declare -a analyzer_env=(
  env -i
  PATH=/usr/sbin:/usr/bin:/sbin:/bin
  LC_ALL=C
)
if [[ -n "$analyzer_ld_library_path" ]]; then
  analyzer_env+=("LD_LIBRARY_PATH=${analyzer_ld_library_path}")
fi
readonly analyzer_version="$("${analyzer_env[@]}" "$analyzer" --version | awk 'NR == 1 { print $2 }')"
[[ "$analyzer_version" == "$expected_systemd_major" ]] || reject "systemd major does not match ${expected_systemd_major}"

readonly verify_dir="$(mktemp -d /tmp/depress-systemd-verify.XXXXXX)"
cleanup() {
  rm -rf -- "$verify_dir"
}
trap cleanup EXIT
chmod 0700 "$verify_dir"
install -m 0644 "$unit_file" "$verify_dir/depress-web.service"
printf '%s\n' \
  '[Unit]' \
  'Description=Isolated sysinit target for DePress unit verification' \
  'DefaultDependencies=no' \
  > "$verify_dir/sysinit.target"
printf '%s\n' \
  '[Unit]' \
  'Description=Isolated network-online target for DePress unit verification' \
  'DefaultDependencies=no' \
  > "$verify_dir/network-online.target"
chmod 0644 "$verify_dir/sysinit.target" "$verify_dir/network-online.target"

mapfile -t verify_files < <(
  find "$verify_dir" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' |
    LC_ALL=C sort
)
[[ "${verify_files[*]}" == "depress-web.service network-online.target sysinit.target" ]] || reject "isolated unit directory contains an unexpected file"

declare -a isolated_env=(
  "${analyzer_env[@]}"
  "SYSTEMD_UNIT_PATH=${verify_dir}"
)
mapfile -t unit_paths < <("${isolated_env[@]}" "$analyzer" unit-paths)
[[ "${#unit_paths[@]}" -eq 1 && "${unit_paths[0]}" == "$verify_dir" ]] || reject "systemd unit search path escaped isolation"

readonly analyzer_log="${verify_dir}/systemd-analyze.log"
set +e
"${isolated_env[@]}" "$analyzer" verify "$verify_dir/depress-web.service" \
  > "$analyzer_log" 2>&1
analyzer_status=$?
set -e
install -m 0600 "$analyzer_log" "$log_file"
if [[ "$analyzer_status" -ne 0 || -s "$analyzer_log" ]]; then
  cat "$analyzer_log" >&2
  exit 1
fi

printf 'isolated-systemd-verify=PASS unit=depress-web.service systemd-major=%s dependencies=sysinit.target,network-online.target\n' \
  "$analyzer_version"
