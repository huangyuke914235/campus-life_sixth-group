#!/bin/sh
set -e

node -e "require('./apps/api/dist/common/runtime-config.js').validateRuntimeConfig(process.env)"
if [ "${NODE_ENV:-}" = "production" ]; then
  case "${POSTGRES_PASSWORD:-}" in
    ""|shiguang_dev|CHANGE_ME*)
      echo "[entrypoint] 生产环境需要已配置的 POSTGRES_PASSWORD。" >&2
      exit 1
      ;;
  esac
fi
[ "${1:-}" != "--validate-only" ] || exit 0

echo "[entrypoint] 应用数据库迁移…"
pnpm db:deploy

echo "[entrypoint] 启动 API…"
exec node apps/api/dist/main.js
