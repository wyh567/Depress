#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly validation_type="NON_CANDIDATE_DIRTY_TREE_VALIDATION"
readonly baseline_sha="@@BASELINE_SHA@@"
readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly bundle_sha256="$(tr -d '[:space:]' < "${script_dir}/bundle.sha256")"
readonly validation_id="${bundle_sha256:0:40}"
readonly operator_root="/var/lib/depress-target-validation"
readonly operator_marker="${operator_root}/${validation_id}.marker"
readonly staging_root="/var/tmp/depress-day10-validation"
readonly source_dir="${staging_root}/source-${validation_id}"
readonly source_archive="/var/tmp/depress-validation-source-${validation_id}.tar"

print_expected_marker() {
  printf '%s\n' \
    "validation_type=${validation_type}" \
    "validation_id=${validation_id}" \
    "bundle_sha256=${bundle_sha256}" \
    "baseline_sha=${baseline_sha}" \
    "identity_names=depress-day10-web,depress-day10-api,depress-day10-outbox,depress-day10-worker,depress-day10-migration,depress-day10-release,depress-web,depress-api,depress-outbox,depress-worker,depress-migration,depress-release,depress-redis,depress-s3,depress-runtime" \
    "config_paths=/etc/depress,/etc/depress-day10" \
    "staging_path=${staging_root}" \
    "source_path=${source_dir}" \
    "source_archive=${source_archive}" \
    "release_paths=/opt/depress,/opt/depress-day10-failure-bin" \
    "runtime_paths=/var/lib/depress-day10,/var/log/depress-day10,/var/tmp/depress-day10-runs,/run/depress-day10,/run/depress-day10-web,/run/depress-day10-worker,/var/lib/depress-web,/var/cache/depress-web" \
    "unit_paths=/etc/systemd/system/depress-nginx-day10.service,/etc/systemd/system/depress-web.service,/etc/systemd/system/depress-web-day10.service,/etc/systemd/system/depress-pointer-worker.service,/etc/systemd/system/depress-pointer-worker.service.d,/etc/systemd/system/depress-outbox.service,/etc/systemd/system/depress-api.service,/etc/systemd/system/depress-minio-day10.service,/etc/systemd/system/depress-redis-day10.service" \
    "docker_label=com.depress.managed=true"
}

validate_operator_marker() {
  local marker_path=${1:-$operator_marker}

  [[ -f "$marker_path" && ! -L "$marker_path" &&
    "$(stat -c '%U:%G:%a' "$marker_path")" == root:root:600 ]] || {
    echo "refusing cleanup without the exact root-owned operator marker" >&2
    return 70
  }
  cmp -s "$marker_path" <(print_expected_marker) || {
    echo "refusing cleanup after operator marker changed" >&2
    return 70
  }
}

remove_exact_tree() {
  local path=$1
  shift
  local allowed
  local matched=false

  for allowed in "$@"; do
    if [[ "$path" == "$allowed" ]]; then
      matched=true
      break
    fi
  done
  [[ "$matched" == true ]] || {
    echo "refusing unexpected cleanup path" >&2
    return 70
  }
  if [[ -e "$path" || -L "$path" ]]; then
    rm -rf -- "$path"
  fi
}

cleanup_main() {
  local unit user expected_group home_path gecos port path
  local -a exact_paths=(
    /etc/depress
    /etc/depress-day10
    /opt/depress
    /opt/depress-day10-failure-bin
    /var/lib/depress-day10
    /var/log/depress-day10
    /var/tmp/depress-day10-runs
    /run/depress-day10
    /run/depress-day10-web
    /run/depress-day10-worker
    /var/lib/depress-web
    /var/cache/depress-web
    "${staging_root}/acceptance-results.json"
    "$source_dir"
  )
  local -a units=(
    depress-nginx-day10.service
    depress-web.service
    depress-web-day10.service
    depress-pointer-worker.service
    depress-outbox.service
    depress-api.service
    depress-minio-day10.service
    depress-redis-day10.service
  )

  [[ "$EUID" -eq 0 ]] || {
    echo "cleanup must run as root" >&2
    return 1
  }
  validate_operator_marker "$operator_marker"

  for unit in "${units[@]}"; do
    systemctl stop "$unit" 2>/dev/null || true
    rm -f -- "/etc/systemd/system/${unit}"
  done
  rm -rf -- /etc/systemd/system/depress-pointer-worker.service.d
  systemctl daemon-reload

  if command -v docker >/dev/null 2>&1; then
    docker ps -aq --filter "label=com.depress.managed=true" |
      xargs -r docker rm -f
    docker volume ls -q --filter "label=com.depress.managed=true" |
      xargs -r docker volume rm
    docker network ls -q --filter "label=com.depress.managed=true" |
      xargs -r docker network rm
  fi

  for user in \
    depress-day10-web depress-day10-api depress-day10-outbox \
    depress-day10-worker depress-day10-migration \
    depress-web depress-api depress-outbox depress-worker depress-migration; do
    if id "$user" >/dev/null 2>&1; then
      expected_group="$user"
      home_path="$(getent passwd "$user" | cut -d: -f6)"
      [[ "$(id -gn "$user")" == "$expected_group" &&
        ( "$home_path" == /nonexistent || "$home_path" == "/home/${user}" ) &&
        ! -e "$home_path" &&
        "$(getent passwd "$user" | cut -d: -f7)" == /usr/sbin/nologin ]] || {
        echo "refusing to remove a validation identity after metadata changed" >&2
        return 70
      }
      pkill -KILL -u "$user" 2>/dev/null || true
      userdel "$user"
    fi
  done
  for user in \
    depress-day10-web depress-day10-api depress-day10-outbox \
    depress-day10-worker depress-day10-migration \
    depress-web depress-api depress-outbox depress-worker depress-migration; do
    getent group "$user" >/dev/null 2>&1 && groupdel "$user"
  done
  if getent group depress-release >/dev/null 2>&1; then
    [[ -z "$(getent group depress-release | cut -d: -f4)" ]] || {
      echo "refusing to remove non-empty depress-release group" >&2
      return 70
    }
    groupdel depress-release
  fi
  if getent group depress-day10-release >/dev/null 2>&1; then
    [[ -z "$(getent group depress-day10-release | cut -d: -f4)" ]] || {
      echo "refusing to remove non-empty depress-day10-release group" >&2
      return 70
    }
    groupdel depress-day10-release
  fi

  for user in depress-redis depress-s3; do
    if id "$user" >/dev/null 2>&1; then
      gecos="$(getent passwd "$user" | cut -d: -f5)"
      [[ "$gecos" == "DePress validation ${validation_id}" ]] || {
        echo "refusing to remove base identity after ownership changed" >&2
        return 70
      }
      pkill -KILL -u "$user" 2>/dev/null || true
      userdel "$user"
    fi
  done
  if getent group depress-runtime >/dev/null 2>&1; then
    [[ -z "$(getent group depress-runtime | cut -d: -f4)" ]] || {
      echo "refusing to remove non-empty depress-runtime group" >&2
      return 70
    }
    groupdel depress-runtime
  fi

  for path in "${exact_paths[@]}"; do
    remove_exact_tree "$path" "${exact_paths[@]}"
  done
  rm -f -- "$source_archive"
  if [[ -d "$staging_root" && ! -L "$staging_root" ]]; then
    rmdir "$staging_root" || {
      echo "refusing to remove non-empty validation staging root" >&2
      return 70
    }
  elif [[ -e "$staging_root" || -L "$staging_root" ]]; then
    echo "refusing changed validation staging root" >&2
    return 70
  fi

  for port in 80 443 3000 3001 5432 6379 9000 9001 13000 13001 15432 16379 18443 19000 19001 2375 2376; do
    ! ss -H -lnt "sport = :${port}" | grep -q . || {
      echo "cleanup left validation listener ${port}" >&2
      return 70
    }
  done
  if command -v docker >/dev/null 2>&1; then
    ! docker ps -a --format '{{.Labels}}' |
      grep -q 'com.depress.managed=true'
    ! docker volume ls --format '{{.Labels}}' |
      grep -q 'com.depress.managed=true'
    ! docker network ls --format '{{.Labels}}' |
      grep -q 'com.depress.managed=true'
  fi
  ! pgrep -fa '/opt/depress|depress-day10' | grep -v pgrep

  rm -- "$operator_marker"
  rmdir "$operator_root" 2>/dev/null || true
  echo "cleanup=PASS validation_resources=absent marker=removed"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  cleanup_main "$@"
fi
