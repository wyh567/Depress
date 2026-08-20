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
  if [[ "${FAKE_BADHOST_EMPTY:-0}" == "1" ]]; then
    code=""
  else
    code="${FAKE_BADHOST_CODE:-000}"
  fi
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
# T-06F: let tests model a bad-host probe that fails at the transport
# level (curl exit 56 on an SSL EOF) or otherwise misbehaves, the same
# way real nginx unknown-Host rejection can. Only ever applies to the
# single, isolated unknown-Host request -- every other request on this
# fake curl keeps its normal exit-0 behavior.
if (( ${#host_headers[@]} == 1 )) && [[ "${host_headers[0]}" == 'Host: depress-internal.invalid' ]] && [[ -n "${FAKE_BADHOST_EXIT:-}" ]]; then
  if [[ -n "$format" ]]; then
    printf '%s' "$code"
  fi
  exit "${FAKE_BADHOST_EXIT}"
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
# --- T-06F regression -----------------------------------------------------
# A bad-host probe that fails at the transport level (curl exit 56, the same
# SSL EOF nginx produces when it rejects an unrecognized Host) must NOT abort
# health-check.sh before the existing 000/4xx contract check runs. With the
# fix, the overall health check must still PASS in this scenario, because
# "000" remains an accepted result for this probe.
FAKE_BADHOST_EXIT=56 \
  PATH="${SANDBOX}/bin:${PATH}" \
  HEALTH_ORIGIN=https://127.0.0.1:18443 \
  HEALTH_HOST_HEADER=de-press.xyz \
  DEPRESS_ROOT="${SANDBOX}/depress" \
  bash "${SCRIPT_DIR}/health-check.sh"
echo "PASS: health check tolerates bad-host curl exit 56 (SSL EOF, body 000) and still enforces the 000/4xx contract"

# --- T-06F negative: bad-host probe returns 200, exit 0 -------------------
# Prove the fix does not weaken the security contract: an unknown Host that
# is unexpectedly served (200) must still fail the health check.
if FAKE_BADHOST_CODE=200 \
  PATH="${SANDBOX}/bin:${PATH}" \
  HEALTH_ORIGIN=https://127.0.0.1:18443 \
  HEALTH_HOST_HEADER=de-press.xyz \
  DEPRESS_ROOT="${SANDBOX}/depress" \
  bash "${SCRIPT_DIR}/health-check.sh"; then
  echo "FAIL: health check must FAIL when the unknown-Host probe returns 200 (unknown host must be rejected, not served)" >&2
  exit 1
fi
echo "PASS: health check correctly fails when bad-host probe returns 200"

# --- T-06F negative: bad-host probe returns 500, exit 0 -------------------
if FAKE_BADHOST_CODE=500 \
  PATH="${SANDBOX}/bin:${PATH}" \
  HEALTH_ORIGIN=https://127.0.0.1:18443 \
  HEALTH_HOST_HEADER=de-press.xyz \
  DEPRESS_ROOT="${SANDBOX}/depress" \
  bash "${SCRIPT_DIR}/health-check.sh"; then
  echo "FAIL: health check must FAIL when the unknown-Host probe returns 500 (not an accepted 000/4xx result)" >&2
  exit 1
fi
echo "PASS: health check correctly fails when bad-host probe returns 500"

# --- T-06F negative: bad-host probe yields empty output, non-zero exit ----
# Proves the `|| true` fix does not swallow every curl failure into a PASS:
# an empty status string (unmatched by "000" or ^4[0-9][0-9]$) must still
# fail the health check even though the curl call itself is tolerated.
if FAKE_BADHOST_EMPTY=1 FAKE_BADHOST_EXIT=7 \
  PATH="${SANDBOX}/bin:${PATH}" \
  HEALTH_ORIGIN=https://127.0.0.1:18443 \
  HEALTH_HOST_HEADER=de-press.xyz \
  DEPRESS_ROOT="${SANDBOX}/depress" \
  bash "${SCRIPT_DIR}/health-check.sh"; then
  echo "FAIL: health check must FAIL when the bad-host probe yields empty output on failure (curl failure must not be silently accepted)" >&2
  exit 1
fi
echo "PASS: health check correctly fails when bad-host probe yields empty output on a non-zero, non-56 exit"
