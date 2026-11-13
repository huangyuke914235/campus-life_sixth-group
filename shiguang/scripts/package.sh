#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

MODE=release
if [[ "${1:-}" == "--working-tree" ]]; then MODE=candidate; shift; fi
if [[ "$#" -gt 1 ]]; then
  echo "用法：bash scripts/package.sh [--working-tree] [输出文件.tar.gz]" >&2
  exit 2
fi
OUT="${1:-backups/releases/campus-life-${MODE}.tar.gz}"
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd -P)/$(basename "$OUT")"
if [[ -e "$OUT" || -e "$OUT.sha256" ]]; then
  echo "输出路径已有文件，请选择新路径。" >&2
  exit 1
fi

STAGE="$(mktemp -d "$(dirname "$OUT")/.shiguang-package-XXXXXX")"
trap 'rm -rf -- "$STAGE"' EXIT
PKG="$STAGE/pkg-shiguang"
mkdir "$PKG"

if [[ "$MODE" == release ]]; then
  REVISION="$(git rev-parse HEAD)"
  git archive --format=tar "$REVISION:shiguang" | tar -xf - -C "$PKG"
else
  REVISION="working-tree-candidate"
  tar -cf - \
    --exclude=node_modules --exclude=dist --exclude=.next --exclude=out \
    --exclude=test-results --exclude=playwright-report --exclude=coverage \
    --exclude=.env --exclude='.env.*.local' --exclude=.env.local --exclude=.env.production \
    --exclude=infra/certs --exclude='*.pem' --exclude='*.key' --exclude='*.p12' --exclude='*.pfx' \
    --exclude=tests/e2e/.auth --exclude=apps/api/seed.tmp.ts --exclude=apps/api/seed-out \
    --exclude=apps/api/scripts/smoke.js --exclude=package-lock.json --exclude='*.tsbuildinfo' --exclude='*.log' \
    package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .dockerignore .gitignore \
    .env.example .env.production.example docker-compose*.yml \
    README.md DEPLOY-CLOUDFLARE.md apps azure docs infra packages prisma scripts tests \
    | tar -xf - -C "$PKG"
fi

for required in \
  pnpm-lock.yaml prisma/schema.prisma apps/api/src/uploads/uploads.module.ts \
  apps/web/src/lib/dish-image.ts infra/Dockerfile.api infra/Dockerfile.web \
  docker-compose.yml docker-compose.dev.yml docker-compose.prod.yml docker-compose.tls.yml \
  docker-compose.cloudflare.yml; do
  [[ -f "$PKG/$required" ]] || { echo "发布包缺少 $required" >&2; exit 1; }
done
[[ -n "$(find "$PKG/prisma/migrations" -name migration.sql -print -quit)" ]] || { echo "发布包缺少数据库迁移。" >&2; exit 1; }
images="$(grep -Eo '/images/dishes/[a-zA-Z0-9_.-]+' "$PKG/apps/web/src/lib/dish-image.ts" | sort -u)"
while IFS= read -r image; do
  [[ -f "$PKG/apps/web/public$image" ]] || { echo "发布包缺少菜品图片 $image。" >&2; exit 1; }
done <<< "$images"

if [[ -n "$(find "$PKG" \( -name node_modules -o -path '*/infra/certs' -o -path '*/tests/e2e/.auth' \
  -o -iname '*.pem' -o -iname '*.key' -o -iname '*.p12' -o -iname '*.pfx' -o -iname '*.sql.gz' -o -iname '*.dump' \
  -o \( -name '.env*' ! -name '.env.example' ! -name '.env.production.example' \) \) -print -quit)" ]]; then
  echo "发布包包含环境配置、证书、会话或依赖目录，打包已停止。" >&2
  exit 1
fi

{
  printf 'source=%s\n' "$REVISION"
  printf 'mode=%s\n' "$MODE"
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$PKG/MANIFEST.txt"
tar -czf "$STAGE/archive.tar.gz" -C "$STAGE" pkg-shiguang
SHA="$(sha256sum "$STAGE/archive.tar.gz" | cut -d ' ' -f 1)"
printf '%s  %s\n' "$SHA" "$(basename "$OUT")" > "$STAGE/archive.sha256"
mv -- "$STAGE/archive.tar.gz" "$OUT"
mv -- "$STAGE/archive.sha256" "$OUT.sha256"
printf '发布包：%s\n校验文件：%s\n' "$OUT" "$OUT.sha256"
