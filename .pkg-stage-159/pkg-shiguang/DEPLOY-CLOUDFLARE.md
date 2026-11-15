# 部署到 campus-life.ccwu.cc（Cloudflare）

本文只讲一件事：**怎么把这个包跑起来，并让 `https://campus-life.ccwu.cc` 能访问。**

---

## 0. 先明确一件事：Cloudflare 有两条路能走

| 方案 | 适用 | 是否需要公网 IP | 是否需要开放 80/443 | HTTPS | 推荐度 |
|---|---|---|---|---|---|
| **A. Cloudflare Tunnel** | 校园网/内网服务器、家用宽带、没有公网 IP | 不需要 | 不需要 | Cloudflare 自动签发 | ⭐ 推荐 |
| **B. VPS + Cloudflare 橙云代理** | 有公网 IP 的云主机 | 需要 | 需要 | Cloudflare 边缘证书 | 可用 |
| C. Pages + Workers | 纯静态 / 边缘函数 | — | — | 自动 | ❌ 不适用 |

**为什么不是 C**：本项目后端是 NestJS + PostgreSQL + Prisma + Argon2（原生模块）+ BullMQ（Redis）。Cloudflare Pages / Workers 是边缘运行时，跑不了这些 Node 原生依赖和常驻进程，改用 D1/Hyperdrive 等于重写后端。所以前端页面可以放 Pages，但**后端必须跑在容器里**——既然如此，直接用 A 或 B 最省事。

---

## 1. 服务器准备

- 一台能跑 Docker 的机器（Linux 2C4G 起；Windows 装 Docker Desktop 也行）
- 装好 Docker 24+ 与 Compose v2
- 解压本项目包，进入目录

```bash
docker --version && docker compose version
unzip campus-life-deploy.zip -d /opt/shiguang && cd /opt/shiguang
```

> 国内服务器拉不到 Docker Hub 时，先给基础镜像打 tag：
> ```bash
> docker pull docker.m.daocloud.io/library/node:22-alpine
> docker tag  docker.m.daocloud.io/library/node:22-alpine node:22-alpine
> docker pull docker.m.daocloud.io/library/nginx:1.27-alpine
> docker tag  docker.m.daocloud.io/library/nginx:1.27-alpine nginx:1.27-alpine
> docker pull docker.m.daocloud.io/library/postgres:16-alpine
> docker tag  docker.m.daocloud.io/library/postgres:16-alpine postgres:16-alpine
> docker pull docker.m.daocloud.io/library/redis:7-alpine
> docker tag  docker.m.daocloud.io/library/redis:7-alpine redis:7-alpine
> docker pull docker.m.daocloud.io/minio/minio:RELEASE.2024-11-07T00-52-20Z
> docker tag  docker.m.daocloud.io/minio/minio:RELEASE.2024-11-07T00-52-20Z minio/minio:RELEASE.2024-11-07T00-52-20Z
> ```

---

## 2. 配置 `.env`

```bash
cp .env.production.example .env
```

必须替换的项（其余保持默认即可）：

| 变量 | 说明 |
|---|---|
| `POSTGRES_PASSWORD` | 数据库密码，同时要改 `DATABASE_URL` 里的同名部分 |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `openssl rand -base64 48` 各生成一个 |
| `DEMO_PASSWORD` | 演示账号密码；正式环境建议直接 `ENABLE_DEMO_ACCOUNTS=false` |
| `COOKIE_DOMAIN` | `campus-life.ccwu.cc` |
| `CLOUDFLARE_TUNNEL_TOKEN` | 方案 A 才需要 |

`NEXT_PUBLIC_API_BASE_URL` 保持 `/api/v1`（相对路径）——换域名、加 CDN 都不用改，前后端同域最稳。

---

## 3. 方案 A：Cloudflare Tunnel（推荐）

### 3.1 在 Cloudflare 建隧道

1. 登录 Cloudflare → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
2. 选 **Cloudflared**，命名如 `shiguang`
3. 复制 **token**（`eyJ...` 那一长串），填进 `.env` 的 `CLOUDFLARE_TUNNEL_TOKEN`
4. 在该隧道的 **Public Hostname** 里添加：
   - Subdomain: `campus-life`
   - Domain: `ccwu.cc`
   - Service: **HTTP** → `proxy:80`
   - 保存

> `proxy:80` 是 Compose 内部服务名，cloudflared 与它在同一网络里，能直接解析。

### 3.2 启动

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build
```

### 3.3 首次初始化数据库

```bash
# 迁移已在容器 entrypoint 自动执行；如需手动：
docker compose exec api pnpm exec prisma migrate deploy

# 首次想要演示数据（56 道菜 / 108 条评价）：
docker compose exec api pnpm exec tsx prisma/seed.ts
```

### 3.4 访问

浏览器打开 **https://campus-life.ccwu.cc** —— Cloudflare 已自动签发证书。
Swagger 文档：`https://campus-life.ccwu.cc/docs`

---

## 4. 方案 B：VPS + 橙云代理

1. DNS 添加 A 记录：`campus-life` → 服务器公网 IP，**开启代理（橙色云）**
2. Cloudflare → SSL/TLS → 模式选 **Full (strict)**，并安装源站证书：
   ```bash
   # 用 Cloudflare Origin CA 证书，或 Let's Encrypt
   mkdir -p infra/certs
   cp your-fullchain.pem infra/certs/fullchain.pem
   cp your-privkey.pem   infra/certs/privkey.pem
   ```
3. 启动（生产 overlay + 443）：
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
4. 服务器安全组只开放 80/443 给 Cloudflare IP 段（可选但推荐）

> 若选 **Flexible** 模式（源站 http），必须把 `COOKIE_SECURE` 设为 `false`，否则 Cookie 不下发。**不建议**，优先 Full。

---

## 5. 验证清单（部署完照着跑）

```bash
# 1) 容器全部 Up、api/web healthy
docker compose ps

# 2) 健康检查
curl -s https://campus-life.ccwu.cc/api/v1/health

# 3) 首页 200
curl -s -o /dev/null -w "%{http_code}\n" https://campus-life.ccwu.cc/

# 4) 登录（用 seed 出来的演示账号）
curl -s -c /tmp/c.txt -X POST https://campus-life.ccwu.cc/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student.a@demo.shiguang.local","password":"你的DEMO_PASSWORD"}'

# 5) 带 Cookie 拉推荐（应返回 items 而不是 401）
curl -s -b /tmp/c.txt https://campus-life.ccwu.cc/api/v1/recommendations/today | head -c 300

# 6) 图片静态访问（上传一张后测）
curl -s -o /dev/null -w "%{http_code}\n" https://campus-life.ccwu.cc/uploads/<文件名>.png
```

页面自检顺序：登录 → 首页 → 一键搭配 → 推荐 → 菜品详情「查看全部评价」→ 写评价 → 订单 → 后台。

---

## 6. 备份与恢复

```bash
./scripts/backup.sh                    # 生成 backups/shiguang_<时间>.sql.gz
./scripts/restore.sh backups/xxx.sql.gz # 危险：会覆盖当前库
```

建议加 cron：`0 3 * * * cd /opt/shiguang && ./scripts/backup.sh`，并异地留存 7 天。
同时备份 `uploads` 卷（菜品图片）：`docker run --rm -v shiguang_uploads:/data -v $PWD/backups:/backup alpine tar czf /backup/uploads.tgz -C /data .`

---

## 7. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 502 Bad Gateway | api 没起来：`docker compose logs api`，多为数据库未就绪或迁移失败 |
| 登录成功但立刻 401 | `COOKIE_SECURE=true` 却用 http 访问；或 `COOKIE_DOMAIN` 与访问域名不一致 |
| 页面能开但接口全 403 | CSRF：前端没拿到 `csrf_token`（清 Cookie 重新登录） |
| 图片 404 | nginx 需有 `location /uploads/`（本包已配置），确认 `proxy` 容器重启过 |
| 上传 400「文件内容不是有效图片」 | 服务端做了文件头校验，伪装扩展名会被拒 |
| 上传 413 | Cloudflare 免费版请求体上限 100MB；本项目限制 5MB，一般不会触发 |
| 容器反复重启、日志刷 pnpm 下载 | 旧镜像问题；本包已改为镜像内全局安装 pnpm，重新 `build` 即可 |
| 想关掉演示账号 | `.env` 设 `ENABLE_DEMO_ACCOUNTS=false` 后 `docker compose up -d api` |

---

## 8. 安全建议

1. **换掉全部密钥**，`.env` 不进 Git（本包已 `.gitignore`）。
2. 正式对外前 `ENABLE_DEMO_ACCOUNTS=false`、`SEED_DEMO_DATA=false`。
3. 后台 `/admin` 建议套 Cloudflare Access（Zero Trust → Access → Applications），只允许指定邮箱登录。
4. 数据库/Redis 端口不要映射到公网（本包默认只绑 `127.0.0.1` 或仅内部网络）。
5. 定期 `docker compose pull` 更新基础镜像，关注依赖安全公告。

---

## 9. 一句话流程

```bash
unzip campus-life-deploy.zip -d /opt/shiguang && cd /opt/shiguang
cp .env.production.example .env   # 改密码与密钥，填隧道 token
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build
docker compose exec api pnpm exec tsx prisma/seed.ts   # 首次要演示数据才跑
```
然后浏览器打开 `https://campus-life.ccwu.cc`。
