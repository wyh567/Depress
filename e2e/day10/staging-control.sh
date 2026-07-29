#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
shift || true

release="/opt/depress/current"
worker="depress-pointer-worker.service"
worker_env="/etc/depress-day10/worker.env"
migration_env="/etc/depress-day10/migration.env"
mc_config="/var/lib/depress-day10/mc-root"
failure_bin="/opt/depress-day10-failure-bin"
failure_dropin="/etc/systemd/system/${worker}.d/failure.conf"

valid_uuid() {
  [[ "${1:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]
}

wait_active() {
  local unit="$1"
  for _ in $(seq 1 60); do
    systemctl is-active --quiet "$unit" && return 0
    sleep 0.25
  done
  systemctl status "$unit" --no-pager
  return 1
}

db_query() {
  local sql="$1"
  set -a
  # shellcheck disable=SC1090
  source "$migration_env"
  set +a
  runuser -u postgres -- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "$sql"
}

restart_worker() {
  systemctl daemon-reload
  systemctl restart "$worker"
  wait_active "$worker"
}

case "$command_name" in
  pause-worker)
    systemctl kill --kill-whom=all --signal=SIGSTOP "$worker"
    echo "worker-paused"
    ;;
  resume-worker)
    systemctl kill --kill-whom=all --signal=SIGCONT "$worker"
    echo "worker-resumed"
    ;;
  stop-worker)
    systemctl stop --no-block "$worker"
    systemctl kill --kill-whom=all --signal=SIGKILL "$worker"
    for _ in $(seq 1 40); do
      systemctl is-active --quiet "$worker" || break
      sleep 0.25
    done
    echo "worker-stopped"
    ;;
  start-worker)
    systemctl start "$worker"
    wait_active "$worker"
    echo "worker-started"
    ;;
  restart-worker)
    restart_worker
    echo "worker-restarted"
    ;;
  worker-state)
    systemctl show "$worker" \
      -p ActiveState \
      -p SubState \
      -p Result \
      -p ExecMainStatus \
      -p MainPID \
      -p NRestarts
    ;;
  managed-container-count)
    docker ps -a --no-trunc --quiet \
      --filter label=com.depress.managed=true \
      --filter label=com.depress.component=typst-sandbox |
      awk 'NF { count++ } END { print count + 0 }'
    ;;
  job-status)
    valid_uuid "${1:-}" || exit 64
    db_query "SELECT status FROM compile_jobs WHERE id = '$1'::uuid"
    ;;
  artifact-count)
    valid_uuid "${1:-}" || exit 64
    MC_CONFIG_DIR="$mc_config" mc find day10/depress-day10-artifacts \
      --name "$1.pdf" | awk 'NF { count++ } END { print count + 0 }'
    ;;
  duplicate-near-count)
    valid_uuid "${1:-}" || exit 64
    db_query "WITH target AS (SELECT document_id, requested_revision, template_id, created_at FROM compile_jobs WHERE id = '$1'::uuid) SELECT count(*) FROM compile_jobs jobs, target WHERE jobs.document_id = target.document_id AND jobs.requested_revision = target.requested_revision AND jobs.template_id = target.template_id AND jobs.created_at BETWEEN target.created_at - interval '1 second' AND target.created_at + interval '1 second'"
    ;;
  signed-url-count)
    db_query "SELECT count(*) FROM compile_jobs WHERE row_to_json(compile_jobs)::text LIKE '%X-Amz-%' OR row_to_json(compile_jobs)::text LIKE '%http://%' OR row_to_json(compile_jobs)::text LIKE '%https://%'"
    ;;
  signup-probe-user-count)
    db_query "SELECT count(*) FROM \"user\" WHERE lower(email) = 'day10-signup-probe@invalid.test'"
    ;;
  seed-stability-user)
    seed_file="/etc/depress-day10/seed-stability.env"
    set -a
    # shellcheck disable=SC1090
    source "$seed_file"
    set +a
    runuser -u depress-api --preserve-environment -- \
      /usr/local/bin/pnpm --dir "$release" --filter @depress/api auth:seed-mentor >/dev/null
    echo "stability-user-seeded"
    ;;
  document-cite-order)
    valid_uuid "${1:-}" || exit 64
    db_query "WITH RECURSIVE walk(value, path) AS (
      SELECT envelope_json->'editor', ARRAY[]::bigint[]
      FROM documents
      WHERE id = '$1'::uuid
      UNION ALL
      SELECT child.value, walk.path || child.ordinality
      FROM walk
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(walk.value->'content') = 'array'
            THEN walk.value->'content'
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS child(value, ordinality)
    )
    SELECT COALESCE(
      jsonb_agg(value->'attrs'->>'citeKey' ORDER BY path),
      '[]'::jsonb
    )::text
    FROM walk
    WHERE value->>'type' = 'citation'"
    ;;
  enable-compiler-failure)
    install -d -m 0755 "$failure_bin" "$(dirname "$failure_dropin")"
    printf '%s\n' \
      '#!/usr/bin/env bash' \
      'if [[ "${1:-}" == "run" ]]; then' \
      '  echo "day10 controlled compiler failure" >&2' \
      '  exit 42' \
      'fi' \
      'exec /usr/bin/docker "$@"' \
      > "$failure_bin/docker"
    chmod 0755 "$failure_bin/docker"
    printf '%s\n' \
      '[Service]' \
      "Environment=PATH=$failure_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin" \
      > "$failure_dropin"
    restart_worker
    echo "compiler-failure-enabled"
    ;;
  disable-compiler-failure)
    rm -f "$failure_dropin"
    rm -rf "$failure_bin"
    restart_worker
    echo "compiler-failure-disabled"
    ;;
  detach-upload)
    worker_key="$(sed -n 's/^S3_ACCESS_KEY_ID=//p' "$worker_env")"
    MC_CONFIG_DIR="$mc_config" mc admin policy detach day10 day10-worker \
      --user "$worker_key" >/dev/null
    echo "upload-failure-enabled"
    ;;
  attach-upload)
    worker_key="$(sed -n 's/^S3_ACCESS_KEY_ID=//p' "$worker_env")"
    MC_CONFIG_DIR="$mc_config" mc admin policy attach day10 day10-worker \
      --user "$worker_key" >/dev/null
    echo "upload-failure-disabled"
    ;;
  pdf-info)
    [[ "${1:-}" =~ ^[a-z0-9-]+\.pdf$ ]] || exit 64
    pdfinfo "/mnt/d/depress-day10-wsl/artifacts/$1"
    ;;
  pdf-text)
    [[ "${1:-}" =~ ^[a-z0-9-]+\.pdf$ ]] || exit 64
    pdftotext -layout "/mnt/d/depress-day10-wsl/artifacts/$1" -
    ;;
  topology)
    echo "release=$(cat /opt/depress/current/.depress-release)"
    for unit in depress-web-day10.service depress-api.service depress-outbox.service depress-pointer-worker.service; do
      systemctl show "$unit" -p Id -p ActiveState -p SubState -p User -p Group -p MainPID -p ExecStart --value |
        tr '\n' ' ' | sed "s/^/$unit /"
      echo
    done
    ss -lntp | awk 'NR == 1 || /:15432 |:16379 |:18443 |:19000 |:19001 /'
    ;;
  separation)
    if runuser -u depress-api -- docker info >/dev/null 2>&1; then
      echo "api-docker=unexpected-access"
      exit 1
    fi
    runuser -u depress-worker -- docker info >/dev/null
    worker_pid="$(systemctl show "$worker" -p MainPID --value)"
    nsenter -t "$worker_pid" -m -- runuser -u depress-worker -- test -w /run/depress-worker
    for path in "$release" /etc /var/log /tmp; do
      if nsenter -t "$worker_pid" -m -- runuser -u depress-worker -- test -w "$path"; then
        echo "unexpected-worker-write=$path"
        exit 1
      fi
    done
    echo "api-docker=denied worker-docker=allowed worker-write=/run/depress-worker-only"
    ;;
  network-boundaries)
    for port in 15432 16379 19000 19001; do
      if ss -H -lnt "sport = :${port}" |
        awk '$4 !~ /^127\.0\.0\.1:/ && $4 !~ /^\[::1\]:/ { found=1 } END { exit !found }'; then
        echo "unexpected-public-listener=${port}" >&2
        exit 1
      fi
    done
    if ss -H -lnt '( sport = :2375 or sport = :2376 )' | grep -q .; then
      echo "unexpected-docker-tcp-listener" >&2
      exit 1
    fi
    echo "postgres=loopback redis=loopback s3=loopback docker-tcp=absent"
    ;;
  *)
    echo "unknown staging-control command" >&2
    exit 64
    ;;
esac
