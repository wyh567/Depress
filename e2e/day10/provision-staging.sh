#!/usr/bin/env bash

day10_database_password=""

provision_day10_staging() {
  local auth_secret minio_root_user minio_root_password
  local worker_access_key worker_secret_key mentor_a_password mentor_b_password
  local database_url stability_email stability_password

  for account in depress-web depress-api depress-outbox depress-worker depress-redis depress-s3; do
    id "$account" >/dev/null
  done
  getent group depress-runtime >/dev/null
  getent group docker >/dev/null

  install -d -m 0755 "$config_dir"
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
  database_url="postgresql://depress_day10:${day10_database_password}@127.0.0.1:5432/depress_day10"

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

  chmod 0600 "${config_dir}"/*.env "${staging_root}/e2e.env"

  openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
    -keyout "${config_dir}/tls.key" \
    -out "${config_dir}/tls.crt" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" \
    >/dev/null 2>&1
  chmod 0600 "${config_dir}/tls.key"
  chmod 0644 "${config_dir}/tls.crt"

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
    ssl_certificate /etc/depress-day10/tls.crt;
    ssl_certificate_key /etc/depress-day10/tls.key;

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

  cat > /etc/systemd/system/depress-web-day10.service <<'UNIT'
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

  cat > /etc/systemd/system/depress-api.service <<'UNIT'
[Unit]
Description=DePress Day 10 authenticated API
After=network.target postgresql@16-main.service depress-redis-day10.service depress-minio-day10.service
Requires=postgresql@16-main.service depress-redis-day10.service depress-minio-day10.service
[Service]
Type=simple
User=depress-api
Group=depress-runtime
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

  cat > /etc/systemd/system/depress-outbox.service <<'UNIT'
[Unit]
Description=DePress Day 10 compile outbox publisher
After=network.target postgresql@16-main.service depress-redis-day10.service
Requires=postgresql@16-main.service depress-redis-day10.service
[Service]
Type=simple
User=depress-outbox
Group=depress-runtime
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

  cat > /etc/systemd/system/depress-pointer-worker.service <<'UNIT'
[Unit]
Description=DePress Day 10 persisted compile pointer worker
After=network.target postgresql@16-main.service depress-redis-day10.service depress-minio-day10.service
Requires=postgresql@16-main.service depress-redis-day10.service depress-minio-day10.service
[Service]
Type=simple
User=depress-worker
Group=depress-runtime
SupplementaryGroups=docker
WorkingDirectory=/opt/depress/current
EnvironmentFile=/etc/depress-day10/worker.env
RuntimeDirectory=depress-worker
RuntimeDirectoryMode=0700
Environment=HOME=/run/depress-worker
Environment=TMPDIR=/run/depress-worker
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
ReadWritePaths=/run/depress-worker
UNIT

  cat > /etc/systemd/system/depress-redis-day10.service <<'UNIT'
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

  cat > /etc/systemd/system/depress-minio-day10.service <<'UNIT'
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

  cat > /etc/systemd/system/depress-nginx-day10.service <<'UNIT'
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

  systemctl daemon-reload
  systemd-analyze verify /etc/systemd/system/depress-pointer-worker.service
}

remove_day10_staging_config() {
  local unit_file
  for unit_file in \
    /etc/systemd/system/depress-nginx-day10.service \
    /etc/systemd/system/depress-pointer-worker.service \
    /etc/systemd/system/depress-outbox.service \
    /etc/systemd/system/depress-api.service \
    /etc/systemd/system/depress-web-day10.service \
    /etc/systemd/system/depress-redis-day10.service \
    /etc/systemd/system/depress-minio-day10.service; do
    rm -f -- "$unit_file"
  done
  if [[ -d "$config_dir" ]]; then
    find "$config_dir" -depth -mindepth 1 -delete
    rmdir "$config_dir"
  fi
  rm -f -- "${staging_root}/e2e.env"
  systemctl daemon-reload
}
