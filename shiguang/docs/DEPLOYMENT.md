# 部署手册

## 1. 环境要求

Ubuntu 22.04/24.04 LTS · Docker 24+ · Docker Compose v2 · 2C4G 起步 · 域名 + TLS 证书。

## 2. 首次部署

```bash
git clone <repo>
cd <repo>/shiguang
cp .env.production.example .env
```

使用 `openssl rand -hex 32` 生成数据库密码，分别用 `openssl rand -base64 48` 生成两个不同的 JWT 密钥。设置 `WEB_ORIGIN` 为站点 HTTPS 地址，生产使用 `COOKIE_SECURE=true`、`CSRF_ENABLED=true`、`ENABLE_DEMO_ACCOUNTS=false` 和 `SEED_DEMO_DATA=false`。将 `.env` 保存在部署主机并限制读取权限。

选择 TLS 或 [Cloudflare Tunnel](../DEPLOY-CLOUDFLARE.md) 入口。以下命令以直接 TLS 部署为例。

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.tls.yml
docker compose config --quiet
docker compose up -d --build --wait
docker compose logs --tail 50 api
```

## 3. HTTPS 与域名

1. 把 `fullchain.pem` / `privkey.pem` 放进 `infra/certs/`（Let's Encrypt 或学校证书）。
2. `docker-compose.tls.yml` 挂载 `infra/nginx-ssl.conf`、暴露 443，并将 HTTP 重定向到 HTTPS。
3. 使用 DNS 验证、独立证书签发服务或校方证书。直接 TLS 部署前完成域名解析和证书准备。

## 4. 端口与网络

直接 TLS 入口只发布代理的 80/443。Tunnel 通过内部网络转发，Compose 不发布宿主机端口。开发调试使用 `docker-compose.dev.yml` 提供的回环端口。

## 5. 数据持久化

| 卷 | 内容 |
|---|---|
| `pgdata` | PostgreSQL 数据 |
| `redisdata` | Redis AOF |
| `miniodata` | 对象存储 |
| `uploads` | 本地存储模式下上传的图片 |

## 6. 健康检查与日志

- API 存活使用 `GET /api/v1/health`，依赖就绪使用 `GET /api/v1/health/ready`。容器健康检查访问就绪接口。
- Web：`GET /`；Compose 内 `wget` 探活。
- 日志：`docker compose logs -f api|web|proxy`；API 为 JSON 结构化日志，敏感字段已脱敏，按 `requestId` 串联。

## 7. 备份与恢复

```bash
bash scripts/backup.sh
# 在隔离 Compose 项目的 PostgreSQL 中先创建一个新的空库
bash scripts/restore.sh backups/xxx.sql.gz shiguang_restore_test
```

备份脚本在转储与压缩校验均成功后生成最终文件。恢复在单个事务内执行，目标为空库且与当前应用库不同。另行归档 `uploads` 数据卷，在隔离卷演练恢复后核对菜品图片和订单。定时备份任务使用与服务一致的 Compose 配置。

## 8. 更新部署

```bash
# 在仓库的 shiguang 目录从已验收的 Git 提交打包
bash scripts/package.sh backups/releases/campus-life-release.tar.gz
```

在预发布环境解包并核对 SHA-256，使用同一 Compose 项目名保留数据卷。API 启动前校验生产配置再执行迁移。回退优先选用与当前迁移兼容的上一应用版本。出现数据问题时按备份恢复演练核对空库和上传卷，再由负责人批准实际切换。

## 9. 常见故障

| 现象 | 排查 |
|---|---|
| 502 Bad Gateway | `docker compose logs api`，确认 API 已监听 3001 且迁移成功 |
| 登录后立即掉线 | `COOKIE_SECURE=true` 但用 http 访问；或 `COOKIE_DOMAIN` 与域名不一致 |
| 推荐为空 | 当日菜单未发布 / 库存为 0 / 用户过敏原过滤掉全部候选（响应含 `rejected` 原因） |
| 下单报库存冲突 | 并发或库存已被扣完；检查 `Inventory.remaining` 与 `version` |
| 取餐码核销失败 | 订单未到 `READY`、凭证过期、档口不匹配（错误码 10014） |
| 演示初始化失败 | 在隔离开发库检查 `DATABASE_URL`、`DEMO_DATABASE_NAME`、`DEMO_PASSWORD` 与迁移状态 |

在专用演示站恢复已有账号时，将服务使用的环境文件设置为
`ENABLE_DEMO_ACCOUNTS=true`、`ALLOW_DEMO_ACCOUNTS=true`，并保持
`SEED_DEMO_DATA=false`。使用对应站点的 Compose 配置更新 API 后，
通过 `/api/v1/auth/demo-accounts` 检查展示，再用已授权的体验账号验证登录。
开关只控制可用性，已有账号、密码散列和关联记录保留。若开启后列表为空，
先核对该实例连接的数据库以及目标账号的状态。首次填充演示数据应使用专用隔离库。

## 10. 上线前的硬性检查

- [ ] 全部密钥已替换，`.env` 未提交进仓库
- [ ] `ENABLE_DEMO_ACCOUNTS=false`、`SEED_DEMO_DATA=false`
- [ ] 迁移成功，`/api/v1/health/ready` 返回成功
- [ ] HTTPS 生效，HSTS 头存在
- [ ] 备份 cron 已配置且验证过一次恢复
- [ ] 依赖安全扫描无 high 级漏洞
- [ ] 关键 E2E 流程通过
