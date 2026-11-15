#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 备份 / 恢复演练：证明「备份能生成、能校验、能还原、数据一条不少」。
#
# 演练流程：
#   1. 起一次性 PostgreSQL（源库），迁移 + 写入哨兵数据
#   2. pg_dump 备份 → gzip → 校验完整性
#   3. 在同实例里建空库，从备份恢复
#   4. 逐表比对行数，确认哨兵记录都在
#   5. 销毁容器
#
# 用法：bash scripts/verify-restore.sh
# 前置：Docker 已启动
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${RESTORE_PORT:-$((RANDOM % 500 + 55600))}"  # 随机端口，避免残留容器占用
NAME="shiguang-restore-$$"
DBPASS="restore_$(date +%s)"
SRC_DB="shiguang_test"
DST_DB="shiguang_restored"
DUMP_DIR="$(mktemp -d)"
DUMP_FILE="$DUMP_DIR/backup.sql.gz"

cleanup() {
  echo "==> 清理"
  rm -rf "$DUMP_DIR"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 必须带 -i：heredoc 和管道都靠 stdin 传进去，缺了它会静默变成空操作
c() { docker exec -i "$NAME" "$@"; }

echo "==> 启动一次性 PostgreSQL（端口 $PORT）"
docker run -d --name "$NAME" \
  -e POSTGRES_USER=itest \
  -e POSTGRES_PASSWORD="$DBPASS" \
  -e POSTGRES_DB="$SRC_DB" \
  -p "127.0.0.1:$PORT:5432" \
  postgres:16-alpine >/dev/null

echo "==> 等待就绪"
for i in $(seq 1 40); do
  c pg_isready -U itest -d "$SRC_DB" >/dev/null 2>&1 && break
  sleep 1
  [ "$i" -eq 40 ] && { echo "数据库未就绪" >&2; exit 1; }
done

export DATABASE_URL="postgresql://itest:${DBPASS}@127.0.0.1:${PORT}/${SRC_DB}?schema=public"
echo "==> 应用迁移"
./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma >/dev/null

echo "==> 写入哨兵数据"
c psql -U itest -d "$SRC_DB" -q <<'SQL'
INSERT INTO "User" (id, email, "passwordHash", "displayName", role, "createdAt", "updatedAt")
VALUES ('sentinel-user-0001', 'sentinel@restore.test', 'x', '哨兵用户', 'STUDENT', now(), now());

INSERT INTO "Canteen" (id, name, location, "openTime", "closeTime", "createdAt", "updatedAt")
VALUES ('sentinel-canteen-01', '哨兵食堂', '测试位置', '07:00', '21:00', now(), now());

INSERT INTO "Stall" (id, "canteenId", name, "windowNo", floor, "isActive", "createdAt", "updatedAt")
VALUES ('sentinel-stall-001', 'sentinel-canteen-01', '哨兵档口', '1', '1F', true, now(), now());
SQL
echo "    已插入 3 条哨兵记录"

echo "==> 记录备份前各表行数"
BEFORE=$(c psql -U itest -d "$SRC_DB" -t -A -F'|' -c "
  SELECT 'User', count(*) FROM \"User\"
  UNION ALL SELECT 'Canteen', count(*) FROM \"Canteen\"
  UNION ALL SELECT 'Stall', count(*) FROM \"Stall\"
  UNION ALL SELECT 'Dish', count(*) FROM \"Dish\"
  ORDER BY 1;")
echo "$BEFORE" | sed 's/^/    /'

echo "==> pg_dump 备份"
if ! c pg_dump -U itest -d "$SRC_DB" --no-owner --no-privileges | gzip > "$DUMP_FILE"; then
  echo "!! pg_dump 失败，必须让调用方看到非零退出码" >&2
  exit 1
fi
gzip -t "$DUMP_FILE"
echo "    备份大小：$(du -h "$DUMP_FILE" | cut -f1)"

echo "==> 在空库中恢复"
c psql -U itest -d postgres -q -c "CREATE DATABASE $DST_DB;"
if ! gunzip -c "$DUMP_FILE" | c psql -U itest -d "$DST_DB" -v ON_ERROR_STOP=1 -q; then
  echo "!! 恢复过程中出现 SQL 错误（ON_ERROR_STOP 已生效）" >&2
  exit 1
fi

echo "==> 比对恢复后的行数"
AFTER=$(c psql -U itest -d "$DST_DB" -t -A -F'|' -c "
  SELECT 'User', count(*) FROM \"User\"
  UNION ALL SELECT 'Canteen', count(*) FROM \"Canteen\"
  UNION ALL SELECT 'Stall', count(*) FROM \"Stall\"
  UNION ALL SELECT 'Dish', count(*) FROM \"Dish\"
  ORDER BY 1;")
echo "$AFTER" | sed 's/^/    /'

if [ "$BEFORE" != "$AFTER" ]; then
  echo "!! 行数不一致" >&2
  diff <(echo "$BEFORE") <(echo "$AFTER") >&2 || true
  exit 1
fi

echo "==> 校验哨兵记录可读"
SENTINEL=$(c psql -U itest -d "$DST_DB" -t -A -c "SELECT email FROM \"User\" WHERE id = 'sentinel-user-0001';")
if [ "$SENTINEL" != "sentinel@restore.test" ]; then
  echo "!! 哨兵用户丢失" >&2
  exit 1
fi
echo "    哨兵用户：$SENTINEL"

echo ""
echo "==> 恢复演练通过：备份可生成、可校验、可还原、数据一致"
