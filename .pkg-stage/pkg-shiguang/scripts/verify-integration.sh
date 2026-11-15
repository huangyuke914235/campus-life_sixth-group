#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 用一次性 PostgreSQL 容器跑集成测试，跑完自动销毁。
#
# 为什么要隔离库：集成测试会 TRUNCATE 表、并发扣库存、改订单状态，
# 绝不能连到有真实数据的库。这里每次起一个全新容器，用一个随机端口，
# 结束后 docker rm -f，不留痕迹。
#
# 用法：bash scripts/verify-integration.sh
# 前置：Docker Desktop 已启动
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${ITEST_PORT:-55432}"
NAME="shiguang-itest-$$"
PASSWORD="itest_$(date +%s)"
DBPASS="$PASSWORD"

cleanup() {
  echo "==> 清理测试容器 $NAME"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> 启动一次性 PostgreSQL（端口 $PORT，容器 $NAME）"
docker run -d --name "$NAME" \
  -e POSTGRES_USER=itest \
  -e POSTGRES_PASSWORD="$DBPASS" \
  -e POSTGRES_DB=shiguang_test \
  -p "127.0.0.1:$PORT:5432" \
  postgres:16-alpine >/dev/null

echo "==> 等待数据库就绪"
for i in $(seq 1 40); do
  if docker exec "$NAME" pg_isready -U itest -d shiguang_test >/dev/null 2>&1; then
    echo "    就绪（${i}00ms 内）"
    break
  fi
  sleep 1
  if [ "$i" -eq 40 ]; then
    echo "数据库 40s 内未就绪，放弃" >&2
    docker logs "$NAME" --tail 20 >&2 || true
    exit 1
  fi
done

export DATABASE_URL="postgresql://itest:${DBPASS}@127.0.0.1:${PORT}/shiguang_test?schema=public"
export ORDER_TEST_DATABASE_URL="$DATABASE_URL"
export REVIEW_TEST_DATABASE_URL="$DATABASE_URL"

echo "==> 应用迁移"
./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

echo "==> 生成 Prisma Client（如需要）"
./node_modules/.bin/prisma generate --schema prisma/schema.prisma >/dev/null 2>&1 || true

echo ""
echo "==> 跑集成测试（订单 / 取餐 / 评价）"
set +e
(cd apps/api && ../../node_modules/.bin/vitest run \
  src/orders/orders.integration.test.ts \
  src/reviews/reviews.integration.test.ts \
  src/dishes/dishes.integration.test.ts \
  --reporter=verbose 2>&1 | tail -60)
RC=${PIPESTATUS[0]}
set -e

echo ""
if [ "$RC" -eq 0 ]; then
  echo "==> 集成测试全部通过"
else
  echo "==> 集成测试失败（退出码 $RC）" >&2
fi
exit "$RC"
