#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo "create-operator-result.sh must run as root" >&2
  exit 1
fi
if [[ $# -ne 4 ]]; then
  echo "usage: create-operator-result.sh RUN_ID EVIDENCE_DIR RAW_DIR NEW_ARCHIVE.tar.gz" >&2
  exit 2
fi

readonly run_id=$1
readonly evidence_dir=$2
readonly raw_dir=$3
readonly archive=$4
readonly sha_file="${archive}.sha256"
readonly result_name="operator-result-${run_id}"
readonly stage="$(mktemp -d /tmp/depress-operator-result.XXXXXX)"
readonly result_dir="${stage}/${result_name}"

cleanup() {
  rm -rf -- "$stage"
}
trap cleanup EXIT

fail() {
  echo "operator result creation failed: $*" >&2
  exit 1
}

[[ "$run_id" =~ ^[0-9a-f]{40}$ ]] || fail "invalid run ID"
[[ -d "$evidence_dir" && ! -L "$evidence_dir" &&
  "$(stat -c '%U:%G:%a' "$evidence_dir")" == root:root:700 ]] ||
  fail "evidence directory is not root:root 0700"
[[ -d "$raw_dir" && ! -L "$raw_dir" &&
  "$(stat -c '%U:%G:%a' "$raw_dir")" == root:root:700 ]] ||
  fail "raw evidence directory is not root:root 0700"
[[ "$archive" == /* && "$archive" == *.tar.gz ]] || fail "archive path is invalid"
[[ ! -e "$archive" && ! -L "$archive" &&
  ! -e "$sha_file" && ! -L "$sha_file" ]] ||
  fail "refusing to overwrite an operator result"

install -d -o root -g root -m 0700 "$result_dir"
readonly -a evidence_files=(
  "${evidence_dir}/durable-evidence.txt"
  "${raw_dir}/systemd-web-status.log"
  "${raw_dir}/systemd-web-journal.log"
  "${raw_dir}/systemd-web-exec-status.txt"
  "${raw_dir}/production-web-listener.txt"
  "${raw_dir}/production-web-health.txt"
  "${raw_dir}/diagnostic-capture-status.txt"
  "${raw_dir}/resource-summary.txt"
  "${raw_dir}/cleanup-summary.txt"
  "${raw_dir}/failure-classification.txt"
  "${raw_dir}/identity-check-summary.txt"
)
copied=0
for source in "${evidence_files[@]}"; do
  [[ -e "$source" || -L "$source" ]] || continue
  [[ -f "$source" && ! -L "$source" &&
    "$(stat -c '%U:%G:%a' "$source")" == root:root:600 ]] ||
    fail "allowlisted evidence is not a protected regular file: ${source}"
  install -o root -g root -m 0600 "$source" "$result_dir/$(basename "$source")"
  copied=$((copied + 1))
done
(( copied >= 4 )) || fail "operator result is missing required evidence"

if grep -RIlE \
  'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|ssh-(rsa|ed25519) [A-Za-z0-9+/]{40,}|(DATABASE_URL|REDIS_URL|S3_[A-Z_]+|BETTER_AUTH_SECRET|AUTH_SECRET|PASSWORD|COOKIE|AUTHORIZATION)=[^[]|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}' \
  "$result_dir" | grep -q .; then
  fail "operator result contains sensitive material"
fi
if find "$result_dir" -type f \
  \( -name '*.env' -o -name '*.key' -o -name '*.pem' -o -name '*.p12' \
  -o -name '*.pfx' -o -name 'id_rsa' -o -name 'id_ed25519' \) \
  -print -quit | grep -q .; then
  fail "operator result contains a forbidden path"
fi

tar --numeric-owner --owner=0 --group=0 -C "$stage" -czf "$archive" "$result_name"
(
  cd "$(dirname "$archive")"
  sha256sum "$(basename "$archive")" > "$(basename "$sha_file")"
)
readonly verify_dir="$(mktemp -d /tmp/depress-operator-result-verify.XXXXXX)"
tar -xzf "$archive" -C "$verify_dir"
[[ "$(find "$verify_dir" -mindepth 1 -maxdepth 1 -printf '%f\n')" == "$result_name" ]]
[[ "$(stat -c '%U:%G:%a' "$verify_dir/$result_name")" == root:root:700 ]]
rm -rf -- "$verify_dir"

printf 'operator-result=PASS archive=%s sha256=%s files=%s\n' \
  "$archive" "$(sha256sum "$archive" | awk '{ print $1 }')" "$copied"
