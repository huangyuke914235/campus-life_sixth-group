# Azure 部署手册（campus-life.ccwu.cc）

> 说明：Azure 资源创建必须用你自己的账号操作（我无法代持凭证）。下面的脚本把「点几十次门户」压缩成「跑 2 条命令」，其余步骤我逐条写清楚。

---

## 一、成本：$100 能撑多久

Azure for Students 的免费额度里，**计算几乎不花钱**：

| 项目 | 规格 | 计费 |
|---|---|---|
| 计算 | **Standard_B2ats_v2**（2 vCPU / 8GB，AMD x86_64） | **750 小时/月免费**（12 个月），单台常开 744h，基本为 0 |
| 系统盘 | 64 GiB StandardSSD | 约 **$4.8/月**（走额度） |
| 公网 IP | Standard 静态 | 约 **$3.7/月**（走额度） |
| 出站流量 | 前 15 GB/月 | 免费，超出约 $0.087/GB |

**合计约 $8–9/月**，$100 额度可跑 **11 个月左右**。

- 不要选 B1s（1GB 内存）——这套栈需要约 2GB，会 OOM。
- 不要选 B2pts_v2（ARM64）——虽然也免费，但镜像要按 arm64 重建，容易踩坑。
- 系统盘不要超过 64GB，Azure 默认给 127GB 会直接吃掉额度。

**省钱操作**：长期不用时关机并释放
```bash
az vm deallocate -g shiguang-rg -n shiguang-vm   # 只停计算计费，磁盘/IP 仍保留
az vm start -g shiguang-rg -n shiguang-vm
```

---

## 二、创建 VM（5 分钟）

### 方式 A：Cloud Shell（推荐）

1. 打开 <https://shell.azure.com>，选 **Bash**
2. 新建文件并粘贴：`code create-vm.sh` → 粘贴内容 → 保存（Ctrl+S）
   > 也可以用 Cloud Shell 工具栏的「上传」把 `create-vm.sh` 传上去。
   > 若脚本是从 Windows 拷过去的，先执行 `sed -i 's/\r$//' create-vm.sh`
3. 执行：
```bash
chmod +x create-vm.sh
./create-vm.sh
```
4. 脚本结束会打印 **公网 IP**，记下来。

### 方式 B：门户点选（想可视化就用这个）

看到与脚本一致的这些值即可：

| 字段 | 值 |
|---|---|
| 资源组 | 新建 `shiguang-rg` |
| 区域 | East Asia（或 Japan East / Southeast Asia） |
| 映像 | Ubuntu Server 22.04 LTS - x64 Gen2 |
| 大小 | **Standard_B2ats_v2** |
| 身份验证 | SSH 公钥（保存好私钥） |
| 入站端口 | 22、80、443 |
| OS 磁盘 | **64 GiB StandardSSD** |
| 公共 IP | Standard，静态 |

---

## 三、上传代码并部署

在本机的 `shiguang` 目录，从已验收提交打包并上传。

```bash
bash scripts/package.sh backups/releases/campus-life-release.tar.gz
scp backups/releases/campus-life-release.tar.gz{,.sha256} azureuser@<公网IP>:/opt/shiguang/
scp azure/deploy-app.sh azureuser@<公网IP>:/opt/shiguang/
```

在 VM 按[部署手册](../docs/DEPLOYMENT.md)准备生产配置，权限设为 600。首次部署指定配置文件位置和证书目录，升级默认沿用当前发布目录的配置与证书。

```bash
ssh azureuser@<公网IP> 'DEPLOY_ENV_FILE=/opt/shiguang/production.env DEPLOY_CERT_DIR=/opt/shiguang/certs bash /opt/shiguang/deploy-app.sh'
```

脚本校验制品和配置后构建镜像，保留上一版本目录，使用同一 Compose 项目名启动新版本并等待健康检查。生产启动只运行迁移。Tunnel 部署使用 `DEPLOY_ENTRYPOINT=tunnel`。 [Tunnel 部署](../DEPLOY-CLOUDFLARE.md)

---

## 四、接域名（Cloudflare）

域名 `campus-life.ccwu.cc` 走 Cloudflare，源站在 Azure。

### 1. 生成源站证书（15 年有效，不用续期）

Cloudflare 面板 → **SSL/TLS** → **Origin Server** → **Create Certificate**
- 私钥类型：RSA 2048
- 主机名：`campus-life.ccwu.cc`（可再加 `*.ccwu.cc`）
- 有效期：15 年

复制 **Origin Certificate** 和 **Private Key**，在本机存成两个文件：
`fullchain.pem`、`privkey.pem`

### 2. 传到服务器并重跑部署

```bash
ssh azureuser@<公网IP> 'mkdir -p -m 700 /opt/shiguang/certs'
scp fullchain.pem privkey.pem azureuser@<公网IP>:/opt/shiguang/certs/
ssh azureuser@<公网IP> 'DEPLOY_CERT_DIR=/opt/shiguang/certs bash /opt/shiguang/deploy-app.sh'
```

直接 TLS 部署使用 `docker-compose.prod.yml` 和 `docker-compose.tls.yml`。

### 3. DNS 与 SSL 模式

Cloudflare → **DNS** → 添加记录：

| 类型 | 名称 | 内容 | 代理状态 |
|---|---|---|---|
| A | `campus-life` | `<公网IP>` | **已代理（橙色云）** |

Cloudflare → **SSL/TLS** → 概览 → 模式选 **Full (strict)**
> 别选 Flexible：源站是 HTTP，会出现混合内容与 Cookie 丢失（表现为登录后又跳回登录页）。

### 4. 开缓存规则（可选）

Cloudflare → **Caching** → **Cache Rules**：
- 匹配 `campus-life.ccwu.cc/uploads/*` → 缓存 7 天（和 nginx 的 `expires 7d` 一致）
- 其他路径走默认（HTML 不缓存）

---

## 五、验证清单

```bash
# 1. 域名解析（应返回 Azure 的 IP）
nslookup campus-life.ccwu.cc

# 2. 证书与协议
curl -sI https://campus-life.ccwu.cc | head -5
curl -fsS https://campus-life.ccwu.cc/api/v1/health/ready
```

使用已授权账号检查浏览器登录、菜单、预约、商户核销和评价。

---

## 六、排错

| 现象 | 原因 / 处理 |
|---|---|
| 502 Bad Gateway | `docker compose ps` 看 api 是否 healthy；`docker compose logs api --tail 50` |
| 域名打不开但 IP 能开 | DNS 未生效或防火墙没开 80/443：`az vm open-port -g shiguang-rg -n shiguang-vm --port 80` |
| 登录成功又跳回登录页 | `COOKIE_SECURE=true` 却用 http 访问，或 Cloudflare 模式是 Flexible；改成 Full (strict) 并走 https |
| 上传图片 404 | 确认 nginx 有 `/uploads/` 反代（本包已含），改完 `docker compose restart proxy` |
| 容器反复重启 | `docker compose logs api`；多为内存不足——检查是否误选了 B1s |
| 构建失败 `no space left` | 检查磁盘、镜像与构建缓存占用，保留当前与回退版本所需的制品 |
| 额度消耗快 | 确认 VM 规格是 B2ats_v2；磁盘 64G；不需要时 `az vm deallocate` |

---

## 七、日常运维

```bash
cd /opt/shiguang/pkg-shiguang
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.tls.yml

docker compose ps                    # 状态
docker compose logs -f api           # 日志
docker compose restart api           # 重启单个服务
docker compose down                  # 停止（保留数据卷）
docker compose up -d                 # 启动

# 备份数据库
bash scripts/backup.sh
# 在隔离项目准备独立空库后演练恢复
bash scripts/restore.sh backups/xxx.sql.gz shiguang_restore_test
```

定时备份任务使用与部署一致的 `COMPOSE_FILE` 和项目名，并单独保存上传卷。 [备份与回退](../docs/DEPLOYMENT.md#7-备份与恢复)

---

## 八、正式对外前

1. 确认 `.env` 设置 `ENABLE_DEMO_ACCOUNTS=false`、`SEED_DEMO_DATA=false`。
2. 在有权限的运维流程中停用遗留演示账号并撤销其会话。
3. `/admin` 套 Cloudflare Access（Zero Trust → Access → Applications），只放行你的邮箱
4. 定期 `docker compose pull && docker compose up -d --build` 更新基础镜像
