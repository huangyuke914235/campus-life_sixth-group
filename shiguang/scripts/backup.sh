#!/usr/bin/env bash
# 可通过 COMPOSE_FILE 选择当前部署使用的配置组。
set -euo pipefail
umask 077

OUT="${1:-./backups/shiguang_$(date -u +%Y%m%d_%H%M%S).sql.gz}"
mkdir -p "$(dirname "$OUT")"
if [[ -e "$OUT" ]]; then
  echo "备份路径已有文件，请选择新路径。" >&2
  exit 1
fi
TEMP_BACKUP="$(mktemp "$(dirname "$OUT")/.shiguang-backup-XXXXXX")"
trap 'rm -f -- "$TEMP_BACKUP"' EXIT

docker compose exec -T postgres sh -eu -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
  | gzip > "$TEMP_BACKUP"
gzip -t "$TEMP_BACKUP"
mv -- "$TEMP_BACKUP" "$OUT"
printf '数据库备份已完成：%s\n' "$OUT"
