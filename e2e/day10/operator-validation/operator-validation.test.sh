#!/usr/bin/env bash
set -euo pipefail

[[ "$EUID" -eq 0 ]] || {
  echo "operator-validation tests require a disposable root test namespace" >&2
  exit 1
}

readonly test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d /root/depress-operator-validation-test.XXXXXX)"
cleanup() {
  rm -rf -- "$work"
}
trap cleanup EXIT

assertions=0
assert_file_line() {
  local file=$1
  local line=$2
  grep -Fxq "$line" "$file" || {
    echo "missing expected line '${line}' in ${file}" >&2
    exit 1
  }
  assertions=$((assertions + 1))
}
expect_status() {
  local expected=$1
  shift
  local status=0
  "$@" || status=$?
  [[ "$status" -eq "$expected" ]] || {
    echo "expected exit ${expected}, got ${status}: $*" >&2
    exit 1
  }
  assertions=$((assertions + 1))
}

make_fixture() {
  local destination=$1
  mkdir -m 0700 "$destination"
  cp "$test_dir/depress-target-validate.sh" "$destination/"
  cp "$test_dir/depress-target-cleanup.sh" "$destination/"
  cp "$test_dir/create-operator-result.sh" "$destination/"
  cp "$test_dir/mode-manifest.sh" "$destination/depress-mode-manifest.sh"
  cp "$test_dir/../../../deploy/resource-gates.sh" \
    "$destination/depress-resource-gates.sh"
  printf '%064d\n' 0 > "$destination/bundle.sha256"
  chmod 0755 "$destination"/*.sh
}

fixture="${work}/early-failure"
make_fixture "$fixture"
set +e
DATABASE_URL='postgresql://must-not-appear' \
REDIS_SECRET='must-not-appear-redis' \
AUTH_SECRET='must-not-appear-auth' \
bash -c '
  set -Eeuo pipefail
  source "$1/depress-target-validate.sh"
  verify_bundle() { :; }
  record_preflight() {
    phase target-preflight
    target_memtotal_kib=3407871
    target_memtotal_bytes=$((target_memtotal_kib * 1024))
    target_memavailable_bytes=3006976000
    target_cpu_count=2
    target_swap_total_bytes=2147479552
    target_swap_used_bytes=0
    target_disk_available_bytes=21474836480
    write_durable_evidence IN_PROGRESS ""
    ram_class_gate_passes "$target_memtotal_kib" ||
      fail "target RAM boundary test failure"
  }
  main
' _ "$fixture" > "${fixture}/run.log" 2>&1
early_status=$?
set -e
[[ "$early_status" -ne 0 ]]
assertions=$((assertions + 1))
evidence="${fixture}/evidence/durable-evidence.txt"
if [[ ! -f "$evidence" ]]; then
  cat "${fixture}/run.log" >&2
  echo "early failure did not create durable evidence" >&2
  exit 1
fi
assert_file_line "$evidence" "stage=target-preflight"
assert_file_line "$evidence" "final_result=FAILURE"
assert_file_line "$evidence" "target_memtotal_kib=3407871"
assert_file_line "$evidence" "owned_resources_created=false"
assert_file_line "$evidence" \
  "cleanup_status=cleanup_not_required_no_owned_resources_created"
[[ "$(stat -c '%U:%G:%a' "${fixture}/evidence")" == root:root:700 ]]
[[ "$(stat -c '%U:%G:%a' "$evidence")" == root:root:600 ]]
assertions=$((assertions + 2))
! grep -Fq 'must-not-appear' "$evidence"
assertions=$((assertions + 1))

symlink_fixture="${work}/symlink-evidence"
make_fixture "$symlink_fixture"
mkdir "${work}/untrusted-evidence-target"
ln -s "${work}/untrusted-evidence-target" "${symlink_fixture}/evidence"
expect_status 1 bash -c '
  source "$1/depress-target-validate.sh"
  initialize_evidence
' _ "$symlink_fixture"

mode_fixture="${work}/wrong-mode-evidence"
make_fixture "$mode_fixture"
mkdir -m 0755 "${mode_fixture}/evidence"
expect_status 1 bash -c '
  source "$1/depress-target-validate.sh"
  initialize_evidence
' _ "$mode_fixture"

chmod 0644 "$evidence"
expect_status 1 bash -c '
  source "$1/depress-target-validate.sh"
  assert_evidence_security
' _ "$fixture"
chmod 0600 "$evidence"

marker_fixture="${work}/marker"
make_fixture "$marker_fixture"
correct_marker="${marker_fixture}/correct.marker"
bash -c '
  source "$1/depress-target-cleanup.sh"
  print_expected_marker
' _ "$marker_fixture" > "$correct_marker"
chmod 0600 "$correct_marker"
expect_status 0 bash -c '
  source "$1/depress-target-cleanup.sh"
  validate_operator_marker "$2"
' _ "$marker_fixture" "$correct_marker"

missing_marker="${marker_fixture}/missing.marker"
sentinel="${marker_fixture}/must-remain"
touch "$sentinel"
expect_status 70 bash -c '
  source "$1/depress-target-cleanup.sh"
  validate_operator_marker "$2"
' _ "$marker_fixture" "$missing_marker"
[[ -f "$sentinel" ]]
assertions=$((assertions + 1))

invalid_marker="${marker_fixture}/invalid.marker"
cp "$correct_marker" "$invalid_marker"
printf 'unexpected=true\n' >> "$invalid_marker"
chmod 0600 "$invalid_marker"
expect_status 70 bash -c '
  source "$1/depress-target-cleanup.sh"
  validate_operator_marker "$2"
' _ "$marker_fixture" "$invalid_marker"
[[ -f "$sentinel" ]]
assertions=$((assertions + 1))

symlink_marker="${marker_fixture}/symlink.marker"
ln -s "$correct_marker" "$symlink_marker"
expect_status 70 bash -c '
  source "$1/depress-target-cleanup.sh"
  validate_operator_marker "$2"
' _ "$marker_fixture" "$symlink_marker"
[[ -f "$sentinel" ]]
assertions=$((assertions + 1))

bash -c '
  source "$1/depress-target-validate.sh"
  print_expected_marker
' _ "$marker_fixture" > "${marker_fixture}/validate-expected"
cmp -s "$correct_marker" "${marker_fixture}/validate-expected"
assertions=$((assertions + 1))

lifecycle_fixture="${work}/owned-lifecycle"
make_fixture "$lifecycle_fixture"
set +e
bash -c '
  set -Eeuo pipefail
  source "$1/depress-target-validate.sh"
  verify_bundle() { :; }
  record_preflight() { phase target-preflight; }
  verify_systemd_runtime() { phase systemd-runtime; }
  create_owned_resources_and_marker() {
    phase ownership-marker
    mkdir "$script_dir/owned-test-resource"
    print_expected_marker > "$script_dir/test.marker"
    chmod 0600 "$script_dir/test.marker"
    owned_resources_created=true
    write_durable_evidence IN_PROGRESS ""
  }
  run_cleanup() {
    bash -c '"'"'
      source "$1/depress-target-cleanup.sh"
      validate_operator_marker "$2"
    '"'"' _ "$script_dir" "$script_dir/test.marker" || return
    rm -rf -- "$script_dir/owned-test-resource"
    rm -- "$script_dir/test.marker"
  }
  install_official_dependencies() {
    phase install-official-dependencies
    fail "simulated post-marker failure"
  }
  main
' _ "$lifecycle_fixture" >/dev/null 2>&1
lifecycle_status=$?
set -e
[[ "$lifecycle_status" -ne 0 ]]
[[ ! -e "${lifecycle_fixture}/owned-test-resource" ]]
assertions=$((assertions + 2))
lifecycle_evidence="${lifecycle_fixture}/evidence/durable-evidence.txt"
assert_file_line "$lifecycle_evidence" "owned_resources_created=true"
assert_file_line "$lifecycle_evidence" \
  "cleanup_status=cleanup_succeeded_owned_resources_removed"
assert_file_line "$lifecycle_evidence" "final_result=FAILURE"

capture_script_fixture="${work}/release-permission-script"
make_fixture "$capture_script_fixture"
capture_fixture="${work}/release-permission-capture"
mkdir -m 0700 "$capture_fixture"
expect_status 0 bash -c '
  source "$1/depress-target-validate.sh"
  initialize_release_permission_capture_files "$2" "$3" "$4"
' _ "$capture_script_fixture" \
  "${capture_fixture}/release-permission-matrix.txt" \
  "${capture_fixture}/release-permission-stderr.txt" \
  "${capture_fixture}/identity-check-summary.txt"
for capture_file in \
  "${capture_fixture}/release-permission-matrix.txt" \
  "${capture_fixture}/release-permission-stderr.txt" \
  "${capture_fixture}/identity-check-summary.txt"; do
  [[ -f "$capture_file" && ! -d "$capture_file" ]]
  [[ "$(stat -c '%U:%G:%a' "$capture_file")" == root:root:600 ]]
  assertions=$((assertions + 2))
done

mode_fixture="${work}/mode-manifest"
mkdir -m 0700 "$mode_fixture"
printf 'payload\n' > "${mode_fixture}/file.txt"
chmod 0644 "${mode_fixture}/file.txt"
printf '0644  file.txt\n' > "${mode_fixture}/valid.mode"
expect_status 0 bash -c '
  source "$1/mode-manifest.sh"
  declare -A modes=()
  load_mode_manifest "$2" modes
  verify_mode_manifest_tree "$2" "$3"
' _ "$test_dir" "${mode_fixture}/valid.mode" "$mode_fixture"
chmod 0755 "${mode_fixture}/file.txt"
expect_status 1 bash -c '
  source "$1/mode-manifest.sh"
  verify_mode_manifest_tree "$2" "$3"
' _ "$test_dir" "${mode_fixture}/valid.mode" "$mode_fixture"
printf '0777  file.txt\n' > "${mode_fixture}/invalid.mode"
expect_status 1 bash -c '
  source "$1/mode-manifest.sh"
  declare -A modes=()
  load_mode_manifest "$2" modes
' _ "$test_dir" "${mode_fixture}/invalid.mode"

target_validator="${test_dir}/depress-target-validate.sh"
for required_text in \
  'verify-depress-web-unit.sh' \
  'DEPRESS_IDENTITY_CHECK_SUMMARY="$identity_check_summary"' \
  'HARNESS_PRIVILEGE_DROP_CWD_DEFECT' \
  'RELEASE_RUNTIME_READ_PERMISSION_DEFECT' \
  'identity-check-summary.txt' \
  '--package-import-method=copy' \
  'systemctl start depress-web.service' \
  'record_journal_cursor' \
  'capture-service-evidence.sh' \
  'operator-result-' \
  'seq 1 60'; do
  grep -Fq -- "$required_text" "$target_validator"
  assertions=$((assertions + 1))
done
grep -Fq 'ExecMainStatus' "$test_dir/capture-service-evidence.sh"
assertions=$((assertions + 1))
! grep -Fq 'cat /etc/depress/web.env' "$target_validator"
assertions=$((assertions + 1))
! grep -Fq 'journalctl -u depress-web.service --since' "$target_validator"
assertions=$((assertions + 1))

printf 'operator-validation-tests=PASS assertions=%s\n' "$assertions"
