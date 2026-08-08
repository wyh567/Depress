#!/usr/bin/env bash

mode_manifest_path_is_safe() {
  local path=${1:-}
  [[ -n "$path" && "$path" != /* && "$path" != *".."* && "$path" != *$'\n'* ]]
}

mode_manifest_mode_is_allowed() {
  [[ "${1:-}" == 0644 || "${1:-}" == 0755 ]]
}

load_mode_manifest() {
  local manifest=$1
  local target_name=$2
  local line mode path
  local -n target=$target_name

  [[ -f "$manifest" && ! -L "$manifest" ]] || return 1
  target=()
  while IFS= read -r line; do
    [[ ${#line} -ge 7 && "${line:4:2}" == "  " ]] || return 1
    mode="${line:0:4}"
    path="${line:6}"
    mode_manifest_mode_is_allowed "$mode" || return 1
    mode_manifest_path_is_safe "$path" || return 1
    [[ -z "${target[$path]+present}" ]] || return 1
    target["$path"]=$mode
  done < "$manifest"
  (( ${#target[@]} > 0 ))
}

verify_mode_manifest_paths() {
  local manifest=$1
  local changed_paths=$2

  ! comm -3 \
    <(LC_ALL=C sort -u "$changed_paths") \
    <(
      awk '{ sub(/^[0-7]{4}  /, ""); print }' "$manifest" |
        LC_ALL=C sort -u
    ) |
    grep -q .
}

restore_exact_mode() {
  local mode=$1
  local path=$2

  mode_manifest_mode_is_allowed "$mode" || return 1
  [[ -f "$path" && ! -L "$path" ]] || return 1
  chmod -- "$mode" "$path"
  [[ "0$(stat -c '%a' "$path")" == "$mode" ]]
}

verify_mode_manifest_tree() {
  local manifest=$1
  local root=$2
  local line mode path

  while IFS= read -r line; do
    [[ ${#line} -ge 7 && "${line:4:2}" == "  " ]] || return 1
    mode="${line:0:4}"
    path="${line:6}"
    mode_manifest_mode_is_allowed "$mode" || return 1
    mode_manifest_path_is_safe "$path" || return 1
    [[ -f "${root}/${path}" && ! -L "${root}/${path}" ]] || return 1
    [[ "0$(stat -c '%a' "${root}/${path}")" == "$mode" ]] || return 1
  done < "$manifest"
}
