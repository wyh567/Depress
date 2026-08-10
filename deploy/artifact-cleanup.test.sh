#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly service="${script_dir}/systemd/depress-artifact-cleanup.service"
readonly timer="${script_dir}/systemd/depress-artifact-cleanup.timer"
readonly env_example="${script_dir}/env.production.example"
readonly grants="${script_dir}/postgres/artifact-cleanup-grants.sql"
readonly release_permissions="${script_dir}/release-permissions.sh"
readonly release_permissions_test="${script_dir}/release-permissions.test.sh"
readonly release_security_test="${script_dir}/release-security.test.sh"
readonly rollback_security_test="${script_dir}/rollback-security.test.sh"
readonly env_permissions="${script_dir}/verify-env-permissions.sh"
readonly env_permissions_test="${script_dir}/verify-env-permissions.test.sh"
readonly readme="${script_dir}/README.md"
readonly package_json="${script_dir}/../apps/api/package.json"

for file in "$service" "$timer" "$env_example" "$grants" \
  "$release_permissions" "$release_permissions_test" \
  "$release_security_test" "$rollback_security_test" \
  "$env_permissions" "$env_permissions_test" "$readme" "$package_json"; do
  [[ -f "$file" && ! -L "$file" ]]
done

grep -Fxq 'Type=oneshot' "$service"
grep -Fxq 'User=depress-cleanup' "$service"
grep -Fxq 'Group=depress-cleanup' "$service"
grep -Fxq 'SupplementaryGroups=depress-release' "$service"
grep -Fxq 'WorkingDirectory=/opt/depress/current' "$service"
grep -Fxq 'EnvironmentFile=/etc/depress/artifact-cleanup.env' "$service"
grep -Fxq 'ExecStart=/usr/bin/corepack pnpm --dir /opt/depress/current --filter @depress/api artifacts:cleanup' "$service"
grep -Eq '^TimeoutStartSec=[1-9][0-9]*(s|min)$' "$service"
grep -Fxq 'NoNewPrivileges=true' "$service"
grep -Fxq 'PrivateTmp=true' "$service"
grep -Fxq 'PrivateDevices=true' "$service"
grep -Fxq 'ProtectSystem=strict' "$service"
grep -Fxq 'ProtectHome=true' "$service"
grep -Fxq 'ProtectKernelTunables=true' "$service"
grep -Fxq 'ProtectKernelModules=true' "$service"
grep -Fxq 'ProtectControlGroups=true' "$service"
grep -Fxq 'RestrictSUIDSGID=true' "$service"
grep -Fxq 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' "$service"
grep -Fxq 'ReadOnlyPaths=/opt/depress' "$service"
! grep -Eq '^(User|Group)=root$|^Restart=|start:api|start:pointer-worker|setInterval' "$service"

grep -Fxq 'OnCalendar=hourly' "$timer"
grep -Fxq 'Persistent=true' "$timer"
grep -Fxq 'Unit=depress-artifact-cleanup.service' "$timer"
grep -Fxq 'WantedBy=timers.target' "$timer"

cleanup_env="$({
  awk '
    /^# \/etc\/depress\/artifact-cleanup\.env / { capture=1; next }
    capture && /^# \/etc\/depress\// { exit }
    capture && /^[A-Z0-9_]+=/ { print }
  ' "$env_example"
})"
for name in DATABASE_URL S3_ENDPOINT S3_REGION S3_BUCKET \
  S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  grep -Eq "^${name}=.+" <<<"$cleanup_env"
done
! grep -Eq 'AUTH|BETTER_AUTH|REDIS|API_|PORT=|POINTER|TYPST' <<<"$cleanup_env"

grep -Fq 'cleanup_user=${DEPRESS_CLEANUP_USER:-depress-cleanup}' "$release_permissions"
grep -Fq 'cleanup_group=${DEPRESS_CLEANUP_GROUP:-depress-cleanup}' "$release_permissions"
for test_file in "$release_permissions_test" "$release_security_test" \
  "$rollback_security_test"; do
  grep -Fq 'DEPRESS_CLEANUP_USER=' "$test_file"
  grep -Fq 'DEPRESS_CLEANUP_GROUP=' "$test_file"
done
grep -Fq 'CLEANUP_ENV_FILE=${DEPRESS_CLEANUP_ENV_FILE:-${ENV_DIR}/artifact-cleanup.env}' "$env_permissions"
grep -Fq 'DEPRESS_CLEANUP_USER=' "$env_permissions_test"
grep -Fq 'DEPRESS_CLEANUP_GROUP=' "$env_permissions_test"
grep -Fq 'artifact-cleanup.env' "$env_permissions_test"

grep -Eq '^GRANT USAGE ON SCHEMA public TO depress_cleanup;$' "$grants"
grep -Eq '^GRANT SELECT \(' "$grants"
grep -Eq '^GRANT UPDATE \(' "$grants"
grep -Fq 'artifact_cleanup_token' "$grants"
grep -Fq 'artifact_cleanup_started_at' "$grants"
grep -Fq 'artifact_deleted_at' "$grants"
! grep -Eq '^GRANT (ALL|CREATE|DELETE|INSERT|TRUNCATE)' "$grants"
! grep -Eq 'compile_outbox|"user"|projects|documents' "$grants"

grep -Fq '"artifacts:cleanup": "tsx src/artifact-cleanup-main.ts"' "$package_json"
grep -Fq 'DeleteObject' "$readme"
grep -Fq 'artifacts/*' "$readme"
grep -Fq '14 days' "$readme"
grep -Fq 'noncurrent object versions' "$readme"
grep -Fq 'delete markers' "$readme"
grep -Fq '/etc/depress/artifact-cleanup.env' "$readme"

echo 'artifact-cleanup-deployment-tests=PASS'
