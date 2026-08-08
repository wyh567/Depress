#!/usr/bin/env bash
set -euo pipefail

HEALTH_ORIGIN=${HEALTH_ORIGIN:-https://de-press.xyz}
HEALTH_HOST_HEADER=${HEALTH_HOST_HEADER:-de-press.xyz}
HEALTH_API_PATH=${HEALTH_API_PATH:-/api/auth/get-session}
HEALTH_PDF_PATH=${HEALTH_PDF_PATH:-}
DEPRESS_ROOT=${DEPRESS_ROOT:-/opt/depress}
HEALTH_SKIP_RELEASE_STATE=${HEALTH_SKIP_RELEASE_STATE:-0}
HEALTH_SKIP_BAD_HOST=${HEALTH_SKIP_BAD_HOST:-0}

CURL_ARGS=(
  --silent
  --show-error
  --connect-timeout 3
  --max-time 10
  --header "Host: ${HEALTH_HOST_HEADER}"
  --header "Accept: application/json"
)
if [[ "${HEALTH_INSECURE:-0}" == "1" ]]; then
  CURL_ARGS+=(--insecure)
elif [[ -n "${HEALTH_CA_FILE:-}" ]]; then
  CURL_ARGS+=(--cacert "${HEALTH_CA_FILE}")
fi

TMP_DIR=$(mktemp -d)
cleanup() {
  rm -rf -- "${TMP_DIR}"
}
trap cleanup EXIT

status_for() {
  local path=$1
  curl "${CURL_ARGS[@]}" -o /dev/null -w '%{http_code}' "${HEALTH_ORIGIN}${path}"
}

assert_status() {
  local label=$1
  local expected=$2
  local actual=$3
  [[ "${actual}" == "${expected}" ]] || {
    echo "health check failed: ${label} status=${actual}" >&2
    exit 1
  }
}

root_page="${TMP_DIR}/root.html"
root_status=$(curl "${CURL_ARGS[@]}" -o "${root_page}" -w '%{http_code}' "${HEALTH_ORIGIN}/")
assert_status web-root 200 "${root_status}"

static_path=$(grep -oE '/_next/static/[^"[:space:]]+' "${root_page}" | head -n 1 | sed 's/[?].*$//')
[[ -n "${static_path}" ]] || {
  echo "health check failed: Web root did not expose a static asset" >&2
  exit 1
}
static_status=$(status_for "${static_path}")
assert_status web-static 200 "${static_status}"

live_status=$(status_for /health/live)
ready_status=$(status_for /health/ready)
assert_status api-liveness 200 "${live_status}"
assert_status api-readiness 200 "${ready_status}"

api_status=$(status_for "${HEALTH_API_PATH}")
[[ "${api_status}" == "200" || "${api_status}" == "401" || "${api_status}" == "403" ]] || {
  echo "health check failed: same-origin API status=${api_status}" >&2
  exit 1
}

internal_status=$(status_for /api/internal/health-probe)
assert_status internal-api-hidden 404 "${internal_status}"
legacy_status=$(status_for /compile)
assert_status legacy-compile-hidden 404 "${legacy_status}"

if [[ "${HEALTH_SKIP_BAD_HOST}" != "1" ]]; then
  bad_host_status=$(curl "${CURL_ARGS[@]}" --header 'Host: depress-internal.invalid' \
    -o /dev/null -w '%{http_code}' "${HEALTH_ORIGIN}/")
  [[ "${bad_host_status}" == "000" || "${bad_host_status}" =~ ^4[0-9][0-9]$ ]] || {
    echo "health check failed: unknown host status=${bad_host_status}" >&2
    exit 1
  }
fi

if [[ -n "${HEALTH_PDF_PATH}" ]]; then
  pdf_file="${TMP_DIR}/download.pdf"
  pdf_status=$(curl "${CURL_ARGS[@]}" -o "${pdf_file}" -w '%{http_code}' \
    "${HEALTH_ORIGIN}${HEALTH_PDF_PATH}")
  assert_status pdf-download 200 "${pdf_status}"
  [[ "$(head -c 4 "${pdf_file}")" == "%PDF" ]] || {
    echo "health check failed: PDF download did not start with a PDF signature" >&2
    exit 1
  }
fi

if [[ "${HEALTH_SKIP_RELEASE_STATE}" != "1" ]]; then
  [[ -L "${DEPRESS_ROOT}/current" && -f "${DEPRESS_ROOT}/current/.depress-release" ]] || {
    echo "health check failed: current release marker is unavailable" >&2
    exit 1
  }
  for unit in depress-api depress-web; do
    systemctl is-active --quiet "${unit}" || {
      echo "health check failed: ${unit} is not active" >&2
      exit 1
    }
    systemctl show "${unit}" -p ExecStart --value | grep -Fq "/opt/depress/current" || {
      echo "health check failed: ${unit} does not use current release" >&2
      exit 1
    }
  done
fi

echo "nginx HTTPS, Web root/static, same-origin API, private routes, and API readiness succeeded"
