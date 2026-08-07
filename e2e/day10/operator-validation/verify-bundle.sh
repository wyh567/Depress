#!/usr/bin/env bash
set -euo pipefail

readonly bundle="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=e2e/day10/operator-validation/mode-manifest.sh
source "${bundle}/depress-mode-manifest.sh"
work="$(mktemp -d)"
cleanup() {
  rm -rf -- "$work"
}
trap cleanup EXIT

cd "$bundle"
[[ "$(sha256sum payload.sha256 | awk '{ print $1 }')" == \
  "$(tr -d '[:space:]' < bundle.sha256)" ]]
sha256sum --check --strict payload.sha256 >/dev/null
[[ "$(tr -d '[:space:]' < baseline.sha256)" =~ ^[0-9a-f]{40}$ ]]

mkdir "$work/source"
tar -xf baseline.tar -C "$work/source"
declare -A expected_modes=()
load_mode_manifest "$bundle/changed-files.mode" expected_modes
verify_mode_manifest_paths "$bundle/changed-files.mode" \
  "$bundle/changed-files.txt"
(
  cd "$work/source"
  git -c core.autocrlf=false -c core.eol=lf \
    apply --no-index --binary "$bundle/dirty-tree.patch"
  while IFS= read -r path; do
    [[ -n "$path" && "$path" != /* && "$path" != *".."* ]]
    mode="${expected_modes[$path]:-}"
    mode_manifest_mode_is_allowed "$mode"
    install -D -m "$mode" "$bundle/new-files/$path" "$work/source/$path"
  done < "$bundle/new-files.txt"
  while IFS= read -r path; do
    mode="${expected_modes[$path]:-}"
    restore_exact_mode "$mode" "$work/source/$path"
  done < "$bundle/changed-files.txt"
  sha256sum --check --strict "$bundle/changed-files.sha256" >/dev/null
  verify_mode_manifest_tree "$bundle/changed-files.mode" "$work/source"
)

if comm -3 \
  <(LC_ALL=C sort -u "$bundle/changed-files.txt") \
  <(
    awk '{ sub(/^[0-9a-f]{64}  /, ""); print }' \
      "$bundle/changed-files.sha256" |
      LC_ALL=C sort -u
  ) |
  grep -q .; then
  echo "bundle manifest and hash path sets differ" >&2
  exit 1
fi

if comm -3 \
  <(LC_ALL=C sort -u "$bundle/new-files.txt") \
  <(
    cd "$bundle/new-files"
    find . -type f -printf '%P\n' | LC_ALL=C sort
  ) |
  grep -q .; then
  echo "new-file manifest and payload path sets differ" >&2
  exit 1
fi

while IFS= read -r shell; do
  bash -n "$shell"
  if LC_ALL=C grep -q $'\r' "$shell"; then
    echo "shell file contains CR bytes: ${shell}" >&2
    exit 1
  fi
done < <(
  find "$bundle" "$work/source" -type f \
    \( -name '*.sh' -o -name '*.bash' \) -print
)

! LC_ALL=C grep -q $'\r' "$bundle/dirty-tree.patch"
if find "$bundle" -type f \
  \( -path '*/.claude/settings.local.json' -o -name '.env' \
  -o -name '*.pem' -o -name '*.key' -o -name '*.p12' \
  -o -name '*.pfx' -o -name 'id_rsa' -o -name 'id_ed25519' \) \
  -print -quit |
  grep -q .; then
  echo "bundle contains a forbidden secret or key path" >&2
  exit 1
fi
if grep -RIlE \
  'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|ssh-(rsa|ed25519) [A-Za-z0-9+/]{40,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}' \
  --exclude=baseline.tar --exclude=dirty-tree.patch "$bundle" |
  grep -q .; then
  echo "bundle contains private-key or credential material" >&2
  exit 1
fi

grep -Fxq 'readonly MIN_4G_CLASS_MEMTOTAL_KIB=3407872' \
  "$bundle/depress-resource-gates.sh"
grep -Fq 'initialize_evidence' "$bundle/depress-target-validate.sh"
grep -Fq 'cleanup_not_required_no_owned_resources_created' \
  "$bundle/depress-target-validate.sh"
grep -Fq 'validate_operator_marker' "$bundle/depress-target-cleanup.sh"
grep -Fq 'journalctl -u "$unit" --after-cursor="$journal_cursor"' \
  "$bundle/capture-service-evidence.sh"
grep -Fq 'operator-result-' "$bundle/create-operator-result.sh"
grep -Fq -- '--package-import-method=copy' "$bundle/depress-target-validate.sh"
grep -Fq 'DEPRESS_IDENTITY_CHECK_SUMMARY="$identity_check_summary"' \
  "$bundle/depress-target-validate.sh"
grep -Fq 'HARNESS_PRIVILEGE_DROP_CWD_DEFECT' \
  "$bundle/depress-target-validate.sh"
grep -Fq 'run_as_identity_from_safe_cwd' \
  "$work/source/deploy/run-as-identity.sh"

printf 'bundle-restore=PASS changed=%s new=%s mode=PASS shell-lf=PASS bash-n=PASS payload=PASS\n' \
  "$(wc -l < "$bundle/changed-files.txt")" \
  "$(wc -l < "$bundle/new-files.txt")"
