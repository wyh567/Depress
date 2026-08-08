#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
UNIT="${SCRIPT_DIR}/depress-web.service"
VERIFIER="${SCRIPT_DIR}/verify-depress-web-unit.sh"
API_UNIT="${SCRIPT_DIR}/depress-api.service"
OUTBOX_UNIT="${SCRIPT_DIR}/depress-outbox.service"
WORKER_UNIT="${SCRIPT_DIR}/depress-pointer-worker.service"

grep -Fxq 'User=depress-web' "${UNIT}"
grep -Fxq 'Group=depress-web' "${UNIT}"
grep -Fxq 'SupplementaryGroups=depress-release' "${UNIT}"
grep -Fxq 'EnvironmentFile=/etc/depress/web.env' "${UNIT}"
grep -Fxq 'ExecStart=/usr/bin/corepack pnpm --dir /opt/depress/current --filter @depress/web start --hostname 127.0.0.1 --port 3000' "${UNIT}"
grep -Fxq 'ReadOnlyPaths=/opt/depress' "${UNIT}"
grep -Fxq 'StateDirectory=depress-web' "${UNIT}"
grep -Fxq 'CacheDirectory=depress-web' "${UNIT}"
grep -Fxq 'StateDirectoryMode=0700' "${UNIT}"
grep -Fxq 'CacheDirectoryMode=0700' "${UNIT}"
grep -Fxq 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK' "${UNIT}"
! grep -Eq '^(SupplementaryGroups=.*docker|Environment=.*(DATABASE_URL|REDIS_URL|S3_|BETTER_AUTH_SECRET))' "${UNIT}"
grep -Fxq 'SupplementaryGroups=depress-release' "$API_UNIT"
grep -Fxq 'SupplementaryGroups=depress-release' "$OUTBOX_UNIT"
grep -Fxq 'SupplementaryGroups=docker depress-release' "$WORKER_UNIT"
! grep -Eq '^SupplementaryGroups=.*docker' "$API_UNIT" "$OUTBOX_UNIT" "$UNIT"

[[ -f "$VERIFIER" && ! -L "$VERIFIER" ]]

analyzer_request="${SYSTEMD_ANALYZE_BIN:-systemd-analyze}"
analyzer_ld_library_path="${SYSTEMD_ANALYZE_LD_LIBRARY_PATH:-}"
if [[ "$analyzer_request" == /* ]]; then
  analyzer=$analyzer_request
else
  analyzer="$(command -v -- "$analyzer_request")"
fi
analyzer_version="$({
  if [[ -n "$analyzer_ld_library_path" ]]; then
    LD_LIBRARY_PATH="$analyzer_ld_library_path" "$analyzer" --version
  else
    "$analyzer" --version
  fi
} | awk 'NR == 1 { print $2 }')"
[[ "$analyzer_version" =~ ^[0-9]+$ ]]

work="$(mktemp -d /root/depress-web-unit-test.XXXXXX)"
cleanup() {
  rm -rf -- "$work"
}
trap cleanup EXIT
chmod 0700 "$work"
runtime="$work/runtime"
mkdir -m 0700 "$runtime" "$runtime/current" "$runtime/bin"
printf 'NODE_ENV=test\n' > "$runtime/web.env"
chmod 0600 "$runtime/web.env"
printf '#!/usr/bin/env bash\nexit 0\n' > "$runtime/bin/corepack"
chmod 0755 "$runtime/bin/corepack"

valid_unit="$work/depress-web.service"
install -m 0644 "$UNIT" "$valid_unit"
sed -i \
  -e "s#^WorkingDirectory=.*#WorkingDirectory=${runtime}/current#" \
  -e "s#^EnvironmentFile=.*#EnvironmentFile=${runtime}/web.env#" \
  -e "s#^ExecStart=.*#ExecStart=${runtime}/bin/corepack pnpm --dir ${runtime}/current --filter @depress/web start#" \
  "$valid_unit"
valid_exec="ExecStart=${runtime}/bin/corepack pnpm --dir ${runtime}/current --filter @depress/web start"
valid_working="WorkingDirectory=${runtime}/current"
valid_environment="EnvironmentFile=${runtime}/web.env"

assertions=0
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

run_verify() {
  local candidate=$1
  local log=$2
  local expected_exec=${3:-$valid_exec}
  local expected_working=${4:-$valid_working}
  local expected_environment=${5:-$valid_environment}

  SYSTEMD_ANALYZE_BIN="$analyzer" \
  SYSTEMD_ANALYZE_LD_LIBRARY_PATH="$analyzer_ld_library_path" \
  SYSTEMD_VERIFY_TEST_MODE=true \
  SYSTEMD_VERIFY_EXPECTED_MAJOR="$analyzer_version" \
  SYSTEMD_VERIFY_EXPECTED_EXEC_START="$expected_exec" \
  SYSTEMD_VERIFY_EXPECTED_WORKING_DIRECTORY="$expected_working" \
  SYSTEMD_VERIFY_EXPECTED_ENVIRONMENT_FILE="$expected_environment" \
    bash "$VERIFIER" "$candidate" "$log"
}

# Demonstrate the old scope problem: a default dependency can pull an
# unrelated host unit into verify and produce a warning without a non-zero exit.
control_units="$work/control-units"
external_units="$work/external-units"
mkdir -m 0700 "$control_units" "$external_units"
install -m 0644 "$valid_unit" "$control_units/depress-web.service"
printf '%s\n' '[Unit]' 'Description=Network stub' 'DefaultDependencies=no' \
  > "$control_units/network-online.target"
printf '%s\n' '[Unit]' 'Description=External sysinit' 'DefaultDependencies=no' \
  'Wants=snapd.service' > "$external_units/sysinit.target"
printf '%s\n' '[Service]' 'Type=simple' "ExecStart=${runtime}/bin/corepack" \
  'DefinitelyUnknownExternalKey=yes' > "$external_units/snapd.service"
chmod 0644 "$control_units"/* "$external_units"/*
set +e
LD_LIBRARY_PATH="$analyzer_ld_library_path" \
SYSTEMD_UNIT_PATH="$control_units:$external_units" \
  "$analyzer" verify "$control_units/depress-web.service" \
  > "$work/unrelated-control.log" 2>&1
control_status=$?
set -e
[[ "$control_status" -eq 0 ]]
grep -Fq 'snapd.service' "$work/unrelated-control.log"
grep -Fq 'Unknown key name' "$work/unrelated-control.log"
assertions=$((assertions + 1))

expect_status 0 run_verify "$valid_unit" "$work/valid.log"
[[ ! -s "$work/valid.log" ]]
assertions=$((assertions + 1))

target_unknown="$work/target-unknown.service"
cp "$valid_unit" "$target_unknown"
sed -i '/^Type=simple$/a DefinitelyUnknownTargetKey=yes' "$target_unknown"
expect_status 1 run_verify "$target_unknown" "$work/target-unknown.log"
grep -Fq 'Unknown key name' "$work/target-unknown.log"
assertions=$((assertions + 1))

unsupported="$work/unsupported-249.service"
cp "$valid_unit" "$unsupported"
sed -i '/^Restart=on-failure$/a RestartMode=direct' "$unsupported"
if [[ "$analyzer_version" == 249 ]]; then
  expect_status 1 run_verify "$unsupported" "$work/unsupported-249.log"
  grep -Fq "Unknown key name 'RestartMode'" "$work/unsupported-249.log"
  assertions=$((assertions + 1))
else
  echo "SKIP: RestartMode rejection requires systemd 249; current analyzer is ${analyzer_version}"
fi

missing_exec="$work/missing-exec.service"
cp "$valid_unit" "$missing_exec"
missing_exec_line="ExecStart=${runtime}/bin/missing-corepack pnpm --dir ${runtime}/current --filter @depress/web start"
sed -i "s#^ExecStart=.*#${missing_exec_line}#" "$missing_exec"
expect_status 1 run_verify "$missing_exec" "$work/missing-exec.log" "$missing_exec_line"

missing_env="$work/missing-env.service"
cp "$valid_unit" "$missing_env"
missing_env_line="EnvironmentFile=${runtime}/missing.env"
sed -i "s#^EnvironmentFile=.*#${missing_env_line}#" "$missing_env"
expect_status 1 run_verify "$missing_env" "$work/missing-env.log" "$valid_exec" "$valid_working" "$missing_env_line"

missing_working="$work/missing-working.service"
cp "$valid_unit" "$missing_working"
missing_working_line="WorkingDirectory=${runtime}/missing-current"
sed -i "s#^WorkingDirectory=.*#${missing_working_line}#" "$missing_working"
expect_status 1 run_verify "$missing_working" "$work/missing-working.log" "$valid_exec" "$missing_working_line"

invalid_section="$work/invalid-section.service"
cp "$valid_unit" "$invalid_section"
printf '%s\n' '[DefinitelyInvalidSection]' 'Value=yes' >> "$invalid_section"
expect_status 1 run_verify "$invalid_section" "$work/invalid-section.log"

invalid_quoting="$work/invalid-quoting.service"
cp "$valid_unit" "$invalid_quoting"
sed -i '/^Environment=HOME=/a Environment="unterminated' "$invalid_quoting"
expect_status 1 run_verify "$invalid_quoting" "$work/invalid-quoting.log"

invalid_dependency="$work/invalid-dependency.service"
cp "$valid_unit" "$invalid_dependency"
sed -i '/^Wants=network-online.target$/a Requires=missing-required.service' "$invalid_dependency"
expect_status 1 run_verify "$invalid_dependency" "$work/invalid-dependency.log"

printf 'web-unit-tests=PASS assertions=%s systemd-major=%s\n' "$assertions" "$analyzer_version"
