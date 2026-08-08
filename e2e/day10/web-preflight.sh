#!/usr/bin/env bash
set -Eeuo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "${script_dir}/identity-topology.sh"

readonly release="/opt/depress/current"
readonly config_dir="/etc/depress-day10"
readonly web_unit="depress-web-day10.service"

web_pid="$(systemctl show "$web_unit" -p MainPID --value)"
[[ "$web_pid" =~ ^[1-9][0-9]*$ ]]
systemctl is-active --quiet "$web_unit"

nsenter -t "$web_pid" -m -- /bin/bash \
  "${release}/deploy/run-as-identity.sh" "$day10_web_user" \
  /usr/bin/test -r "${config_dir}/web.env"
if nsenter -t "$web_pid" -m -- /bin/bash \
  "${release}/deploy/run-as-identity.sh" "$day10_web_user" \
  /usr/bin/test -r "${config_dir}/api.env"; then
  echo "web-api-env-read=fail" >&2
  exit 1
fi
if nsenter -t "$web_pid" -m -- /bin/bash \
  "${release}/deploy/run-as-identity.sh" "$day10_web_user" \
  /usr/bin/test -r "${config_dir}/worker.env"; then
  echo "web-worker-env-read=fail" >&2
  exit 1
fi
if nsenter -t "$web_pid" -m -- /bin/bash \
  "${release}/deploy/run-as-identity.sh" "$day10_web_user" \
  /usr/bin/test -w "$release"; then
  echo "web-release-writable=fail" >&2
  exit 1
fi
nsenter -t "$web_pid" -m -- /bin/bash \
  "${release}/deploy/run-as-identity.sh" "$day10_web_user" \
  /usr/bin/test -w "$day10_web_runtime"

echo "web-preflight=pass env=web-only release-not-writable=pass runtime-writable=pass"
