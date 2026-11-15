#!/bin/sh
set -e

echo "[entrypoint] 应用数据库迁移…"
pnpm exec prisma migrate deploy

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  echo "[entrypoint] 初始化演示数据（仅开发环境应开启）…"
  pnpm exec tsx prisma/seed.ts || echo "[entrypoint] seed 已跳过或已执行过"
fi

echo "[entrypoint] 启动 API…"
exec node apps/api/dist/main.js
