#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SNIPPET="${SCRIPT_DIR}/depress-api.conf"
SANDBOX=$(mktemp -d)
TEST_HOST=depress-validation.invalid
cleanup() {
  rm -rf -- "${SANDBOX}"
}
trap cleanup EXIT

grep -Eq 'server 127\.0\.0\.1:3000' "${SNIPPET}"
grep -Eq 'server 127\.0\.0\.1:3001' "${SNIPPET}"
grep -Eq '^[[:space:]]*proxy_set_header Host \$host;' "${SNIPPET}"
grep -Eq '^[[:space:]]*proxy_set_header X-Forwarded-Host \$host;' "${SNIPPET}"
grep -Eq '^[[:space:]]*proxy_set_header X-Forwarded-Proto \$scheme;' "${SNIPPET}"
grep -Eq '^[[:space:]]*proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;' "${SNIPPET}"
grep -Eq '^[[:space:]]*proxy_set_header X-Real-IP \$remote_addr;' "${SNIPPET}"
grep -Eq '^[[:space:]]*proxy_pass http://depress_api;' "${SNIPPET}"
grep -Eq '^[[:space:]]*proxy_pass http://depress_web;' "${SNIPPET}"
grep -Eq '^[[:space:]]*return 301 https://\$host\$request_uri;' "${SNIPPET}"
! grep -Eq 'listen (3000|3001|5432|6379|9000|9001|2375|2376)' "${SNIPPET}"

if command -v nginx >/dev/null 2>&1; then
  mkdir -p "${SANDBOX}/tls" "${SANDBOX}/acme"
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
    -keyout "${SANDBOX}/tls/privkey.pem" \
    -out "${SANDBOX}/tls/fullchain.pem" \
    -subj "/CN=${TEST_HOST}" \
    -addext "subjectAltName=DNS:${TEST_HOST}" \
    >/dev/null 2>&1
  sed \
    -e "s#/etc/depress/tls#${SANDBOX}/tls#g" \
    -e "s#/var/www/depress-acme#${SANDBOX}/acme#g" \
    -e "s#de-press\\.xyz#${TEST_HOST}#g" \
    "${SNIPPET}" > "${SANDBOX}/snippet.conf"
  printf '%s\n' \
    'events {}' \
    'http {' \
    "  include ${SANDBOX}/snippet.conf;" \
    '}' > "${SANDBOX}/nginx.conf"
  nginx -t -p "${SANDBOX}" -c "${SANDBOX}/nginx.conf"
  echo "PASS: nginx syntax and local TLS certificate validation"
else
  echo "SKIP: nginx binary unavailable; static route and private-port checks passed"
fi

echo "PASS: nginx has one public API route and one public Web root route"
