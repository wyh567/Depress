#!/usr/bin/env bash
set -euo pipefail

HEALTH_ORIGIN=${1:-http://127.0.0.1:3001}
CURL_ARGS=(
  --fail
  --silent
  --show-error
  --connect-timeout 3
  --max-time 5
  --header "Accept: application/json"
)

LIVE=$(curl "${CURL_ARGS[@]}" "${HEALTH_ORIGIN}/health/live")
READY=$(curl "${CURL_ARGS[@]}" "${HEALTH_ORIGIN}/health/ready")
[[ "${LIVE}" == '{"status":"alive"}' ]]
[[ "${READY}" == '{"status":"ready"}' ]]
echo "API liveness and readiness succeeded"
