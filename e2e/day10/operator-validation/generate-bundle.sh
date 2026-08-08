#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repo_root="$(cd "${script_dir}/../../.." && pwd)"

worktree_git() {
  git -c core.autocrlf=true -c core.eol=lf "$@"
}

usage() {
  echo "usage: $0 ABSOLUTE_NEW_BUNDLE_DIRECTORY" >&2
  exit 64
}

[[ $# -eq 1 && "$1" == /* ]] || usage
readonly output_dir=$1
readonly output_parent="$(dirname "$output_dir")"
readonly output_name="$(basename "$output_dir")"

expected_mode_for_path() {
  local path=$1
  local index_mode

  index_mode="$(worktree_git ls-files --stage -- "$path" | awk 'NR == 1 { print $1 }')"
  case "$index_mode" in
    100755) printf '0755\n' ;;
    100644|"") printf '0644\n' ;;
    *)
      echo "unsupported Git mode ${index_mode} for ${path}" >&2
      return 1
      ;;
  esac
}

cd "$repo_root"
[[ -d .git ]]
[[ ! -e "$output_dir" && ! -L "$output_dir" ]] || {
  echo "refusing to overwrite bundle path: ${output_dir}" >&2
  exit 1
}
mkdir -p "$output_parent"
readonly repo_real="$(realpath "$repo_root")"
readonly output_parent_real="$(realpath "$output_parent")"
case "${output_parent_real}/${output_name}" in
  "${repo_real}"|"${repo_real}"/*)
    echo "bundle output must be outside the repository" >&2
    exit 1
    ;;
esac

[[ -z "$(worktree_git diff --cached --name-only)" ]] || {
  echo "refusing bundle generation with staged changes" >&2
  exit 1
}
worktree_git diff --check

readonly baseline_sha="$(worktree_git rev-parse HEAD)"
[[ "$baseline_sha" =~ ^[0-9a-f]{40}$ ]]
mapfile -t modified_files < <(
  worktree_git diff --name-only HEAD -- | LC_ALL=C sort -u
)
mapfile -t new_files < <(
  worktree_git ls-files --others --exclude-standard -- \
    . ':(exclude).claude/settings.local.json' |
    LC_ALL=C sort -u
)
mapfile -t changed_files < <(
  printf '%s\n' "${modified_files[@]}" "${new_files[@]}" |
    sed '/^$/d' |
    LC_ALL=C sort -u
)
(( ${#modified_files[@]} > 0 ))
(( ${#changed_files[@]} == ${#modified_files[@]} + ${#new_files[@]} ))

for path in "${changed_files[@]}"; do
  [[ "$path" != /* && "$path" != *".."* && -f "$path" && ! -L "$path" ]] ||
    {
      echo "unsafe changed-file path: ${path}" >&2
      exit 1
    }
  case "$path" in
    .claude/settings.local.json|.env|*/.env|*.pem|*.key|*.p12|*.pfx|*/id_rsa|*/id_ed25519)
      echo "forbidden sensitive path: ${path}" >&2
      exit 1
      ;;
  esac
done

mkdir "$output_dir"
mkdir "$output_dir/new-files"
printf '%s\n' "$baseline_sha" > "$output_dir/baseline.sha256"
printf '%s\n' "${modified_files[@]}" > "$output_dir/modified-files.txt"
printf '%s\n' "${new_files[@]}" > "$output_dir/new-files.txt"
printf '%s\n' "${changed_files[@]}" > "$output_dir/changed-files.txt"
git -c core.autocrlf=false -c core.eol=lf \
  -c tar.umask=0022 archive --format=tar "$baseline_sha" \
  > "$output_dir/baseline.tar"
worktree_git diff --binary --full-index --no-ext-diff HEAD -- \
  > "$output_dir/dirty-tree.patch"

declare -A changed_modes=()
for path in "${changed_files[@]}"; do
  changed_modes["$path"]="$(expected_mode_for_path "$path")"
  printf '%s  %s\n' "${changed_modes[$path]}" "$path"
done > "$output_dir/changed-files.mode"

for path in "${new_files[@]}"; do
  install -D -m "${changed_modes[$path]}" "$path" \
    "$output_dir/new-files/$path"
done
(
  for path in "${changed_files[@]}"; do
    sha256sum "$path"
  done
) > "$output_dir/changed-files.sha256"

sed "s/@@BASELINE_SHA@@/${baseline_sha}/g" \
  "$script_dir/depress-target-validate.sh" \
  > "$output_dir/depress-target-validate.sh"
sed "s/@@BASELINE_SHA@@/${baseline_sha}/g" \
  "$script_dir/depress-target-cleanup.sh" \
  > "$output_dir/depress-target-cleanup.sh"
sed "s/@@BASELINE_SHA@@/${baseline_sha}/g" \
  "$script_dir/README.md.template" \
  > "$output_dir/README.md"
cp "$script_dir/verify-bundle.sh" "$output_dir/verify-bundle.sh"
cp "$script_dir/mode-manifest.sh" "$output_dir/depress-mode-manifest.sh"
cp "$script_dir/capture-service-evidence.sh" \
  "$output_dir/capture-service-evidence.sh"
cp "$script_dir/create-operator-result.sh" \
  "$output_dir/create-operator-result.sh"
cp "$repo_root/deploy/resource-gates.sh" \
  "$output_dir/depress-resource-gates.sh"
chmod 0755 \
  "$output_dir/depress-target-validate.sh" \
  "$output_dir/depress-target-cleanup.sh" \
  "$output_dir/depress-mode-manifest.sh" \
  "$output_dir/depress-resource-gates.sh" \
  "$output_dir/capture-service-evidence.sh" \
  "$output_dir/create-operator-result.sh" \
  "$output_dir/verify-bundle.sh"
printf '%s\n' \
  "validation_type=NON_CANDIDATE_DIRTY_TREE_VALIDATION" \
  "baseline_sha=${baseline_sha}" \
  "generated_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$output_dir/bundle-metadata.txt"

(
  cd "$output_dir"
  find . -type f \
    ! -name payload.sha256 \
    ! -name bundle.sha256 \
    -printf '%P\n' |
    LC_ALL=C sort |
    while IFS= read -r path; do
      sha256sum "$path"
    done > payload.sha256
  sha256sum payload.sha256 | awk '{ print $1 }' > bundle.sha256
)

bash "$output_dir/verify-bundle.sh"
printf 'bundle-generated path=%s baseline=%s changed=%s new=%s sha256=%s\n' \
  "$output_dir" "$baseline_sha" "${#changed_files[@]}" "${#new_files[@]}" \
  "$(tr -d '[:space:]' < "$output_dir/bundle.sha256")"
