#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 唯一发版入口：从工作区打出可部署的 tar.gz
#
# 为什么需要脚本：手工 tar 容易漏文件（历史上 zip 就缺了 12 张菜品图
# 和 dish-image.ts，导致 next build 直接失败），也容易被临时文件污染。
#
# 用法：bash scripts/package.sh
# 产出：上层目录 campus-life-deploy.tar.gz（含 MANIFEST.txt）
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$(cd "$ROOT/.." && pwd)"
OUT="$OUT_DIR/campus-life-deploy.tar.gz"
PKG="pkg-shiguang"
# 不用 mktemp：Git Bash 下它返回 C:// 盘符路径，tar 无法处理
STAGE="$OUT_DIR/.pkg-stage-$$"
rm -rf "$STAGE"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "==> 打包源：$ROOT"
mkdir -p "$STAGE/$PKG"

# 排除清单：依赖 / 产物 / 凭据 / 临时残留 / 本地产物
tar -cf - \
  --exclude=./node_modules --exclude='*/node_modules' \
  --exclude=./dist --exclude='*/dist' \
  --exclude=./.next \
  --exclude=./test-results --exclude=./playwright-report --exclude=./coverage \
  --exclude=./.env --exclude=./.env.local --exclude=./.env.production \
  --exclude=./infra/certs --exclude='*.pem' --exclude='*.key' \
  --exclude=./azure \
  --exclude=./tests/e2e/.auth \
  --exclude=./apps/api/seed.tmp.ts --exclude=./apps/api/seed-out \
  --exclude=./apps/api/scripts/smoke.js \
  --exclude=./.git --exclude=./.workbuddy \
  --exclude='*.log' --exclude=./uploads --exclude=./backups \
  --exclude=./package-lock.json \
  . | tar -xf - -C "$STAGE/$PKG"

# ── MANIFEST：部署机解压后可核对 ──
{
  echo "包名：$PKG"
  echo "生成时间：$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git commit：$(git rev-parse --short HEAD 2>/dev/null || echo '未初始化')"
  echo "文件总数：$(find "$STAGE/$PKG" -type f | wc -l | tr -d ' ')"
  echo ""
  echo "── 关键资源校验 ──"
  echo "菜品图数量：$(find "$STAGE/$PKG/apps/web/public/images/dishes" -name '*.jpg' 2>/dev/null | wc -l | tr -d ' ')（应为 12）"
  echo "dish-image.ts：$([ -f "$STAGE/$PKG/apps/web/src/lib/dish-image.ts" ] && echo '存在' || echo '缺失！')"
  echo "seed.ts 画像数：$(grep -c 'userPreference.create' "$STAGE/$PKG/prisma/seed.ts" 2>/dev/null || echo 0)（应为 6）"
  echo ""
  echo "── 敏感文件检查（应全部为 0）──"
  echo ".env：$(find "$STAGE/$PKG" -name '.env' | wc -l | tr -d ' ')"
  echo "*.pem：$(find "$STAGE/$PKG" -name '*.pem' | wc -l | tr -d ' ')"
  echo "*.key：$(find "$STAGE/$PKG" -name '*.key' | wc -l | tr -d ' ')"
} > "$STAGE/$PKG/MANIFEST.txt"

rm -f "$OUT"
tar -czf "$OUT" -C "$STAGE" "$PKG"

echo ""
echo "==> 产出：$OUT（$(du -h "$OUT" | cut -f1)）"
echo ""
cat "$STAGE/$PKG/MANIFEST.txt"
