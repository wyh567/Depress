#!/usr/bin/env bash
set -euo pipefail

# Read-only Ubuntu 22.04 VM preflight. This script never installs packages,
# edits configuration, opens ports, or reads any DePress environment file.

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/resource-gates.sh
source "${script_dir}/resource-gates.sh"

failures=0
report() {
  printf '%s=%s\n' "$1" "$2"
}
require_command() {
  local command_name=$1
  if command -v "$command_name" >/dev/null 2>&1; then
    report "command_${command_name}" pass
  else
    report "command_${command_name}" missing
    failures=$((failures + 1))
  fi
}

main() {
  local cpu_count memory_kib swap_values swap_total_bytes swap_used_bytes
  local disk_available_bytes architecture systemd_version
  local df_capture

  # shellcheck disable=SC1091
  source /etc/os-release
  report os_id "${ID:-unknown}"
  report os_version "${VERSION_ID:-unknown}"
  [[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 22.04 ]] ||
    failures=$((failures + 1))

  architecture="$(uname -m)"
  report architecture "$architecture"
  [[ "$architecture" == x86_64 ]] || failures=$((failures + 1))

  if command -v systemd >/dev/null 2>&1; then
    systemd_version=$(systemd --version | awk 'NR == 1 { print $2 }')
    report systemd_version "${systemd_version:-unknown}"
    [[ "${systemd_version:-0}" == 249 ]] || failures=$((failures + 1))
  else
    report systemd_version missing
    failures=$((failures + 1))
  fi

  cpu_count="$(nproc 2>/dev/null || true)"
  memory_kib="$(read_memtotal_kib /proc/meminfo 2>/dev/null || true)"
  swap_values="$(read_enabled_swap_bytes /proc/swaps 2>/dev/null || true)"
  read -r swap_total_bytes swap_used_bytes <<< "$swap_values"
  df_capture="$(mktemp)"
  if ! df -B1 -P / > "$df_capture" 2>/dev/null; then
    : > "$df_capture"
  fi
  disk_available_bytes="$(
    read_df_available_bytes "$df_capture" 2>/dev/null || true
  )"
  rm -f -- "$df_capture"

  report cpu_count "${cpu_count:-invalid}"
  report memtotal_kib "${memory_kib:-invalid}"
  report memtotal_bytes "$(
    if is_nonnegative_integer "${memory_kib:-}"; then
      printf '%s' "$((memory_kib * 1024))"
    else
      printf 'invalid'
    fi
  )"
  report swap_total_bytes "${swap_total_bytes:-invalid}"
  report swap_used_bytes "${swap_used_bytes:-invalid}"
  report root_disk_available_bytes "${disk_available_bytes:-invalid}"

  cpu_gate_passes "$cpu_count" || failures=$((failures + 1))
  ram_class_gate_passes "$memory_kib" || failures=$((failures + 1))
  swap_gate_passes "${swap_total_bytes:-}" || failures=$((failures + 1))
  disk_gate_passes "$disk_available_bytes" || failures=$((failures + 1))

  for required in bash curl corepack git nginx node pnpm psql redis-server runuser ss systemctl systemd-analyze tar; do
    require_command "$required"
  done

  if command -v node >/dev/null 2>&1; then
    report node_version "$(node --version)"
  fi
  if command -v corepack >/dev/null 2>&1; then
    report pnpm_version "$(corepack pnpm --version 2>/dev/null || echo unavailable)"
  fi
  if command -v nginx >/dev/null 2>&1; then
    nginx -v 2>&1 | sed 's/^/nginx_version=/'
  fi
  if command -v docker >/dev/null 2>&1; then
    docker --version | sed 's/^/docker_version=/'
  fi

  for port in 80 443 3000 3001 5432 6379 9000 9001 2375 2376; do
    if ss -H -lnt "sport = :${port}" | grep -q .; then
      report port_${port} occupied
    else
      report port_${port} free
    fi
  done

  if (( failures > 0 )); then
    echo "host-preflight=FAIL failures=${failures}" >&2
    exit 1
  fi
  echo "host-preflight=PASS read-only=true"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
