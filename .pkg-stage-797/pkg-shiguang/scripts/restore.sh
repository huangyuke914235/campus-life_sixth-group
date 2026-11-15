#!/bin/sh
# 数据库恢复：./scripts/restore.sh ./backups/xxx.sql.gz
# 危险操作：会覆盖当前数据库，请先执行 backup.sh 并确认文件。
set -e
FILE="$1"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then echo "用法：./scripts/restore.sh <备份文件.sql.gz>"; exit 1; fi
echo "即将覆盖 ${POSTGRES_DB:-shiguang} 数据库，5 秒内 Ctrl+C 可取消…"
sleep 5
gunzip -c "$FILE" | docker compose exec -T postgres \
  psql -U "${POSTGRES_USER:-shiguang}" -d "${POSTGRES_DB:-shiguang}"
echo "恢复完成，建议执行：pnpm exec prisma migrate deploy"
