#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "run-as-identity.test.sh must run as root" >&2
  exit 1
fi

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly runner="${script_dir}/run-as-identity.sh"
readonly suffix="${BASHPID}"
readonly user="dpc${suffix}"
readonly group="$user"
readonly operator_cwd="$(mktemp -d /root/depress-identity-cwd.XXXXXX)"
created=0

cleanup() {
  local status=$?
  set +e
  if (( created == 1 )); then
    userdel "$user" || status=70
    getent group "$group" >/dev/null 2>&1 && groupdel "$group"
  fi
  if [[ "$operator_cwd" == /root/depress-identity-cwd.* &&
    -d "$operator_cwd" && ! -L "$operator_cwd" ]]; then
    find "$operator_cwd" -depth -mindepth 1 -delete
    rmdir "$operator_cwd"
  fi
  exit "$status"
}
trap cleanup EXIT

! id "$user" >/dev/null 2>&1
! getent group "$group" >/dev/null 2>&1
groupadd --system "$group"
useradd --system --no-create-home --shell /usr/sbin/nologin \
  --gid "$group" "$user"
created=1
chmod 0700 "$operator_cwd"
cd "$operator_cwd"

[[ "$(bash "$runner" "$user" /bin/pwd)" == / ]]
environment="$({
  UNTRUSTED_CALLER_VALUE=must-not-leak \
    bash "$runner" "$user" /usr/bin/env
})"
grep -Fxq 'HOME=/nonexistent' <<< "$environment"
grep -Fxq 'XDG_CACHE_HOME=/nonexistent' <<< "$environment"
grep -Fxq 'TMPDIR=/tmp' <<< "$environment"
grep -Fxq 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
  <<< "$environment"
! grep -Fq 'UNTRUSTED_CALLER_VALUE=' <<< "$environment"

status=0
bash "$runner" "$user" /bin/sh -c \
  'printf "safe-stdout\n"; printf "safe-stderr\n" >&2; exit 37' \
  > "${operator_cwd}/stdout.log" 2> "${operator_cwd}/stderr.log" || status=$?
[[ "$status" == 37 ]]
grep -Fxq safe-stdout "${operator_cwd}/stdout.log"
grep -Fxq safe-stderr "${operator_cwd}/stderr.log"
if bash "$runner" "$user" env > /dev/null 2>&1; then
  echo "identity runner test failed: relative executable was accepted" >&2
  exit 1
fi

echo "identity-safe-cwd-tests=PASS assertions=10 cwd=/ exit-code=37"
