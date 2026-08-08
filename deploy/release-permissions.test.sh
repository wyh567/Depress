#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "release-permissions.test.sh must run as root" >&2
  exit 1
fi

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly helper="${script_dir}/release-permissions.sh"
readonly identity_runner="${script_dir}/run-as-identity.sh"
# shellcheck disable=SC1090
source "$identity_runner"
readonly sandbox="$(mktemp -d /tmp/depress-release-permissions.XXXXXX)"
readonly operator_cwd="$(mktemp -d /root/depress-operator-cwd.XXXXXX)"
readonly suffix="${BASHPID}"
readonly release_group="dpr${suffix}"
readonly -a users=("dpw${suffix}" "dpa${suffix}" "dpo${suffix}" "dpj${suffix}" "dpm${suffix}")
readonly -a groups=("dgw${suffix}" "dga${suffix}" "dgo${suffix}" "dgj${suffix}" "dgm${suffix}")
readonly root="${sandbox}/opt/depress"
readonly release="${root}/releases/test-release"
created_users=()
created_groups=()

cleanup() {
  local user group
  for user in "${created_users[@]}"; do
    pkill -KILL -u "$user" 2>/dev/null || true
    userdel "$user" 2>/dev/null || true
  done
  for group in "${created_groups[@]}"; do
    groupdel "$group" 2>/dev/null || true
  done
  [[ "$sandbox" == /tmp/depress-release-permissions.* ]] &&
    rm -rf -- "$sandbox"
  if [[ "$operator_cwd" == /root/depress-operator-cwd.* &&
    -d "$operator_cwd" && ! -L "$operator_cwd" ]]; then
    find "$operator_cwd" -depth -mindepth 1 -delete
    rmdir "$operator_cwd"
  fi
}
trap cleanup EXIT

fail() {
  echo "release permission test failed: $*" >&2
  exit 1
}

run_helper() {
  DEPRESS_ROOT="$root" \
    DEPRESS_RELEASE_GROUP="$release_group" \
    DEPRESS_WEB_USER="${users[0]}" DEPRESS_WEB_GROUP="${groups[0]}" \
    DEPRESS_API_USER="${users[1]}" DEPRESS_API_GROUP="${groups[1]}" \
    DEPRESS_OUTBOX_USER="${users[2]}" DEPRESS_OUTBOX_GROUP="${groups[2]}" \
    DEPRESS_WORKER_USER="${users[3]}" DEPRESS_WORKER_GROUP="${groups[3]}" \
    DEPRESS_MIGRATION_USER="${users[4]}" DEPRESS_MIGRATION_GROUP="${groups[4]}" \
    DEPRESS_IDENTITY_EXEC_BIN="${DEPRESS_IDENTITY_EXEC_BIN:-$identity_runner}" \
    bash "$helper" "$@"
}

expect_verify_rejection() {
  local label=$1
  if run_helper verify "$release" >"${sandbox}/${label}.log" 2>&1; then
    fail "${label} was accepted"
  fi
  grep -Fq 'classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT' \
    "${sandbox}/${label}.log"
}

chmod 0711 "$sandbox"
groupadd --system "$release_group"
created_groups+=("$release_group")
for group in "${groups[@]}"; do
  groupadd --system "$group"
  created_groups=("$group" "${created_groups[@]}")
done
for index in "${!users[@]}"; do
  useradd --system --no-create-home --shell /usr/sbin/nologin \
    --gid "${groups[$index]}" "${users[$index]}"
  created_users=("${users[$index]}" "${created_users[@]}")
  usermod -aG "$release_group" "${users[$index]}"
done

install -d -o root -g root -m 0755 \
  "$root/releases" \
  "$release/node_modules/.pnpm/next-test/node_modules/next/dist/server" \
  "$release/apps/web/.next/server" \
  "$release/apps/api/dist" \
  "$release/packages/ast/dist" \
  "$release/packages/transformers/dist" \
  "$release/bin"
printf '%s\n' 'module.exports = {}' \
  > "$release/node_modules/.pnpm/next-test/node_modules/next/dist/server/require-hook.js"
printf '%s\n' web > "$release/apps/web/.next/server/runtime.js"
printf '%s\n' api > "$release/apps/api/dist/index.js"
printf '%s\n' ast > "$release/packages/ast/dist/index.js"
printf '%s\n' transformers > "$release/packages/transformers/dist/index.js"
printf '%s\n' '#!/usr/bin/env node' > "$release/bin/next"
chmod 0755 "$release/bin/next"
ln -s .pnpm/next-test/node_modules/next "$release/node_modules/next"

run_helper normalize "$release" >/dev/null
run_helper verify "$release" >/dev/null
[[ "$(stat -c '%U:%G:%a' "$root")" == "root:${release_group}:750" ]]
[[ "$(stat -c '%U:%G:%a' "$release")" == "root:${release_group}:750" ]]
[[ "$(stat -c '%U:%G:%a' "$release/apps/api/dist/index.js")" == \
  "root:${release_group}:640" ]]
[[ "$(stat -c '%U:%G:%a' "$release/bin/next")" == \
  "root:${release_group}:750" ]]

chmod 0700 "$operator_cwd"
cd "$operator_cwd"
old_find_status=0
runuser -u "${users[0]}" -- /usr/bin/find "$release" -xdev \
  -type f ! -readable -print -quit \
  > "${sandbox}/old-find.stdout" 2> "${sandbox}/old-find.stderr" ||
  old_find_status=$?
[[ "$old_find_status" -ne 0 ]]
grep -Fq 'Failed to restore initial working directory' \
  "${sandbox}/old-find.stderr"
if ! run_helper verify "$release" \
  > "${sandbox}/safe-cwd.stdout" 2> "${sandbox}/safe-cwd.stderr"; then
  cat "${sandbox}/safe-cwd.stderr" >&2
  fail "valid Release failed from a root-only caller cwd"
fi
! grep -Fq 'Failed to restore initial working directory' \
  "${sandbox}/safe-cwd.stderr"
echo "PASS: root-only caller cwd is reproduced and neutralized"

broken_runner="${sandbox}/broken-identity-runner.sh"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'run_as_identity_from_safe_cwd() {' \
  '  local identity=$1' \
  '  shift' \
  '  runuser -u "$identity" -- "$@"' \
  '}' > "$broken_runner"
chmod 0755 "$broken_runner"
if DEPRESS_IDENTITY_EXEC_BIN="$broken_runner" run_helper verify "$release" \
  > "${sandbox}/broken-cwd.stdout" 2> "${sandbox}/broken-cwd.stderr"; then
  fail "broken identity runner was accepted"
fi
grep -Fq 'classification=HARNESS_PRIVILEGE_DROP_CWD_DEFECT' \
  "${sandbox}/broken-cwd.stderr"
! grep -Fq 'classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT' \
  "${sandbox}/broken-cwd.stderr"
echo "PASS: inaccessible inherited cwd is classified as a Harness defect"

for index in "${!users[@]}"; do
  [[ "$(id -gn "${users[$index]}")" == "${groups[$index]}" ]]
  run_as_identity_from_safe_cwd "${users[$index]}" /usr/bin/test \
    -r "$release/node_modules/next/dist/server/require-hook.js"
  ! run_as_identity_from_safe_cwd "${users[$index]}" \
    /usr/bin/touch "$release/new-file" 2>/dev/null
  ! run_as_identity_from_safe_cwd "${users[$index]}" /bin/sh -c \
    "printf changed > '$release/apps/api/dist/index.js'" 2>/dev/null
  ! run_as_identity_from_safe_cwd "${users[$index]}" \
    /usr/bin/rm "$release/apps/api/dist/index.js" 2>/dev/null
  ! run_as_identity_from_safe_cwd "${users[$index]}" /usr/bin/mv \
    "$release/apps/web/.next/server/runtime.js" \
    "$release/apps/web/.next/server/runtime-renamed.js" 2>/dev/null
  ! run_as_identity_from_safe_cwd "${users[$index]}" /usr/bin/ln \
    -s "$release" "$root/current" 2>/dev/null
done
echo "PASS: root:release-group modes allow five-identity reads and deny writes"

gpasswd -d "${users[0]}" "$release_group" >/dev/null
expect_verify_rejection missing-release-group
usermod -aG "$release_group" "${users[0]}"
chmod 0660 "$release/apps/api/dist/index.js"
expect_verify_rejection writable-runtime
chmod 0640 "$release/apps/api/dist/index.js"
echo "PASS: missing Release group and writable runtime fail closed"

chmod 0700 "$release/apps/web/.next"
expect_verify_rejection parent-0700
chmod 0750 "$release/apps/web/.next"
chmod 0600 "$release/node_modules/.pnpm/next-test/node_modules/next/dist/server/require-hook.js"
expect_verify_rejection runtime-0600
chmod 0640 "$release/node_modules/.pnpm/next-test/node_modules/next/dist/server/require-hook.js"
echo "PASS: 0700 parents and 0600 runtime files fail closed"

ln -s "$sandbox" "$release/escape-link"
expect_verify_rejection escaping-symlink
rm "$release/escape-link"
ln -s missing-target "$release/dangling-link"
expect_verify_rejection dangling-symlink
rm "$release/dangling-link"
ln -s loop-b "$release/loop-a"
ln -s loop-a "$release/loop-b"
expect_verify_rejection looping-symlink
rm "$release/loop-a" "$release/loop-b"
ln -s node_modules/next "$release/inside-link"
chown -h root:"$release_group" "$release/inside-link"
run_helper verify "$release" >/dev/null
echo "PASS: internal symlinks pass and escaping, dangling, and looping symlinks fail closed"

printf '%s\n' shared > "$sandbox/shared-file"
ln "$sandbox/shared-file" "$release/shared-file"
run_helper normalize "$release" >/dev/null
[[ "$(stat -c '%h' "$release/shared-file")" == 1 ]]
[[ "$(stat -c '%U:%G:%a' "$sandbox/shared-file")" != \
  "root:${release_group}:640" ]]
run_helper verify "$release" >/dev/null
echo "PASS: shared inodes are detached before Release metadata changes"

echo "release-permission-tests=PASS assertions=19"
