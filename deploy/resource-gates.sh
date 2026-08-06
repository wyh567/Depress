#!/usr/bin/env bash

# Exact, auditable resource thresholds shared by the read-only host preflight
# and the Workbench target-validation harness.
readonly MIN_4G_CLASS_MEMTOTAL_KIB=3407872
readonly MIN_CPU_COUNT=2
readonly MIN_SWAP_TOTAL_BYTES=1610612736
readonly MIN_ROOT_DISK_AVAILABLE_BYTES=21474836480

is_nonnegative_integer() {
  [[ "${1:-}" =~ ^[0-9]+$ ]]
}

read_meminfo_kib() {
  local key=$1
  local meminfo_file=$2

  awk -v wanted="${key}:" '
    $1 == wanted {
      count++
      if (NF != 3 || $2 !~ /^[0-9]+$/ || $3 != "kB") {
        invalid = 1
      }
      value = $2
    }
    END {
      if (count != 1 || invalid) {
        exit 1
      }
      print value
    }
  ' "$meminfo_file"
}

read_memtotal_kib() {
  read_meminfo_kib MemTotal "$1"
}

read_memavailable_bytes() {
  local memavailable_kib
  memavailable_kib="$(read_meminfo_kib MemAvailable "$1")" || return 1
  printf '%s\n' "$((memavailable_kib * 1024))"
}

read_enabled_swap_bytes() {
  local swaps_file=$1

  awk '
    NR == 1 {
      if ($1 != "Filename" || $3 != "Size" || $4 != "Used") {
        exit 1
      }
      next
    }
    {
      if ($3 !~ /^[0-9]+$/ || $4 !~ /^[0-9]+$/) {
        invalid = 1
        next
      }
      count++
      total += $3
      used += $4
    }
    END {
      if (NR < 1 || count < 1 || invalid || total <= 0) {
        exit 1
      }
      printf "%.0f %.0f\n", total * 1024, used * 1024
    }
  ' "$swaps_file"
}

read_df_available_bytes() {
  local df_file=$1

  awk '
    NR == 1 { next }
    NR == 2 {
      if ($4 !~ /^[0-9]+$/) {
        exit 1
      }
      value = $4
      count++
      next
    }
    NF { extra = 1 }
    END {
      if (count != 1 || extra) {
        exit 1
      }
      print value
    }
  ' "$df_file"
}

ram_class_gate_passes() {
  local memtotal_kib=${1:-}
  is_nonnegative_integer "$memtotal_kib" &&
    ((memtotal_kib >= MIN_4G_CLASS_MEMTOTAL_KIB))
}

cpu_gate_passes() {
  local cpu_count=${1:-}
  is_nonnegative_integer "$cpu_count" &&
    ((cpu_count >= MIN_CPU_COUNT))
}

swap_gate_passes() {
  local swap_total_bytes=${1:-}
  is_nonnegative_integer "$swap_total_bytes" &&
    ((swap_total_bytes >= MIN_SWAP_TOTAL_BYTES))
}

disk_gate_passes() {
  local disk_available_bytes=${1:-}
  is_nonnegative_integer "$disk_available_bytes" &&
    ((disk_available_bytes >= MIN_ROOT_DISK_AVAILABLE_BYTES))
}
