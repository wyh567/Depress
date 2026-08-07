#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo "capture-service-evidence.sh must run as root" >&2
  exit 1
fi
if [[ $# -ne 3 ]]; then
  echo "usage: capture-service-evidence.sh UNIT JOURNAL_CURSOR OUTPUT_DIRECTORY" >&2
  exit 2
fi

readonly unit=$1
readonly cursor_argument=$2
readonly output_dir=$3
readonly status_file="${output_dir}/systemd-web-status.log"
readonly journal_file="${output_dir}/systemd-web-journal.log"
readonly state_file="${output_dir}/systemd-web-exec-status.txt"
readonly listener_file="${output_dir}/production-web-listener.txt"
readonly health_file="${output_dir}/production-web-health.txt"
readonly capture_file="${output_dir}/diagnostic-capture-status.txt"

write_capture_status() {
  [[ -d "$output_dir" && ! -L "$output_dir" &&
    "$(stat -c '%U:%G:%a' "$output_dir")" == root:root:700 ]] || return 1
  [[ ! -L "$capture_file" ]] || return 1
  if [[ -e "$capture_file" ]]; then
    [[ -f "$capture_file" &&
      "$(stat -c '%U:%G:%a' "$capture_file")" == root:root:600 ]] || return 1
  else
    install -o root -g root -m 0600 /dev/null "$capture_file"
  fi
  printf 'diagnostic_capture_status=%s\n' "$1" > "$capture_file"
  chmod 0600 "$capture_file"
}

fail() {
  write_capture_status FAILURE || true
  echo "service evidence capture failed: $*" >&2
  exit 1
}

sanitize_stream() {
  sed -E \
    -e 's/((DATABASE_URL|REDIS_URL|S3_[A-Z_]+|BETTER_AUTH_SECRET|AUTH_SECRET|PASSWORD|COOKIE|AUTHORIZATION)=)[^[:space:]]+/\1[REDACTED]/Ig' \
    -e 's#(postgres(ql)?|redis|https?)://[^/@[:space:]]+:[^/@[:space:]]+@#\1://[REDACTED]@#Ig' \
    -e 's/^(Authorization|Cookie|Set-Cookie):.*/\1: [REDACTED]/Ig' \
    -e 's/([0-9]{1,3}\.){3}[0-9]{1,3}/[IP_REDACTED]/g'
}

if [[ "$cursor_argument" == @/* ]]; then
  cursor_file=${cursor_argument#@}
  [[ -f "$cursor_file" && ! -L "$cursor_file" &&
    "$(stat -c '%U:%G:%a' "$cursor_file")" == root:root:600 ]] ||
    fail "cursor file is not a protected regular file"
  journal_cursor="$(cat "$cursor_file")"
else
  journal_cursor=$cursor_argument
fi
readonly journal_cursor

[[ "$unit" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || fail "invalid unit name"
[[ -n "$journal_cursor" && "$journal_cursor" == *=* && "$journal_cursor" != -* &&
  "$journal_cursor" =~ ^[A-Za-z0-9_.:=\;-]+$ &&
  "$journal_cursor" != *$'\n'* && "$journal_cursor" != *$'\r'* ]] ||
  fail "invalid journal cursor"
[[ -d "$output_dir" && ! -L "$output_dir" &&
  "$(stat -c '%U:%G:%a' "$output_dir")" == root:root:700 ]] ||
  fail "output directory must be root:root 0700"
for output in \
  "$status_file" "$journal_file" "$state_file" "$listener_file" \
  "$health_file"; do
  [[ ! -e "$output" && ! -L "$output" ]] ||
    fail "refusing to overwrite evidence output"
done

if ! systemctl status "$unit" --no-pager --full 2>&1 |
  sanitize_stream > "$status_file"; then
  # A failed unit makes status non-zero but its sanitized output is still useful.
  test -s "$status_file" || fail "systemctl status produced no evidence"
fi
if ! systemctl show "$unit" \
  -p Id -p ActiveState -p SubState -p Result -p ExecMainCode \
  -p ExecMainStatus -p InvocationID > "$state_file"; then
  fail "systemctl show failed"
fi
grep -Fxq "Id=${unit}" "$state_file" || fail "status is not bound to the target unit"
readonly invocation_id="$(sed -n 's/^InvocationID=//p' "$state_file")"
[[ "$invocation_id" =~ ^[0-9a-f]{32}$ ]] || fail "missing or invalid InvocationID"
if ! journalctl -u "$unit" --after-cursor="$journal_cursor" --no-pager \
  -o short-iso 2>&1 | sanitize_stream > "$journal_file"; then
  fail "journal cursor capture failed"
fi
test -s "$journal_file" || fail "journal cursor capture returned empty output"

if ! listener_output="$(ss -H -lnt 'sport = :3000' 2>&1)"; then
  fail "listener capture failed"
fi
if grep -Eq '127\.0\.0\.1:3000' <<<"$listener_output"; then
  printf 'loopback_listener_3000=PRESENT\n' > "$listener_file"
else
  printf 'loopback_listener_3000=ABSENT\n' > "$listener_file"
fi
if grep -Eq '(0\.0\.0\.0|\[::\]):3000' <<<"$listener_output"; then
  printf 'public_listener_3000=PRESENT\n' >> "$listener_file"
else
  printf 'public_listener_3000=ABSENT\n' >> "$listener_file"
fi
for endpoint in root:http://127.0.0.1:3000/ login:http://127.0.0.1:3000/login; do
  name=${endpoint%%:*}
  url=${endpoint#*:}
  set +e
  code=$(curl --silent --output /dev/null --write-out '%{http_code}' "$url")
  curl_status=$?
  set -e
  printf '%s_http_code=%s\n%s_curl_exit=%s\n' \
    "$name" "$code" "$name" "$curl_status" >> "$health_file"
done
chmod 0600 \
  "$status_file" "$journal_file" "$state_file" "$listener_file" "$health_file"

if grep -RIlE \
  'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|ssh-(rsa|ed25519) [A-Za-z0-9+/]{40,}|(DATABASE_URL|REDIS_URL|BETTER_AUTH_SECRET|AUTH_SECRET|PASSWORD|COOKIE|AUTHORIZATION)=[^[]' \
  "$status_file" "$journal_file" "$state_file" "$listener_file" "$health_file" |
  grep -q .; then
  fail "captured evidence contains sensitive material"
fi

write_capture_status SUCCESS
printf 'service-evidence=PASS unit=%s invocation_id=%s\n' "$unit" "$invocation_id"
