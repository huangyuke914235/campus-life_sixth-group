# 部署手册

## 1. 环境要求

Ubuntu 22.04/24.04 LTS · Docker 24+ · Docker Compose v2 · 2C4G 起步 · 域名 + TLS 证书。

## 2. 首次部署

```bash
git clone <repo> && cd shiguang
cp .env.example .env
```

**必须修改**：`POSTGRES_PASSWORD`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`S3_SECRET_KEY`、`DEMO_PASSWORD`；生产再设 `ENABLE_DEMO_ACCOUNTS=false`、`SEED_DEMO_DATA=false`、`COOKIE_SECURE=true`、`COOKIE_SAMESITE=strict`。
密钥生成：`openssl rand -base64 48`。

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec api pnpm exec prisma migrate deploy   # 若 entrypoint 未自动执行
docker compose logs -f api                                 # 看启动日志
```

## 3. HTTPS 与域名

1. 把 `fullchain.pem` / `privkey.pem` 放进 `infra/certs/`（Let's Encrypt 或学校证书）。
2. `docker-compose.prod.yml` 已挂载 `infra/nginx-ssl.conf` 并暴露 443。
3. 若用 certbot：先注释 443 server 启动 80，签发后放回证书再 `docker compose restart proxy`。
4. 学校域名需先在 DNS 添加 A 记录指向服务器公网 IP。

## 4. 端口与网络

只有 `proxy` 暴露 80/443。PostgreSQL、Redis、MinIO、API、Web 均只在 Compose 内部网络，不映射公网端口。排查时可临时把某个服务绑定到 `127.0.0.1`（不要绑 `0.0.0.0`）。

## 5. 数据持久化

| 卷 | 内容 |
|---|---|
| `pgdata` | PostgreSQL 数据 |
| `redisdata` | Redis AOF |
| `miniodata` | 对象存储 |
| `uploads` | 本地存储模式下上传的图片 |

## 6. 健康检查与日志

- API：`GET /api/v1/health`；容器 `HEALTHCHECK` 已配置。
- Web：`GET /`；Compose 内 `wget` 探活。
- 日志：`docker compose logs -f api|web|proxy`；API 为 JSON 结构化日志，敏感字段已脱敏，按 `requestId` 串联。

## 7. 备份与恢复

```bash
./scripts/backup.sh                      # 生成 backups/shiguang_<时间>.sql.gz
./scripts/restore.sh backups/xxx.sql.gz  # 危险：会覆盖当前库，先备份
```

建议 cron 每日 03:00 备份并异地留存 7 天；同时归档 `uploads/` 与 `miniodata` 卷。每季度做一次恢复演练。

## 8. 更新部署

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec api pnpm exec prisma migrate deploy
```

回滚：切回上一个 tag 重新 build；数据库回滚用备份恢复（迁移不自动回退）。

## 9. 常见故障

| 现象 | 排查 |
|---|---|
| 502 Bad Gateway | `docker compose logs api`，确认 API 已监听 3001 且迁移成功 |
| 登录后立即掉线 | `COOKIE_SECURE=true` 但用 http 访问；或 `COOKIE_DOMAIN` 与域名不一致 |
| 推荐为空 | 当日菜单未发布 / 库存为 0 / 用户过敏原过滤掉全部候选（响应含 `rejected` 原因） |
| 下单报库存冲突 | 并发或库存已被扣完；检查 `Inventory.remaining` 与 `version` |
| 取餐码核销失败 | 订单未到 `READY`、凭证过期、档口不匹配（错误码 10014） |
| 种子数据导入失败 | 确认 `DATABASE_URL` 可连；seed 会清空演示表，勿在生产执行 |

## 10. 上线前的硬性检查

- [ ] 全部密钥已替换，`.env` 未提交进仓库
- [ ] `ENABLE_DEMO_ACCOUNTS=false`、`SEED_DEMO_DATA=false`
- [ ] `prisma migrate deploy` 成功，`/api/v1/health` 返回 ok
- [ ] HTTPS 生效，HSTS 头存在
- [ ] 备份 cron 已配置且验证过一次恢复
- [ ] 依赖安全扫描无 high 级漏洞
- [ ] 关键 E2E 流程通过
