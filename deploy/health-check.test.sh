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
host_headers=()
while (($# > 0)); do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w) format="$2"; shift 2 ;;
    --header)
      [[ "$2" == Host:* ]] && host_headers+=("$2")
      shift 2
      ;;
    *) url="$1"; shift ;;
  esac
done
code=200
if (( ${#host_headers[@]} > 1 )); then
  # Models real production/nginx behavior: when a request carries BOTH
  # the normal Host header and the unknown-host one, the first one wins
  # on the wire and the normal vhost serves it (200) — it is NOT
  # rejected. This is deliberately not "if any header equals the bad
  # host, return 000": that older, weaker fake would have missed the
  # actual regression (health-check.sh inheriting the normal Host header
  # alongside the bad one), since it would have reported 000 regardless
  # of how many Host headers were actually sent.
  code=200
elif (( ${#host_headers[@]} == 1 )) && [[ "${host_headers[0]}" == 'Host: depress-internal.invalid' ]]; then
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

# Fidelity proof for the fake curl itself (T-06E): the real production
# regression was that health-check.sh's bad-host request carried the
# normal Host header ALONGSIDE the unknown-host one, and the normal one
# won on the wire (200), so the "unknown host is rejected" assertion
# passed against the wrong vhost. A fake that only checked "was the bad
# Host header present anywhere" could not have caught this. Prove the
# fake instead models the real duplicate-header behavior before relying
# on it below.
duplicate_status=$(PATH="${SANDBOX}/bin:${PATH}" curl --silent --show-error \
  --header 'Host: de-press.xyz' --header 'Host: depress-internal.invalid' \
  -o /dev/null -w '%{http_code}' https://127.0.0.1:18443/)
[[ "${duplicate_status}" != "000" && ! "${duplicate_status}" =~ ^4[0-9][0-9]$ ]] || {
  echo "FAIL: fake curl must model duplicate/leaked Host headers as reaching the normal vhost, not as an accepted unknown-host result (got ${duplicate_status})" >&2
  exit 1
}
echo "PASS: fake curl models duplicate Host header leakage the way real nginx does (normal vhost, ${duplicate_status}) — a health-check.sh regression back to CURL_ARGS here would fail this test"

single_bad_status=$(PATH="${SANDBOX}/bin:${PATH}" curl --silent --show-error \
  --header 'Host: depress-internal.invalid' \
  -o /dev/null -w '%{http_code}' https://127.0.0.1:18443/)
[[ "${single_bad_status}" == "000" || "${single_bad_status}" =~ ^4[0-9][0-9]$ ]] || {
  echo "FAIL: fake curl must reject a genuinely isolated unknown-host request (got ${single_bad_status})" >&2
  exit 1
}
echo "PASS: fake curl rejects a genuinely isolated unknown Host header (${single_bad_status})"

PATH="${SANDBOX}/bin:${PATH}" \
  HEALTH_ORIGIN=https://127.0.0.1:18443 \
  HEALTH_HOST_HEADER=de-press.xyz \
  DEPRESS_ROOT="${SANDBOX}/depress" \
  bash "${SCRIPT_DIR}/health-check.sh"

echo "PASS: health check covers Web root/static, same-origin API, private routes, and release state"
echo "PASS: health check's bad-host request sends exactly one Host header (no leakage from CURL_ARGS)"
