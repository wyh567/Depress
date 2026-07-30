#!/usr/bin/env bash

day10_database_password=""
day10_config_created=0
day10_identity_state_written=0
day10_created_users=()
day10_created_groups=()
day10_units_created=()
day10_unit_dir="${DAY10_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"

create_day10_private_identities() {
  local index user group

  for user in "${day10_private_users[@]}"; do
    ! id "$user" >/dev/null 2>&1 || {
      echo "refusing pre-existing Day 10 user: ${user}" >&2
      return 71
    }
  done
  for group in "${day10_private_groups[@]}"; do
    ! getent group "$group" >/dev/null 2>&1 || {
      echo "refusing pre-existing Day 10 group: ${group}" >&2
      return 71
    }
  done

  install -d -o root -g root -m 0755 "$state_root"
  [[ ! -e "$identity_state_file" && ! -L "$identity_state_file" ]] || {
    echo "refusing pre-existing Day 10 identity marker" >&2
    return 71
  }
  printf '%s\n' \
    "run_id=${run_id}" \
    "candidate=${exact_commit}" \
    "api=${day10_api_user}:${day10_api_group}" \
    "outbox=${day10_outbox_user}:${day10_outbox_group}" \
    "worker=${day10_worker_user}:${day10_worker_group}" \
    "migration=${day10_migration_user}:${day10_migration_group}" \
    > "$identity_state_file"
  chmod 0600 "$identity_state_file"
  day10_identity_state_written=1

  for ((index=0; index<${#day10_private_groups[@]}; index++)); do
    group="${day10_private_groups[$index]}"
    user="${day10_private_users[$index]}"
    groupadd --system "$group"
    day10_created_groups+=("$group")
    useradd --system --no-create-home --shell /usr/sbin/nologin \
      --gid "$group" "$user"
    day10_created_users+=("$user")
  done
  usermod -aG "$day10_docker_group" "$day10_worker_user"
}

remove_day10_private_identities() {
  local index user group

  (( day10_identity_state_written == 1 )) || return 0
  [[ -f "$identity_state_file" && ! -L "$identity_state_file" &&
    "$(stat -c '%U:%G:%a' "$identity_state_file")" == "root:root:600" ]] || {
    echo "refusing identity cleanup without the exact root-owned marker" >&2
    return 70
  }
  grep -Fxq "run_id=${run_id}" "$identity_state_file" &&
    grep -Fxq "candidate=${exact_commit}" "$identity_state_file" &&
    grep -Fxq "api=${day10_api_user}:${day10_api_group}" "$identity_state_file" &&
    grep -Fxq "outbox=${day10_outbox_user}:${day10_outbox_group}" "$identity_state_file" &&
    grep -Fxq "worker=${day10_worker_user}:${day10_worker_group}" "$identity_state_file" &&
    grep -Fxq "migration=${day10_migration_user}:${day10_migration_group}" "$identity_state_file" || {
      echo "refusing identity cleanup after ownership marker changed" >&2
      return 70
    }

  for ((index=${#day10_created_users[@]} - 1; index >= 0; index--)); do
    user="${day10_created_users[$index]}"
    group="${day10_created_groups[$index]}"
    id "$user" >/dev/null 2>&1 &&
      [[ "$(id -gn "$user")" == "$group" ]] || {
        echo "refusing cleanup after a Day 10 user identity changed" >&2
        return 70
      }
    ! pgrep -u "$user" >/dev/null 2>&1 || {
      echo "refusing to delete a Day 10 identity with a live process" >&2
      return 70
    }
    userdel "$user"
  done
  for ((index=${#day10_created_groups[@]} - 1; index >= 0; index--)); do
    group="${day10_created_groups[$index]}"
    if getent group "$group" >/dev/null 2>&1; then
      groupdel "$group"
    fi
  done
  rm -- "$identity_state_file"
  day10_identity_state_written=0
}

provision_day10_staging() {
  local auth_secret minio_root_user minio_root_password
  local worker_access_key worker_secret_key mentor_a_password mentor_b_password
  local database_url stability_email stability_password unit_path

  for account in depress-web depress-redis depress-s3; do
    id "$account" >/dev/null
  done
  getent group depress-runtime >/dev/null
  getent group "$day10_docker_group" >/dev/null

  [[ ! -e "$config_dir" && ! -L "$config_dir" ]] || {
    echo "refusing pre-existing Day 10 config directory" >&2
    return 71
  }
  create_day10_private_identities
  install -d -o root -g root -m 0711 "$config_dir"
  day10_config_created=1
  install -d -o root -g root -m 0700 "${config_dir}/tls"
  install -d -m 0700 "$staging_root"
  install -d -m 0750 "$log_dir"

  day10_database_password="$(openssl rand -hex 24)"
  auth_secret="$(openssl rand -hex 32)"
  minio_root_user="day10root$(openssl rand -hex 6)"
  minio_root_password="$(openssl rand -hex 24)"
  worker_access_key="day10worker$(openssl rand -hex 6)"
  worker_secret_key="$(openssl rand -hex 24)"
  mentor_a_password="$(openssl rand -hex 24)"
  mentor_b_password="$(openssl rand -hex 24)"
  database_url="postgresql://depress_day10:${day10_database_password}@127.0.0.1:${postgres_port}/depress_day10"

  printf '%s\n' \
    "NODE_ENV=production" \
    "PORT=13000" \
    "HOSTNAME=127.0.0.1" \
    > "${config_dir}/web.env"

  printf '%s\n' \
    "NODE_ENV=production" \
    "LOG_LEVEL=info" \
    "API_BIND_HOST=127.0.0.1" \
    "API_PORT=13001" \
    "PUBLIC_ORIGIN=https://127.0.0.1:18443" \
    "AUTH_ORIGIN=https://127.0.0.1:18443" \
    "BETTER_AUTH_SECRET=${auth_secret}" \
    "DATABASE_URL=${database_url}" \
    "REDIS_URL=redis://127.0.0.1:16379" \
    "S3_ENDPOINT=http://127.0.0.1:19000" \
    "S3_REGION=us-east-1" \
    "S3_BUCKET=depress-day10-artifacts" \
    "S3_ACCESS_KEY_ID=${worker_access_key}" \
    "S3_SECRET_ACCESS_KEY=${worker_secret_key}" \
    > "${config_dir}/api.env"

  printf '%s\n' \
    "NODE_ENV=production" \
    "LOG_LEVEL=info" \
    "DATABASE_URL=${database_url}" \
    "REDIS_URL=redis://127.0.0.1:16379" \
    "OUTBOX_BATCH_SIZE=10" \
    "OUTBOX_POLL_INTERVAL_MS=100" \
    > "${config_dir}/outbox.env"

  printf '%s\n' \
    "NODE_ENV=production" \
    "LOG_LEVEL=info" \
    "DATABASE_URL=${database_url}" \
    "REDIS_URL=redis://127.0.0.1:16379" \
    "S3_ENDPOINT=http://127.0.0.1:19000" \
    "S3_REGION=us-east-1" \
    "S3_BUCKET=depress-day10-artifacts" \
    "S3_ACCESS_KEY_ID=${worker_access_key}" \
    "S3_SECRET_ACCESS_KEY=${worker_secret_key}" \
    "POINTER_WORKER_CONCURRENCY=1" \
    "TYPST_IMAGE=ghcr.io/typst/typst@sha256:b23ba03da5c085a2c8780bc9f2296db937abe1d0c75348cf2f8a9273199c3a14" \
    "TYPST_FONT_PATH=/opt/depress/current/apps/api/assets/fonts" \
    > "${config_dir}/worker.env"

  printf '%s\n' "DATABASE_URL=${database_url}" > "${config_dir}/migration.env"
  printf '%s\n' \
    "MINIO_ROOT_USER=${minio_root_user}" \
    "MINIO_ROOT_PASSWORD=${minio_root_password}" \
    > "${config_dir}/minio-root.env"

  printf '%s\n' \
    "NODE_ENV=production" \
    "DATABASE_URL=${database_url}" \
    "BETTER_AUTH_SECRET=${auth_secret}" \
    "AUTH_ORIGIN=https://127.0.0.1:18443" \
    "MENTOR_EMAIL=mentor-a@day10.invalid" \
    "MENTOR_PASSWORD=${mentor_a_password}" \
    "MENTOR_NAME=Mentor-A" \
    > "${config_dir}/seed-a.env"

  printf '%s\n' \
    "NODE_ENV=production" \
    "DATABASE_URL=${database_url}" \
    "BETTER_AUTH_SECRET=${auth_secret}" \
    "AUTH_ORIGIN=https://127.0.0.1:18443" \
    "MENTOR_EMAIL=mentor-b@day10.invalid" \
    "MENTOR_PASSWORD=${mentor_b_password}" \
    "MENTOR_NAME=Mentor-B" \
    > "${config_dir}/seed-b.env"

  printf '%s\n' \
    "DAY10_BASE_URL=https://127.0.0.1:18443" \
    "DAY10_MENTOR_A_EMAIL=mentor-a@day10.invalid" \
    "DAY10_MENTOR_A_PASSWORD=${mentor_a_password}" \
    "DAY10_MENTOR_B_EMAIL=mentor-b@day10.invalid" \
    "DAY10_MENTOR_B_PASSWORD=${mentor_b_password}" \
    > "${staging_root}/e2e.env"

  stability_email="mentor-stability@day10.invalid"
  stability_password="$(openssl rand -hex 24)"
  printf '%s\n' \
    "NODE_ENV=production" \
    "DATABASE_URL=${database_url}" \
    "BETTER_AUTH_SECRET=${auth_secret}" \
    "AUTH_ORIGIN=https://127.0.0.1:18443" \
    "MENTOR_EMAIL=${stability_email}" \
    "MENTOR_PASSWORD=${stability_password}" \
    "MENTOR_NAME=Mentor-Stability" \
    > "${config_dir}/seed-stability.env"
  printf '%s\n' \
    "DAY10_STABILITY_USER_EMAIL=${stability_email}" \
    "DAY10_STABILITY_USER_PASSWORD=${stability_password}" \
    >> "${staging_root}/e2e.env"

  chown "root:${day10_api_group}" "${config_dir}/api.env"
  chown "root:${day10_outbox_group}" "${config_dir}/outbox.env"
  chown "root:${day10_worker_group}" "${config_dir}/worker.env"
  chown "root:${day10_migration_group}" "${config_dir}/migration.env"
  chmod 0640 \
    "${config_dir}/api.env" \
    "${config_dir}/outbox.env" \
    "${config_dir}/worker.env" \
    "${config_dir}/migration.env"
  chown root:depress-runtime \
    "${config_dir}/web.env" \
    "${config_dir}/minio-root.env"
  chmod 0640 \
    "${config_dir}/web.env" \
    "${config_dir}/minio-root.env"
  chmod 0600 \
    "${config_dir}/seed-a.env" \
    "${config_dir}/seed-b.env" \
    "${config_dir}/seed-stability.env" \
    "${staging_root}/e2e.env"

  openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
    -keyout "${config_dir}/tls/tls.key" \
    -out "${config_dir}/tls/tls.crt" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" \
    >/dev/null 2>&1
  chmod 0600 "${config_dir}/tls/tls.key"
  chmod 0644 "${config_dir}/tls/tls.crt"

  printf '%s\n' \
    "bind 127.0.0.1 ::1" \
    "protected-mode yes" \
    "port 16379" \
    "dir ${redis_data}" \
    "save \"\"" \
    "appendonly no" \
    > "${config_dir}/redis.conf"
  chmod 0644 "${config_dir}/redis.conf"

  cat > "${config_dir}/worker-s3-policy.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::depress-day10-artifacts/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::depress-day10-artifacts"]
    }
  ]
}
JSON

  cat > "${config_dir}/nginx.conf" <<'NGINX'
worker_processes 1;
pid /run/depress-day10/nginx.pid;
error_log /var/log/depress-day10/error.log notice;

events {
  worker_connections 256;
}

http {
  access_log /var/log/depress-day10/access.log;

  server {
    listen 0.0.0.0:18443 ssl;
    server_name localhost 127.0.0.1;
    ssl_certificate /etc/depress-day10/tls/tls.crt;
    ssl_certificate_key /etc/depress-day10/tls/tls.key;

    location = /compile { return 404; }
    location ^~ /jobs/ { return 404; }

    location /api/ {
      proxy_pass http://127.0.0.1:13001;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /health/ {
      proxy_pass http://127.0.0.1:13001;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
    }

    location / {
      proxy_pass http://127.0.0.1:13000;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
  }
}
NGINX

  chmod 0600 "${config_dir}/worker-s3-policy.json" "${config_dir}/nginx.conf"

  install -d -o root -g root -m 0755 "$day10_unit_dir"
  for unit_path in \
    "${day10_unit_dir}/depress-web-day10.service" \
    "${day10_unit_dir}/depress-api.service" \
    "${day10_unit_dir}/depress-outbox.service" \
    "${day10_unit_dir}/depress-pointer-worker.service" \
    "${day10_unit_dir}/depress-redis-day10.service" \
    "${day10_unit_dir}/depress-minio-day10.service" \
    "${day10_unit_dir}/depress-nginx-day10.service"; do
    [[ ! -e "$unit_path" && ! -L "$unit_path" ]] || {
      echo "refusing pre-existing Day 10 systemd unit path" >&2
      return 71
    }
  done

  cat > "${day10_unit_dir}/depress-web-day10.service" <<'UNIT'
[Unit]
Description=DePress Day 10 Web
After=network.target
[Service]
Type=simple
User=depress-web
Group=depress-runtime
WorkingDirectory=/opt/depress/current
EnvironmentFile=/etc/depress-day10/web.env
Environment=HOME=/tmp
ExecStart=/usr/local/bin/pnpm --dir /opt/depress/current --filter @depress/web start
Restart=on-failure
RestartSec=2s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/opt/depress
UNIT
  day10_units_created+=("${day10_unit_dir}/depress-web-day10.service")

  cat > "${day10_unit_dir}/depress-api.service" <<UNIT
[Unit]
Description=DePress Day 10 authenticated API
After=network.target depress-redis-day10.service depress-minio-day10.service
Requires=depress-redis-day10.service depress-minio-day10.service
[Service]
Type=simple
User=${day10_api_user}
Group=${day10_api_group}
WorkingDirectory=/opt/depress/current
EnvironmentFile=/etc/depress-day10/api.env
Environment=HOME=/tmp
ExecStart=/usr/local/bin/pnpm --dir /opt/depress/current --filter @depress/api start:api
Restart=on-failure
RestartSec=2s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadOnlyPaths=/opt/depress
UNIT
  day10_units_created+=("${day10_unit_dir}/depress-api.service")

  cat > "${day10_unit_dir}/depress-outbox.service" <<UNIT
[Unit]
Description=DePress Day 10 compile outbox publisher
After=network.target depress-redis-day10.service
Requires=depress-redis-day10.service
[Service]
Type=simple
User=${day10_outbox_user}
Group=${day10_outbox_group}
WorkingDirectory=/opt/depress/current
EnvironmentFile=/etc/depress-day10/outbox.env
Environment=HOME=/tmp
ExecStart=/usr/local/bin/pnpm --dir /opt/depress/current --filter @depress/api start:outbox
Restart=on-failure
RestartSec=2s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadOnlyPaths=/opt/depress
UNIT
  day10_units_created+=("${day10_unit_dir}/depress-outbox.service")

  cat > "${day10_unit_dir}/depress-pointer-worker.service" <<UNIT
[Unit]
Description=DePress Day 10 persisted compile pointer worker
After=network.target depress-redis-day10.service depress-minio-day10.service
Requires=depress-redis-day10.service depress-minio-day10.service
[Service]
Type=simple
User=${day10_worker_user}
Group=${day10_worker_group}
SupplementaryGroups=${day10_docker_group}
WorkingDirectory=/opt/depress/current
EnvironmentFile=/etc/depress-day10/worker.env
RuntimeDirectory=depress-day10-worker
RuntimeDirectoryMode=0700
Environment=HOME=${day10_worker_runtime}
Environment=TMPDIR=${day10_worker_runtime}
ExecStart=/usr/local/bin/pnpm --dir /opt/depress/current --filter @depress/api start:pointer-worker
Restart=on-failure
RestartSec=2s
TimeoutStopSec=45s
NoNewPrivileges=true
PrivateTmp=false
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadOnlyPaths=/opt/depress /tmp
ReadWritePaths=${day10_worker_runtime}
UNIT
  day10_units_created+=("${day10_unit_dir}/depress-pointer-worker.service")

  cat > "${day10_unit_dir}/depress-redis-day10.service" <<'UNIT'
[Unit]
Description=DePress Day 10 private Redis
After=network.target
[Service]
Type=simple
User=depress-redis
Group=depress-runtime
ExecStart=/usr/bin/redis-server /etc/depress-day10/redis.conf
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/depress-day10/redis
UNIT
  day10_units_created+=("${day10_unit_dir}/depress-redis-day10.service")

  cat > "${day10_unit_dir}/depress-minio-day10.service" <<'UNIT'
[Unit]
Description=DePress Day 10 private S3-compatible storage
After=network.target
[Service]
Type=simple
User=depress-s3
Group=depress-runtime
EnvironmentFile=/etc/depress-day10/minio-root.env
ExecStart=/usr/local/bin/minio server /var/lib/depress-day10/minio --address 127.0.0.1:19000 --console-address 127.0.0.1:19001
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/depress-day10/minio
UNIT
  day10_units_created+=("${day10_unit_dir}/depress-minio-day10.service")

  cat > "${day10_unit_dir}/depress-nginx-day10.service" <<'UNIT'
[Unit]
Description=DePress Day 10 loopback TLS reverse proxy
After=network.target depress-web-day10.service depress-api.service
Requires=depress-web-day10.service depress-api.service
[Service]
Type=simple
RuntimeDirectory=depress-day10
RuntimeDirectoryMode=0755
ExecStartPre=/usr/sbin/nginx -t -c /etc/depress-day10/nginx.conf
ExecStart=/usr/sbin/nginx -c /etc/depress-day10/nginx.conf -g 'daemon off;'
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/run/depress-day10 /var/log/depress-day10
UNIT
  day10_units_created+=("${day10_unit_dir}/depress-nginx-day10.service")

  if [[ "$day10_unit_dir" == "/etc/systemd/system" ]]; then
    systemctl daemon-reload
  fi
  systemd-analyze verify \
    "${day10_unit_dir}/depress-api.service" \
    "${day10_unit_dir}/depress-outbox.service" \
    "${day10_unit_dir}/depress-pointer-worker.service"
}

remove_day10_staging_config() {
  local index unit_file
  for ((index=${#day10_units_created[@]} - 1; index >= 0; index--)); do
    unit_file="${day10_units_created[$index]}"
    [[ -f "$unit_file" && ! -L "$unit_file" ]] || {
      echo "refusing cleanup after a Day 10 unit path changed" >&2
      return 70
    }
    rm -- "$unit_file"
  done
  day10_units_created=()
  if (( day10_config_created == 1 )); then
    [[ -d "$config_dir" && ! -L "$config_dir" ]] || {
      echo "refusing cleanup after the Day 10 config path changed" >&2
      return 70
    }
    find "$config_dir" -depth -mindepth 1 -delete
    rmdir "$config_dir"
    day10_config_created=0
  fi
  rm -f -- "${staging_root}/e2e.env"
  if [[ "$day10_unit_dir" == "/etc/systemd/system" ]]; then
    systemctl daemon-reload
  fi
}
