#!/usr/bin/env bash

readonly day10_api_user="depress-day10-api"
readonly day10_api_group="depress-day10-api"
readonly day10_outbox_user="depress-day10-outbox"
readonly day10_outbox_group="depress-day10-outbox"
readonly day10_worker_user="depress-day10-worker"
readonly day10_worker_group="depress-day10-worker"
readonly day10_migration_user="depress-day10-migration"
readonly day10_migration_group="depress-day10-migration"
readonly day10_web_user="depress-day10-web"
readonly day10_web_group="depress-day10-web"
readonly day10_release_group="depress-day10-release"
readonly day10_docker_group="docker"
readonly day10_worker_runtime="/run/depress-day10-worker"
readonly day10_web_runtime="/run/depress-day10-web"

readonly -a day10_private_users=(
  "$day10_api_user"
  "$day10_outbox_user"
  "$day10_worker_user"
  "$day10_migration_user"
  "$day10_web_user"
)
readonly -a day10_private_groups=(
  "$day10_api_group"
  "$day10_outbox_group"
  "$day10_worker_group"
  "$day10_migration_group"
  "$day10_web_group"
)
