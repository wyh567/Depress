#!/usr/bin/env bash
set -Eeuo pipefail

readonly mode="${1:-}"
readonly release="/opt/depress/current"
readonly config_dir="/etc/depress-day10"
readonly worker_env="${config_dir}/worker.env"
readonly worker_unit="depress-pointer-worker.service"
readonly worker_runtime="/run/depress-worker"

run_worker_with_env() {
  (
    set -a
    # shellcheck disable=SC1090
    source "$worker_env"
    set +a
    export HOME="$worker_runtime"
    export TMPDIR="$worker_runtime"
    runuser -u depress-worker --preserve-environment -- "$@"
  )
}

run_worker_api_check() {
  local check_name="$1"
  run_worker_with_env \
    "${release}/apps/api/node_modules/.bin/tsx" \
    /mnt/d/depress/e2e/day10/worker-preflight.mts "$check_name"
}

safe_check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "${label}=pass"
    return 0
  fi
  echo "${label}=fail" >&2
  return 1
}

independent_checks() {
  install -d -o depress-worker -g depress-runtime -m 0700 "$worker_runtime"

  safe_check production-parser run_worker_api_check config
  safe_check postgresql-connection run_worker_api_check postgres
  safe_check redis-connection run_worker_api_check redis
  safe_check s3-configuration run_worker_api_check s3

  safe_check docker-socket run_worker_with_env /usr/bin/docker info

  local typst_image typst_font_path
  typst_image="$(sed -n 's/^TYPST_IMAGE=//p' "$worker_env")"
  typst_font_path="$(sed -n 's/^TYPST_FONT_PATH=//p' "$worker_env")"
  [[ -n "$typst_image" && -n "$typst_font_path" ]]

  safe_check typst-image run_worker_with_env /usr/bin/docker image inspect "$typst_image"
  safe_check configured-font run_worker_with_env \
    /usr/bin/find "$typst_font_path" -maxdepth 1 -type f -readable -print -quit
  safe_check release-readable run_worker_with_env /usr/bin/test -r "${release}/.depress-release"
  if run_worker_with_env /usr/bin/test -w "$release"; then
    echo "release-not-writable=fail" >&2
    return 1
  fi
  echo "release-not-writable=pass"
}

idle_checks() {
  systemctl is-active --quiet "$worker_unit"
  local initial_pid initial_restarts
  initial_pid="$(systemctl show "$worker_unit" -p MainPID --value)"
  initial_restarts="$(systemctl show "$worker_unit" -p NRestarts --value)"
  [[ "$initial_pid" =~ ^[1-9][0-9]*$ ]]

  safe_check worker-runtime-writable \
    nsenter -t "$initial_pid" -m -- runuser -u depress-worker -- \
    /usr/bin/test -w "$worker_runtime"
  safe_check release-readable-in-unit \
    nsenter -t "$initial_pid" -m -- runuser -u depress-worker -- \
    /usr/bin/test -r "${release}/.depress-release"
  if nsenter -t "$initial_pid" -m -- runuser -u depress-worker -- \
    /usr/bin/test -w "$release"; then
    echo "release-not-writable-in-unit=fail" >&2
    return 1
  fi
  echo "release-not-writable-in-unit=pass"

  sleep 60

  systemctl is-active --quiet "$worker_unit"
  [[ "$(systemctl show "$worker_unit" -p MainPID --value)" == "$initial_pid" ]]
  [[ "$(systemctl show "$worker_unit" -p NRestarts --value)" == "$initial_restarts" ]]
  echo "worker-idle-stability=pass seconds=60 restarts=${initial_restarts}"
}

case "$mode" in
  independent)
    independent_checks
    ;;
  idle)
    idle_checks
    ;;
  *)
    echo "usage: worker-preflight.sh independent|idle" >&2
    exit 64
    ;;
esac
