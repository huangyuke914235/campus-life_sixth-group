#!/usr/bin/env bash
# 先在指定 Compose 项目中创建空的目标数据库。
set -euo pipefail

FILE="${1:-}"
TARGET_DB="${2:-}"
if [[ "$#" -ne 2 || ! -f "$FILE" || ! "$TARGET_DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "用法：bash scripts/restore.sh <备份文件.sql.gz> <独立空库名>" >&2
  exit 2
fi
gzip -t "$FILE"
docker compose exec -T postgres sh -eu -c '
  target="$1"
  if [ "$target" = "$POSTGRES_DB" ]; then
    echo "请选择应用库之外的空数据库。" >&2
    exit 1
  fi
  existing=$(psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$target" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN (\$\$pg_catalog\$\$, \$\$information_schema\$\$) AND n.nspname NOT LIKE \$\$pg_toast%\$\$ AND c.relkind IN (\$\$r\$\$, \$\$p\$\$, \$\$S\$\$, \$\$v\$\$, \$\$m\$\$, \$\$f\$\$)")
  if [ "$existing" != 0 ]; then
    echo "恢复目标必须是空库。" >&2
    exit 1
  fi
' restore "$TARGET_DB"

gzip -dc "$FILE" | docker compose exec -T postgres sh -eu -c \
  'exec psql -X -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$1" --file=-' restore "$TARGET_DB"
printf '备份已恢复到 %s。\n' "$TARGET_DB"
