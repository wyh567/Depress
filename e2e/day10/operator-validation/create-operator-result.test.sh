#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "create-operator-result.test.sh must run as root" >&2
  exit 1
fi

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly creator="${script_dir}/create-operator-result.sh"
readonly sandbox="$(mktemp -d /tmp/depress-result-test.XXXXXX)"
readonly run_id=0123456789abcdef0123456789abcdef01234567
readonly evidence="${sandbox}/evidence"
readonly raw="${evidence}/root-only-${run_id}"
readonly archive="${sandbox}/operator-result-${run_id}.tar.gz"

cleanup() {
  [[ "$sandbox" == /tmp/depress-result-test.* ]] && rm -rf -- "$sandbox"
}
trap cleanup EXIT
install -d -o root -g root -m 0700 "$evidence" "$raw"
printf '%s\n' \
  'final_result=FAILURE' \
  'cleanup_status=cleanup_succeeded_owned_resources_removed' \
  > "$evidence/durable-evidence.txt"
printf '%s\n' 'diagnostic_capture_status=SUCCESS' \
  > "$raw/diagnostic-capture-status.txt"
printf '%s\n' 'ActiveState=failed' > "$raw/systemd-web-exec-status.txt"
printf '%s\n' 'classification=RELEASE_RUNTIME_READ_PERMISSION_DEFECT' \
  > "$raw/failure-classification.txt"
printf '%s\n' \
  'command_category=release-file-read target_identity=depress-web safe_cwd=/ command_exit_code=0 release_check_result=PASS diagnostic_capture_status=SUCCESS' \
  > "$raw/identity-check-summary.txt"
printf '%s\n' 'DATABASE_URL=must-never-enter-result' > "$raw/private.env"
chmod 0600 "$evidence/durable-evidence.txt" "$raw"/*

bash "$creator" "$run_id" "$evidence" "$raw" "$archive" >/dev/null
(cd "$sandbox" && sha256sum -c "$(basename "$archive").sha256") >/dev/null
readonly extract="${sandbox}/extract"
mkdir "$extract"
tar -xzf "$archive" -C "$extract"
[[ "$(stat -c '%U:%G:%a' "$extract/operator-result-${run_id}")" == root:root:700 ]]
[[ ! -e "$extract/operator-result-${run_id}/private.env" ]]
grep -Fxq \
  'command_category=release-file-read target_identity=depress-web safe_cwd=/ command_exit_code=0 release_check_result=PASS diagnostic_capture_status=SUCCESS' \
  "$extract/operator-result-${run_id}/identity-check-summary.txt"
! grep -RIFq 'must-never-enter-result' "$extract"
echo "PASS: result archive contains only the sanitized allowlist"

printf '%s\n' 'COOKIE=unredacted-secret' > "$raw/systemd-web-journal.log"
chmod 0600 "$raw/systemd-web-journal.log"
readonly rejected_archive="${sandbox}/rejected.tar.gz"
if bash "$creator" "$run_id" "$evidence" "$raw" "$rejected_archive" \
  >"${sandbox}/rejected.log" 2>&1; then
  echo "operator result test failed: sensitive journal was accepted" >&2
  exit 1
fi
[[ ! -e "$rejected_archive" ]]
echo "PASS: sensitive allowlisted evidence fails closed"

echo "operator-result-tests=PASS assertions=6"
