#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SANDBOX=$(mktemp -d)
cleanup() {
  rm -rf -- "${SANDBOX}"
}
trap cleanup EXIT

mkdir -p "${SANDBOX}/bin" "${SANDBOX}/depress/releases/test"
printf '%s\n' test > "${SANDBOX}/depress/releases/test/.depress-release"
ln -s "${SANDBOX}/depress/releases/test" "${SANDBOX}/depress/current"

cat > "${SANDBOX}/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
output=""
format=""
url=""
bad_host=0
while (($# > 0)); do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w) format="$2"; shift 2 ;;
    --header)
      [[ "$2" == 'Host: depress-internal.invalid' ]] && bad_host=1
      shift 2
      ;;
    *) url="$1"; shift ;;
  esac
done
code=200
if (( bad_host == 1 )); then
  code=000
elif [[ "$url" == */api/internal/health-probe || "$url" == */compile ]]; then
  code=404
fi
if [[ -n "$output" ]]; then
  if [[ "$url" == */ ]]; then
    printf '%s\n' '<html><script src="/_next/static/chunks/app.js"></script></html>' > "$output"
  else
    : > "$output"
  fi
fi
if [[ -n "$format" ]]; then
  printf '%s' "$code"
fi
CURL

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "${1:-}" == "show" ]]; then printf "%s\\n" "/opt/depress/current/apps/web/server.js"; exit 0; fi' \
  'exit 0' \
  > "${SANDBOX}/bin/systemctl"
chmod 0755 "${SANDBOX}/bin/curl" "${SANDBOX}/bin/systemctl"

PATH="${SANDBOX}/bin:${PATH}" \
  HEALTH_ORIGIN=https://127.0.0.1:18443 \
  HEALTH_HOST_HEADER=de-press.xyz \
  DEPRESS_ROOT="${SANDBOX}/depress" \
  bash "${SCRIPT_DIR}/health-check.sh"

echo "PASS: health check covers Web root/static, same-origin API, private routes, and release state"
