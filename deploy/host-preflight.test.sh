#!/usr/bin/env bash
set -euo pipefail

readonly test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/resource-gates.sh
source "${test_dir}/resource-gates.sh"

work="$(mktemp -d)"
cleanup() {
  rm -rf -- "$work"
}
trap cleanup EXIT

pass_count=0
expect_pass() {
  local name=$1
  shift
  "$@" || {
    echo "expected PASS: ${name}" >&2
    exit 1
  }
  pass_count=$((pass_count + 1))
}
expect_fail() {
  local name=$1
  shift
  if "$@"; then
    echo "expected rejection: ${name}" >&2
    exit 1
  fi
  pass_count=$((pass_count + 1))
}

write_meminfo() {
  printf 'MemTotal:       %s kB\nMemAvailable:   3006976 kB\n' "$1" \
    > "${work}/meminfo"
}

write_swap() {
  local size_kib=$1
  local used_kib=${2:-0}
  printf 'Filename Type Size Used Priority\n/dev/zram0 partition %s %s -2\n' \
    "$size_kib" "$used_kib" > "${work}/swaps"
}

write_df() {
  printf 'Filesystem 1B-blocks Used Available Use%% Mounted on\n/dev/root 50000000000 10000000000 %s 20%% /\n' \
    "$1" > "${work}/df"
}

write_meminfo 3579036
expect_pass "3579036 kB target RAM" \
  test "$(read_memtotal_kib "${work}/meminfo")" -eq 3579036
expect_pass "3579036 kB RAM gate" ram_class_gate_passes 3579036
expect_pass "exact RAM boundary" ram_class_gate_passes 3407872
expect_fail "one KiB below RAM boundary" ram_class_gate_passes 3407871
expect_fail "3 GiB class RAM" ram_class_gate_passes 3145728

printf 'MemAvailable: 1000 kB\n' > "${work}/meminfo"
expect_fail "missing MemTotal" read_memtotal_kib "${work}/meminfo"
printf 'MemTotal: not-a-number kB\n' > "${work}/meminfo"
expect_fail "non-numeric MemTotal" read_memtotal_kib "${work}/meminfo"

expect_pass "2 CPU" cpu_gate_passes 2
expect_fail "1 CPU" cpu_gate_passes 1

write_swap 2097152
read -r swap_total swap_used < <(read_enabled_swap_bytes "${work}/swaps")
expect_pass "2 GiB enabled swap" swap_gate_passes "$swap_total"
test "$swap_used" -eq 0
write_swap 1572864
read -r swap_total _ < <(read_enabled_swap_bytes "${work}/swaps")
expect_pass "exact 1.5 GiB enabled swap" swap_gate_passes "$swap_total"
write_swap 1572863
read -r swap_total _ < <(read_enabled_swap_bytes "${work}/swaps")
expect_fail "swap below 1.5 GiB" swap_gate_passes "$swap_total"
printf 'Filename Type Size Used Priority\n' > "${work}/swaps"
expect_fail "no enabled swap" read_enabled_swap_bytes "${work}/swaps"

write_df 21474836480
expect_pass "exact 20 GiB disk available" \
  disk_gate_passes "$(read_df_available_bytes "${work}/df")"
write_df 21474836479
expect_fail "disk below 20 GiB" \
  disk_gate_passes "$(read_df_available_bytes "${work}/df")"
write_df invalid
expect_fail "invalid df value" read_df_available_bytes "${work}/df"

printf 'host-preflight-boundaries=PASS assertions=%s\n' "$pass_count"
