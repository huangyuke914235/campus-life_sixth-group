# Cloudflare Tunnel 部署

使用 Tunnel 时，PostgreSQL、Redis、API、Web 与 Nginx 均运行在 Compose 内部网络。Cloudflare 提供对外 HTTPS 入口。

## 准备

1. 在部署主机安装 Docker 与 Compose，获取已通过验收的发布包及其 SHA-256 校验文件。
2. 在 Cloudflare 创建远程管理的 Tunnel，将站点域名的服务地址设为 `http://proxy:80`。
3. 在发布目录复制 `.env.production.example` 为 `.env`，按[部署手册](docs/DEPLOYMENT.md)设置数据库密码、JWT 密钥、HTTPS 的 `WEB_ORIGIN` 和 `CLOUDFLARE_TUNNEL_TOKEN`。

Cloudflared 通过容器环境的 `TUNNEL_TOKEN` 读取凭据。 [Cloudflare Tunnel 运行参数](https://developers.cloudflare.com/tunnel/reference/run-parameters/)

## 启动

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.cloudflare.yml
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

使用已授权的真实账号通过浏览器验证登录和取餐链路。通过站点域名检查 `/api/v1/health/ready`，通过 Compose 日志核对迁移与代理状态。生产关闭演示账号，部署过程只运行迁移。

## 运维

- 备份、恢复演练和版本回退见[部署手册](docs/DEPLOYMENT.md)。
- 采用 Azure 部署脚本时，使用 `DEPLOY_ENTRYPOINT=tunnel`，并在部署主机准备 `DEPLOY_ENV_FILE`。 [Azure 部署手册](azure/README-azure.md)
- 直接使用源站证书时，选择 `docker-compose.tls.yml` 入口。 [TLS 配置](docs/DEPLOYMENT.md#3-https-与域名)
