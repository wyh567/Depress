#!/usr/bin/env bash

readonly DEPRESS_IDENTITY_TRUSTED_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
readonly DEPRESS_IDENTITY_SAFE_CWD="/"
readonly DEPRESS_IDENTITY_SAFE_HOME="/nonexistent"

run_as_identity_from_safe_cwd() {
  local identity=${1:-}
  shift || true

  [[ -n "$identity" ]] || {
    echo "identity runner requires a target identity" >&2
    return 64
  }
  id "$identity" >/dev/null 2>&1 || {
    echo "identity runner target does not exist: ${identity}" >&2
    return 67
  }
  [[ $# -gt 0 && "$1" == /* && -x "$1" ]] || {
    echo "identity runner requires an absolute executable command" >&2
    return 64
  }

  runuser -u "$identity" -- /usr/bin/env -i \
    PATH="$DEPRESS_IDENTITY_TRUSTED_PATH" \
    HOME="$DEPRESS_IDENTITY_SAFE_HOME" \
    XDG_CACHE_HOME="$DEPRESS_IDENTITY_SAFE_HOME" \
    TMPDIR=/tmp \
    /bin/sh -c '
      cd / || exit 125
      exec "$@"
    ' sh "$@"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  if [[ ${EUID} -ne 0 ]]; then
    echo "run-as-identity.sh must run as root" >&2
    exit 1
  fi
  run_as_identity_from_safe_cwd "$@"
fi
