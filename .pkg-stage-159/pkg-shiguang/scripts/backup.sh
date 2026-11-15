#!/bin/sh
# 数据库备份：./scripts/backup.sh [输出文件]
set -e
OUT="${1:-./backups/shiguang_$(date +%Y%m%d_%H%M%S).sql.gz}"
mkdir -p "$(dirname "$OUT")"
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-shiguang}" -d "${POSTGRES_DB:-shiguang}" --no-owner --clean --if-exists \
  | gzip > "$OUT"
echo "备份完成：$OUT"
echo "建议同时归档 uploads/ 与 MinIO 数据卷（菜品图片）。"
