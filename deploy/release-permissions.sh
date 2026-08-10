#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo "release-permissions.sh must run as root" >&2
  exit 1
fi
if [[ $# -ne 2 || ( $1 != normalize && $1 != verify ) ]]; then
  echo "usage: release-permissions.sh <normalize|verify> <release-directory>" >&2
  exit 2
fi

readonly action=$1
readonly requested_release=$2
readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly identity_exec="${DEPRESS_IDENTITY_EXEC_BIN:-${script_dir}/run-as-identity.sh}"
readonly depress_root=${DEPRESS_ROOT:-/opt/depress}
readonly release_group=${DEPRESS_RELEASE_GROUP:-depress-release}
readonly api_user=${DEPRESS_API_USER:-depress-api}
readonly api_group=${DEPRESS_API_GROUP:-depress-api}
readonly outbox_user=${DEPRESS_OUTBOX_USER:-depress-outbox}
readonly outbox_group=${DEPRESS_OUTBOX_GROUP:-depress-outbox}
readonly worker_user=${DEPRESS_WORKER_USER:-depress-worker}
readonly worker_group=${DEPRESS_WORKER_GROUP:-depress-worker}
readonly migration_user=${DEPRESS_MIGRATION_USER:-depress-migration}
readonly migration_group=${DEPRESS_MIGRATION_GROUP:-depress-migration}
readonly cleanup_user=${DEPRESS_CLEANUP_USER:-depress-cleanup}
readonly cleanup_group=${DEPRESS_CLEANUP_GROUP:-depress-cleanup}
readonly web_user=${DEPRESS_WEB_USER:-depress-web}
readonly web_group=${DEPRESS_WEB_GROUP:-depress-web}
readonly -a runtime_users=(
  "$web_user" "$api_user" "$outbox_user" "$worker_user" "$migration_user"
  "$cleanup_user"
)
readonly -a private_groups=(
  "$web_group" "$api_group" "$outbox_group" "$worker_group" "$migration_group"
  "$cleanup_group"
)
active_failure_classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT

[[ -f "$identity_exec" && ! -L "$identity_exec" ]] || {
  echo "classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT" >&2
  echo "release permission check failed: identity runner is missing or a symlink" >&2
  exit 1
}
# shellcheck disable=SC1090
source "$identity_exec"

fail() {
  printf 'classification=%s\n' "$active_failure_classification" >&2
  echo "release permission check failed: $*" >&2
  exit 1
}

assert_safe_release_path() {
  local releases_real release_real

  [[ -d "$depress_root" && ! -L "$depress_root" ]] ||
    fail "release root is missing or a symlink"
  [[ -d "$depress_root/releases" && ! -L "$depress_root/releases" ]] ||
    fail "releases directory is missing or a symlink"
  [[ -d "$requested_release" && ! -L "$requested_release" ]] ||
    fail "release directory is missing or a symlink"
  releases_real=$(realpath -e -- "$depress_root/releases") ||
    fail "cannot resolve releases directory"
  release_real=$(realpath -e -- "$requested_release") ||
    fail "cannot resolve release directory"
  [[ "$(dirname -- "$release_real")" == "$releases_real" ]] ||
    fail "release must be an immediate child of the releases directory"
  printf '%s\n' "$release_real"
}

assert_symlink_boundary() {
  local release_real=$1
  local link target

  while IFS= read -r -d '' link; do
    target=$(realpath -e -- "$link") ||
      fail "release contains a dangling or looping symlink: ${link}"
    case "$target" in
      "$release_real"|"$release_real"/*) ;;
      *) fail "release symlink escapes the release root: ${link}" ;;
    esac
  done < <(find "$release_real" -xdev -type l -print0)
}

assert_no_shared_regular_inodes() {
  local release_real=$1
  local shared

  shared=$(find "$release_real" -xdev -type f -links +1 -print -quit)
  [[ -z "$shared" ]] ||
    fail "release contains a hard-linked regular file: ${shared}"
}

detach_shared_regular_inodes() {
  local release_real=$1
  local file replacement

  while IFS= read -r -d '' file; do
    replacement="$(mktemp "$(dirname -- "$file")/.depress-detach.XXXXXX")"
    cp --reflink=never --preserve=mode,timestamps -- "$file" "$replacement"
    chown root:"$release_group" "$replacement"
    mv -fT -- "$replacement" "$file"
  done < <(find "$release_real" -xdev -type f -links +1 -print0)
}

normalize_release() {
  local release_real=$1

  assert_symlink_boundary "$release_real"
  detach_shared_regular_inodes "$release_real"
  assert_no_shared_regular_inodes "$release_real"
  chown root:"$release_group" "$depress_root" "$depress_root/releases"
  chmod 0750 "$depress_root" "$depress_root/releases"
  find "$release_real" -xdev -type d -exec chown root:"$release_group" {} +
  find "$release_real" -xdev -type f -exec chown root:"$release_group" {} +
  find "$release_real" -xdev -type l -exec chown -h root:"$release_group" {} +
  find "$release_real" -xdev -type d -exec chmod 0750 {} +
  find "$release_real" -xdev -type f -perm /0111 -exec chmod 0750 {} +
  find "$release_real" -xdev -type f ! -perm /0111 -exec chmod 0640 {} +
}

assert_identity_matrix() {
  local index user private_group groups

  getent group "$release_group" >/dev/null 2>&1 ||
    fail "missing release group ${release_group}"
  for ((index=0; index<${#runtime_users[@]}; index++)); do
    user=${runtime_users[$index]}
    private_group=${private_groups[$index]}
    id "$user" >/dev/null 2>&1 || fail "missing runtime user ${user}"
    getent group "$private_group" >/dev/null 2>&1 ||
      fail "missing private group ${private_group}"
    [[ "$private_group" != "$release_group" ]] ||
      fail "release group cannot be a private primary group"
    [[ "$(id -gn "$user")" == "$private_group" ]] ||
      fail "${user} primary group changed from ${private_group}"
    groups=$(id -nG "$user" | tr ' ' '\n')
    grep -Fxq "$release_group" <<<"$groups" ||
      fail "${user} is not a member of ${release_group}"
  done
}

assert_exact_metadata() {
  local release_real=$1
  local unexpected

  [[ "$(stat -c '%U:%G:%a' "$depress_root")" == "root:${release_group}:750" ]] ||
    fail "release root metadata is not root:${release_group}:0750"
  [[ "$(stat -c '%U:%G:%a' "$depress_root/releases")" == "root:${release_group}:750" ]] ||
    fail "releases metadata is not root:${release_group}:0750"
  unexpected=$(find "$release_real" -xdev -type d \
    \( \! -user root -o \! -group "$release_group" -o \
    \! -perm 0750 \) -print -quit)
  [[ -z "$unexpected" ]] || fail "directory metadata mismatch: ${unexpected}"
  unexpected=$(find "$release_real" -xdev -type f \
    \( \! -user root -o \! -group "$release_group" \) -print -quit)
  [[ -z "$unexpected" ]] || fail "file ownership mismatch: ${unexpected}"
  unexpected=$(find "$release_real" -xdev -type f \
    \! -perm 0640 \! -perm 0750 -print -quit)
  [[ -z "$unexpected" ]] || fail "regular file mode mismatch: ${unexpected}"
  unexpected=$(find "$release_real" -xdev -type l \
    \( \! -user root -o \! -group "$release_group" \) -print -quit)
  [[ -z "$unexpected" ]] || fail "symlink ownership mismatch: ${unexpected}"
}

assert_runtime_access() {
  local release_real=$1
  local user unreadable untraversable writable
  local command_status stderr_file

  run_identity_check() {
    local category=$1
    local target_user=$2
    shift 2
    stderr_file=$(mktemp /tmp/depress-identity-check.XXXXXX)
    command_status=0
    set +e
    identity_check_output=$(
      run_as_identity_from_safe_cwd "$target_user" "$@" 2> "$stderr_file"
    ) || command_status=$?
    set -e
    if [[ -s "$stderr_file" ]]; then
      cat "$stderr_file" >&2
    fi
    if (( command_status != 0 )); then
      if grep -Fq 'Failed to restore initial working directory' "$stderr_file"; then
        printf 'classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT command_category=%s target_identity=%s safe_cwd=/ command_exit_code=%s release_check_result=ERROR diagnostic_capture_status=SUCCESS\n' \
          "$category" "$target_user" "$command_status" >&2
        rm -- "$stderr_file"
        return 86
      else
        printf 'classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT command_category=%s target_identity=%s safe_cwd=/ command_exit_code=%s release_check_result=FAIL diagnostic_capture_status=SUCCESS\n' \
          "$category" "$target_user" "$command_status" >&2
      fi
      rm -- "$stderr_file"
      return "$command_status"
    fi
    rm -- "$stderr_file"
    printf 'command_category=%s target_identity=%s safe_cwd=/ command_exit_code=0 release_check_result=PASS diagnostic_capture_status=SUCCESS\n' \
      "$category" "$target_user" >> "${DEPRESS_IDENTITY_CHECK_SUMMARY:-/dev/null}"
    printf '%s' "$identity_check_output"
  }

  for user in "${runtime_users[@]}"; do
    unreadable=$(run_identity_check release-file-read "$user" \
      /usr/bin/find "$release_real" -xdev \
      -type f ! -readable -print -quit) || {
        command_status=$?
        (( command_status == 86 )) &&
          active_failure_classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT
        fail "${user} could not inspect release files"
      }
    [[ -z "$unreadable" ]] || fail "${user} cannot read ${unreadable}"
    untraversable=$(run_identity_check release-directory-traverse "$user" \
      /usr/bin/find "$release_real" -xdev \
      -type d ! -executable -print -quit) || {
        command_status=$?
        (( command_status == 86 )) &&
          active_failure_classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT
        fail "${user} could not inspect release directories"
      }
    [[ -z "$untraversable" ]] || fail "${user} cannot traverse ${untraversable}"
    writable=$(run_identity_check release-write-denial "$user" \
      /usr/bin/find "$release_real" -xdev \
      \( -type d -o -type f \) -writable -print -quit) || {
        command_status=$?
        (( command_status == 86 )) &&
          active_failure_classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT
        fail "${user} could not inspect release write permissions"
      }
    [[ -z "$writable" ]] || fail "${user} can write ${writable}"
    run_identity_check release-link-replacement-denial "$user" \
      /usr/bin/test ! -w "$depress_root" >/dev/null || {
        command_status=$?
        (( command_status == 86 )) &&
          active_failure_classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT
        fail "${user} can replace current or previous"
      }
  done
}

resolved_release=$(assert_safe_release_path)
readonly resolved_release
assert_identity_matrix
if [[ "$action" == normalize ]]; then
  normalize_release "$resolved_release"
fi
assert_symlink_boundary "$resolved_release"
assert_no_shared_regular_inodes "$resolved_release"
assert_exact_metadata "$resolved_release"
assert_runtime_access "$resolved_release"

printf 'release-permissions=PASS action=%s group=%s users=%s\n' \
  "$action" "$release_group" "${runtime_users[*]}"
