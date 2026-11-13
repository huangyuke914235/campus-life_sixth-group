#!/usr/bin/env bash
set -euo pipefail
umask 077

# 由运维人员在已授权的 Azure VM 执行。配置和证书保留在部署主机。
APP_DIR="${APP_DIR:-/opt/shiguang}"
APP_DIR="$(cd "$APP_DIR" && pwd -P)"
ARCHIVE="${1:-$APP_DIR/campus-life-release.tar.gz}"
DOMAIN="${DOMAIN:-campus-life.ccwu.cc}"
ENTRYPOINT="${DEPLOY_ENTRYPOINT:-tls}"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-pkg-shiguang}"
ACTIVE="$APP_DIR/pkg-shiguang"
PREVIOUS="$APP_DIR/pkg-shiguang.previous.$(date -u +%Y%m%d%H%M%S).$$"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$ACTIVE/.env}"
DEPLOY_CERT_DIR="${DEPLOY_CERT_DIR:-$ACTIVE/infra/certs}"

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ -f "$ARCHIVE" && -f "$ARCHIVE.sha256" ]] || fail "缺少发布包或校验文件。"
[[ -f "$DEPLOY_ENV_FILE" ]] || fail "请先在部署主机准备生产环境配置文件。"
command -v docker >/dev/null || fail "Docker 未安装。"

ARCHIVE_DIR="$(cd "$(dirname "$ARCHIVE")" && pwd -P)"
ARCHIVE="$ARCHIVE_DIR/$(basename "$ARCHIVE")"
expected="$(cut -d ' ' -f 1 < "$ARCHIVE.sha256")"
actual="$(sha256sum "$ARCHIVE" | cut -d ' ' -f 1)"
[[ "$expected" == "$actual" ]] || fail "发布包校验失败。"

STAGE="$(mktemp -d "$APP_DIR/.shiguang-deploy-XXXXXX")"
trap 'rm -rf -- "$STAGE"' EXIT
tar -xzf "$ARCHIVE" --no-same-owner --no-same-permissions -C "$STAGE"
RELEASE="$STAGE/pkg-shiguang"
[[ -f "$RELEASE/MANIFEST.txt" && -f "$RELEASE/pnpm-lock.yaml" ]] || fail "发布包缺少清单或锁文件。"
grep -qx 'mode=release' "$RELEASE/MANIFEST.txt" || fail "部署需要来自提交的发布制品。"
cp -- "$DEPLOY_ENV_FILE" "$RELEASE/.env"
chmod 600 "$RELEASE/.env"

compose=(docker compose --project-name "$COMPOSE_PROJECT" -f docker-compose.yml -f docker-compose.prod.yml)
case "$ENTRYPOINT" in
  tls)
    [[ -f "$DEPLOY_CERT_DIR/fullchain.pem" && -f "$DEPLOY_CERT_DIR/privkey.pem" ]] || fail "请先配置 TLS 证书。"
    mkdir -p "$RELEASE/infra/certs"
    cp -- "$DEPLOY_CERT_DIR/fullchain.pem" "$DEPLOY_CERT_DIR/privkey.pem" "$RELEASE/infra/certs/"
    chmod 600 "$RELEASE/infra/certs/privkey.pem"
    compose+=(-f docker-compose.tls.yml)
    ;;
  tunnel) compose+=(-f docker-compose.cloudflare.yml) ;;
  *) fail "DEPLOY_ENTRYPOINT 只支持 tls 或 tunnel。" ;;
esac

(
  cd "$RELEASE"
  "${compose[@]}" config --quiet
  "${compose[@]}" build
  "${compose[@]}" run --rm --no-deps -T api \
    sh /app/scripts/entrypoint-api.sh --validate-only
)

if [[ -d "$ACTIVE" ]]; then mv -- "$ACTIVE" "$PREVIOUS"; fi
if ! mv -- "$RELEASE" "$ACTIVE"; then
  if [[ -d "$PREVIOUS" ]]; then mv -- "$PREVIOUS" "$ACTIVE"; fi
  fail "发布目录替换失败。"
fi
cd "$ACTIVE"
if ! "${compose[@]}" up -d --wait --wait-timeout 180; then
  "${compose[@]}" ps
  printf '部署未就绪。上一版目录（如存在）：%s\n' "$PREVIOUS" >&2
  exit 1
fi
"${compose[@]}" ps
printf '服务就绪。请访问 https://%s/ 并复核站点入口。\n' "$DOMAIN"
if [[ -d "$PREVIOUS" ]]; then printf '上一版目录：%s\n' "$PREVIOUS"; fi
