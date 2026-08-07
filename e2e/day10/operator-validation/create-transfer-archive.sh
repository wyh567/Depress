#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ $# -eq 2 && "$1" == /* && "$2" == /* ]] || {
  echo "usage: $0 ABSOLUTE_BUNDLE_DIRECTORY ABSOLUTE_NEW_ARCHIVE.tar.gz" >&2
  exit 64
}

readonly bundle_dir=$1
readonly archive=$2
readonly sha_file="${archive}.sha256"
readonly bundle_name="$(basename "$bundle_dir")"
readonly stage="$(mktemp -d)"
readonly verify_root="$(mktemp -d)"

cleanup() {
  rm -rf -- "$stage" "$verify_root"
}
trap cleanup EXIT

[[ -d "$bundle_dir" && ! -L "$bundle_dir" ]]
[[ ! -e "$archive" && ! -L "$archive" ]]
[[ ! -e "$sha_file" && ! -L "$sha_file" ]]
bash "$bundle_dir/verify-bundle.sh"

install -d -m 0700 "${stage}/${bundle_name}"
cp -a "$bundle_dir/." "${stage}/${bundle_name}/"
find "${stage}/${bundle_name}" -type d -exec chmod 0700 {} +
find "${stage}/${bundle_name}" -type f -exec chmod 0600 {} +
chmod 0700 \
  "${stage}/${bundle_name}/depress-target-validate.sh" \
  "${stage}/${bundle_name}/depress-target-cleanup.sh" \
  "${stage}/${bundle_name}/depress-resource-gates.sh" \
  "${stage}/${bundle_name}/depress-mode-manifest.sh" \
  "${stage}/${bundle_name}/capture-service-evidence.sh" \
  "${stage}/${bundle_name}/create-operator-result.sh" \
  "${stage}/${bundle_name}/verify-bundle.sh"

# Preserve each restored new file's audited repository mode inside the bundle.
# shellcheck source=e2e/day10/operator-validation/mode-manifest.sh
source "${stage}/${bundle_name}/depress-mode-manifest.sh"
declare -A expected_modes=()
load_mode_manifest \
  "${stage}/${bundle_name}/changed-files.mode" expected_modes
while IFS= read -r path; do
  mode="${expected_modes[$path]:-}"
  restore_exact_mode "$mode" "${stage}/${bundle_name}/new-files/${path}"
done < "${stage}/${bundle_name}/new-files.txt"

tar --numeric-owner --owner=0 --group=0 \
  -C "$stage" -czf "$archive" "$bundle_name"
(
  cd "$(dirname "$archive")"
  sha256sum "$(basename "$archive")" > "$(basename "$sha_file")"
)

tar -xzf "$archive" -C "$verify_root"
[[ "$(stat -c '%U:%G:%a' "${verify_root}/${bundle_name}")" == root:root:700 ]]
if find "${verify_root}/${bundle_name}" -type d -perm /022 -print -quit |
  grep -q .; then
  echo "archive contains a group/other-writable directory" >&2
  exit 1
fi
bash "${verify_root}/${bundle_name}/verify-bundle.sh"

printf 'transfer-archive=PASS path=%s sha256=%s top-mode=root:root:700\n' \
  "$archive" "$(sha256sum "$archive" | awk '{ print $1 }')"
