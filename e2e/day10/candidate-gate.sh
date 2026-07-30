#!/usr/bin/env bash

candidate_gate_fail() {
  echo "candidate changed-files manifest rejected: $1" >&2
  return 1
}

validate_candidate_relative_path() {
  local path=$1

  [[ -n "$path" ]] || {
    candidate_gate_fail "empty paths are not allowed"
    return 1
  }
  [[ "$path" != /* && ! "$path" =~ ^[A-Za-z]: ]] || {
    candidate_gate_fail "absolute paths are not allowed"
    return 1
  }
  [[ "$path" != *\\* ]] || {
    candidate_gate_fail "backslash paths are not allowed"
    return 1
  }
  [[ "$path" != "." && "$path" != "./"* && "$path" != *"//"* ]] || {
    candidate_gate_fail "paths must use canonical repository-relative form"
    return 1
  }
  [[ "$path" != ".." && "$path" != "../"* &&
    "$path" != *"/../"* && "$path" != *"/.." ]] || {
    candidate_gate_fail "parent traversal is not allowed"
    return 1
  }
}

candidate_path_is_sensitive() {
  local path=$1
  local basename=${path##*/}
  local lower_path=${path,,}
  local lower_basename=${basename,,}

  case "$lower_path" in
    .env.example|*/.env.example|deploy/env.production.example)
      return 1
      ;;
  esac
  case "$lower_basename" in
    .env|.env.*|*.pem|*.key|credentials*|secrets*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

validate_manifest_text_file() {
  local manifest=$1
  local last_byte

  [[ -f "$manifest" && ! -L "$manifest" && -s "$manifest" ]] || {
    candidate_gate_fail "manifest must be a non-empty regular file"
    return 1
  }
  iconv -f UTF-8 -t UTF-8 "$manifest" >/dev/null 2>&1 || {
    candidate_gate_fail "manifest must be valid UTF-8"
    return 1
  }
  if LC_ALL=C grep -qP '[\x00-\x09\x0B-\x1F\x7F]' "$manifest"; then
    candidate_gate_fail "manifest contains control characters"
    return 1
  fi
  last_byte="$(tail -c 1 "$manifest" | od -An -tu1 | tr -d ' ')"
  [[ "$last_byte" == "10" ]] || {
    candidate_gate_fail "manifest must end with a single LF-delimited path"
    return 1
  }
}

validate_changed_files_manifest() {
  local approved_manifest=$1
  local actual_manifest=$2
  local path approved_count actual_count manifest_sha

  validate_manifest_text_file "$approved_manifest" || return 1
  validate_manifest_text_file "$actual_manifest" || return 1
  LC_ALL=C sort -c -u "$approved_manifest" >/dev/null 2>&1 || {
    candidate_gate_fail "approved manifest must be sorted and unique"
    return 1
  }
  LC_ALL=C sort -c -u "$actual_manifest" >/dev/null 2>&1 || {
    candidate_gate_fail "actual changed paths must be sorted and unique"
    return 1
  }

  while IFS= read -r path; do
    validate_candidate_relative_path "$path" || return 1
  done < "$approved_manifest"

  while IFS= read -r path; do
    validate_candidate_relative_path "$path" || return 1
    if candidate_path_is_sensitive "$path"; then
      candidate_gate_fail "candidate changes a forbidden secret-like filename"
      return 1
    fi
  done < "$actual_manifest"

  cmp -s "$approved_manifest" "$actual_manifest" || {
    candidate_gate_fail "approved manifest does not exactly match the candidate diff"
    return 1
  }

  approved_count="$(awk 'END { print NR + 0 }' "$approved_manifest")"
  actual_count="$(awk 'END { print NR + 0 }' "$actual_manifest")"
  [[ "$approved_count" -gt 0 && "$approved_count" == "$actual_count" ]] || {
    candidate_gate_fail "candidate diff must be non-empty"
    return 1
  }
  manifest_sha="$(sha256sum "$approved_manifest" | awk '{ print $1 }')"
  printf 'changed-files-manifest=pass count=%s sha256=%s\n' \
    "$actual_count" "$manifest_sha"
}
