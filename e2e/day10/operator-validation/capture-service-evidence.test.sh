#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "capture-service-evidence.test.sh must run as root" >&2
  exit 1
fi

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly capture="${script_dir}/capture-service-evidence.sh"
readonly sandbox="$(mktemp -d /tmp/depress-evidence-capture.XXXXXX)"
readonly bin="${sandbox}/bin"
readonly output="${sandbox}/output"
readonly valid_cursor='s=0123456789abcdef;i=1;b=0123456789abcdef0123456789abcdef;m=1;t=1;x=1'

cleanup() {
  [[ "$sandbox" == /tmp/depress-evidence-capture.* ]] && rm -rf -- "$sandbox"
}
trap cleanup EXIT
install -d -o root -g root -m 0700 "$bin" "$output"

cat > "$bin/systemctl" <<'SYSTEMCTL'
#!/usr/bin/env bash
case "$1" in
  status)
    echo 'depress-web.service active token DATABASE_URL=must-not-survive'
    ;;
  show)
    cat <<'STATE'
Id=depress-web.service
ActiveState=active
SubState=running
Result=success
ExecMainCode=1
ExecMainStatus=0
InvocationID=0123456789abcdef0123456789abcdef
STATE
    ;;
  *) exit 64 ;;
esac
SYSTEMCTL
cat > "$bin/journalctl" <<JOURNALCTL
#!/usr/bin/env bash
[[ "\$*" == *'--after-cursor=${valid_cursor}'* ]] || exit 23
echo 'service ready COOKIE=must-not-survive at 10.20.30.40'
JOURNALCTL
cat > "$bin/ss" <<'SS'
#!/usr/bin/env bash
echo 'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*'
SS
cat > "$bin/curl" <<'CURL'
#!/usr/bin/env bash
printf '200'
CURL
chmod 0755 "$bin"/*

env -i PATH="$bin:/usr/bin:/bin" \
  bash "$capture" depress-web.service "$valid_cursor" "$output" >/dev/null
grep -Fxq 'diagnostic_capture_status=SUCCESS' \
  "$output/diagnostic-capture-status.txt"
grep -Fq 'DATABASE_URL=[REDACTED]' "$output/systemd-web-status.log"
grep -Fq 'COOKIE=[REDACTED]' "$output/systemd-web-journal.log"
grep -Fq '[IP_REDACTED]' "$output/systemd-web-journal.log"
! grep -RIFq 'must-not-survive' "$output"
grep -Fxq 'loopback_listener_3000=PRESENT' \
  "$output/production-web-listener.txt"
grep -Fxq 'public_listener_3000=ABSENT' \
  "$output/production-web-listener.txt"
grep -Fxq 'root_http_code=200' "$output/production-web-health.txt"
grep -Fxq 'login_http_code=200' "$output/production-web-health.txt"
echo "PASS: cursor-bound evidence is sanitized and includes status, journal, listener, and health"

readonly invalid_output="${sandbox}/invalid-output"
install -d -o root -g root -m 0700 "$invalid_output"
if env -i PATH="$bin:/usr/bin:/bin" \
  bash "$capture" depress-web.service invalid-cursor "$invalid_output" \
  >"${sandbox}/invalid.log" 2>&1; then
  echo "capture test failed: invalid cursor was accepted" >&2
  exit 1
fi
grep -Fxq 'diagnostic_capture_status=FAILURE' \
  "$invalid_output/diagnostic-capture-status.txt"
echo "PASS: invalid cursors produce an explicit diagnostic failure"

echo "service-evidence-capture-tests=PASS assertions=10"
