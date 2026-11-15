# 完整重建指南

> **什么时候用**：服务器删了/挂了，想从 GitHub 代码 + 数据备份，重新拉起一个能用的站点。
> **不包含**：从零开发。开发见 `LEARNING-GUIDE.md`，决策见 `ADR.md`。

---

## 零、前提检查

| 需要 | 怎么确认 | 没有怎么办 |
|---|---|---|
| Azure 账号有额度 | `az account show` | 学生认证给 $100 |
| GitHub 仓库可访问 | `git ls-remote git@github.com:huangyuke914235/campus-life_sixth-group.git` | 配 SSH key |
| **有一份数据备份** | 本地有 `shiguang-backup.sql.gz` | **没有就无法恢复数据**，只能重建空库 |
| SSH 密钥 | `ls ~/.ssh/id_rsa.pub` | `ssh-keygen -t rsa -b 2048 -f ~/.ssh/id_rsa -N ''` |

**耗时估算**：建 VM 5 分钟 + 装环境 10 分钟 + 构建 6 分钟 + 恢复数据 2 分钟 ≈ **25 分钟**。

---

## 一、创建 VM

```bash
az group create --name shiguang-rg --location southeastasia
```

```bash
az vm create \
  --resource-group shiguang-rg \
  --name shiguang-vm \
  --image Ubuntu2204 \
  --size Standard_B2als_v2 \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-sku Standard \
  --storage-sku StandardSSD_LRS
```

**注意**：
- `Standard_B2als_v2` 约 $0.038/小时（2 vCPU / 4GB，够用）
- `--generate-ssh-keys` 会把公钥写到 `~/.ssh/id_rsa.pub`（如果已存在则复用）
- **记下输出里的 `publicIpAddress`**

**开端口**：
```bash
az vm open-port --resource-group shiguang-rg --name shiguang-vm --port 80 --priority 1010
az vm open-port --resource-group shiguang-rg --name shiguang-vm --port 443 --priority 1020
```
（22 端口默认已开）

**验证**：
```bash
ssh -o StrictHostKeyChecking=no azureuser@<IP> 'echo OK && lsb_release -d'
```

---

## 二、装 Docker

```bash
ssh azureuser@<IP> 'curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER'
```

**重新登录让组权限生效**：
```bash
ssh azureuser@<IP> 'docker --version && docker compose version'
```

**国内加速镜像**（拉不到镜像时必配）：
```bash
ssh azureuser@<IP> 'sudo mkdir -p /etc/docker && echo "{\"registry-mirrors\":[\"https://docker.m.daocloud.io\"]}" | sudo tee /etc/docker/daemon.json && sudo systemctl restart docker'
```

---

## 三、拉代码

```bash
ssh azureuser@<IP> 'sudo mkdir -p /opt/shiguang && sudo chown azureuser:azureuser /opt/shiguang'
```

```bash
ssh azureuser@<IP> 'cd /opt/shiguang && git clone https://github.com/huangyuke914235/campus-life_sixth-group.git src && ls src/shiguang | head -6'
```

**注意**：用 HTTPS clone（服务器上没有 GitHub SSH key）。如果 HTTPS 慢，改用：
```bash
git clone https://ghproxy.net/https://github.com/huangyuke914235/campus-life_sixth-group.git src
```

**目录约定**：
```
/opt/shiguang/src/shiguang/     ← 代码
/opt/shiguang/pkg-shiguang/     ← 部署目录（后面 cp 过来）
```

---

## 四、准备部署目录与配置

```bash
ssh azureuser@<IP> 'cd /opt/shiguang && rsync -a --exclude=node_modules --exclude=dist --exclude=.next --exclude=.git src/shiguang/ pkg-shiguang/ && ls pkg-shiguang | head -8'
```

**生成 `.env`**（这是最容易出错的一步）：

```bash
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && cp .env.production.example .env'
```

然后**逐项确认**这几个关键值：

| 变量 | 值 | 说明 |
|---|---|---|
| `NODE_ENV` | `production` | |
| `POSTGRES_PASSWORD` | 自己生成强密码 | **不能是 `shiguang_dev` 或 `CHANGE_ME*`**，否则启动校验拒绝 |
| `JWT_ACCESS_SECRET` | ≥32 位随机 | 不能含 `change`/`replace`/`demo`/`example` |
| `JWT_REFRESH_SECRET` | ≥32 位随机，**与上面不同** | |
| `COOKIE_SECURE` | **用 IP 访问填 `false`**；有 HTTPS 域名填 `true` | |
| `COOKIE_DOMAIN` | **留空/删除这一行** | 写死域名会导致 IP 访问登录失败 |
| `CSRF_ENABLED` | `true` | |
| `SEED_DEMO_DATA` | **`false`** | 设 true 会在启动时清库 |
| `ENABLE_DEMO_ACCOUNTS` | `true`（演示需要体验账号） | |
| `ALLOW_INSECURE_HTTP` | `true`（仅 IP 访问时） | 豁免 Secure Cookie 校验 |
| `ALLOW_DEMO_ACCOUNTS` | `true` | 豁免体验账号校验 |
| `DEMO_PASSWORD` | 自己定，如 `9e045191a306` | 8 个体验账号共用 |

**一条命令生成强随机值**：
```bash
ssh azureuser@<IP> 'echo "PG: $(openssl rand -hex 16)"; echo "JWT_A: $(openssl rand -hex 24)"; echo "JWT_R: $(openssl rand -hex 24)"'
```

---

## 五、构建并启动

```bash
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && docker compose -f docker-compose.yml -f docker-compose.prod.yml build api web 2>&1 | tail -5'
```
耗时 4–6 分钟。

```bash
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d && sleep 20 && docker compose ps --format "{{.Name}} {{.Status}}"'
```

**期望**：5 个容器全部 `Up (healthy)`。

**如果 api 是 `Restarting`**：
```bash
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && docker compose logs api --tail 30'
```
日志里有 `Unsafe production configuration: xxx` → 缺 `ALLOW_*` 变量或 JWT 密钥太短。

---

## 六、初始化数据库

**情况 A：有备份**（推荐）

> **仓库里已有一份现成的**：`data/demo-data-20261115.sql.gz`（339K，clone 后直接可用）。
> 如果想用自己最新导出的备份，按下面步骤替换。



```bash
# 把备份传上去
cat ~/shiguang-backup.sql.gz | ssh azureuser@<IP> 'cat > /opt/shiguang/pkg-shiguang/restore.sql.gz'

# 恢复到数据库
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && gunzip -c restore.sql.gz | docker compose exec -T postgres psql -U shiguang -d shiguang -v ON_ERROR_STOP=1 -q && echo "恢复完成"'
```

> **注意 `docker compose exec` 必须带 `-T`**（等价于 `docker exec -i`），否则管道内容进不去，psql 空跑返回 0。

**验证**：
```bash
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -F"|" -c "SELECT (SELECT COUNT(*) FROM \"Dish\") dishes, (SELECT COUNT(*) FROM \"Review\") reviews, (SELECT COUNT(*) FROM \"UserPreference\") prefs;"'
```
**期望**：`59|120|6`（或备份时的实际数量）

**情况 B：没有备份**（只需空库跑起来）

```bash
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && docker compose exec -T api pnpm exec tsx prisma/seed.ts'
```
⚠️ **这会清库重建演示数据**。只在全新空库上跑。

---

## 七、修复菜单日期（必做）

**这是最容易漏的一步**：`seed` 只在执行当天生成菜单，隔天推荐就是 0 道。

```bash
cat <<'SQL' | ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && docker compose exec -T postgres psql -U shiguang -d shiguang -v ON_ERROR_STOP=1 -q'
SET client_min_messages TO NOTICE;
DO $$
DECLARE src date; tgt date := CURRENT_DATE; i int;
BEGIN
  SELECT MAX(date) INTO src FROM "Menu" WHERE status = 'PUBLISHED' AND date < tgt;
  IF src IS NULL THEN SELECT MAX(date) INTO src FROM "Menu" WHERE status = 'PUBLISHED'; END IF;
  IF src IS NULL THEN RAISE NOTICE '没有菜单，先跑 seed'; RETURN; END IF;
  RAISE NOTICE '源菜单 % → 覆盖 30 天', src;
  FOR i IN 0..30 LOOP
    tgt := CURRENT_DATE + i;
    CONTINUE WHEN tgt = src;
    INSERT INTO "Menu" (id, "stallId", date, "mealType", status, "publishedAt", "createdAt", "updatedAt")
    SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || m.id), 1, 24), m."stallId", tgt, m."mealType", 'PUBLISHED', now(), now(), now()
    FROM "Menu" m WHERE m.date = src AND m.status = 'PUBLISHED'
    ON CONFLICT ("stallId", date, "mealType") DO NOTHING;
    INSERT INTO "MenuItem" (id, "menuId", "dishId", "isAvailable", "sortOrder")
    SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || mi.id), 1, 24), nm.id, mi."dishId", mi."isAvailable", mi."sortOrder"
    FROM "MenuItem" mi
    JOIN "Menu" om ON om.id = mi."menuId" AND om.date = src
    JOIN "Menu" nm ON nm."stallId" = om."stallId" AND nm.date = tgt AND nm."mealType" = om."mealType";
    INSERT INTO "Inventory" (id, "dishId", date, "mealType", total, remaining, version, "updatedAt")
    SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || iv.id), 1, 24), iv."dishId", tgt, iv."mealType", iv.total, iv.total, 0, now()
    FROM "Inventory" iv WHERE iv.date = src
    ON CONFLICT ("dishId", date, "mealType") DO NOTHING;
    INSERT INTO "PickupSlot" (id, "stallId", date, "mealType", "startTime", "endTime", capacity, booked, "cutoffMinutes", "isClosed", "updatedAt")
    SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || s.id), 1, 24), s."stallId", tgt, s."mealType", s."startTime", s."endTime", s.capacity, 0, s."cutoffMinutes", false, now()
    FROM "PickupSlot" s WHERE s.date = src
    ON CONFLICT ("stallId", date, "mealType", "startTime") DO NOTHING;
  END LOOP;
  RAISE NOTICE '完成';
END $$;
SQL
```

**验证**：
```bash
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -c "SELECT CURRENT_DATE, count(*) FROM \"Menu\" WHERE date = CURRENT_DATE;"'
```
**期望**：`2026-11-15|39`

> **时区提醒**：DB 会话已是 `Asia/Shanghai`，`CURRENT_DATE` 就是北京今天。**不要再加 `interval '8 hours'`**，会跨到明天。

---

## 八、验证站点

```bash
ssh azureuser@<IP> 'curl -s http://127.0.0.1/api/v1/health | head -c 60; echo; curl -s -o /dev/null -w "首页 %{http_code}\n" http://127.0.0.1/'
```

**期望**：
```
{"code":0,"message":"ok","data":{"status":"ok",...}}
首页 200
```

**登录验证**（关键：确认 Cookie 没毛病）：
```bash
ssh azureuser@<IP> 'curl -s -i -X POST http://127.0.0.1/api/v1/auth/login -H "Content-Type: application/json" -d "{\"email\":\"student.a@demo.shiguang.local\",\"password\":\"<你的DEMO_PASSWORD>\"}" | grep -i set-cookie'
```

**必须满足**：`Set-Cookie` 里**既没有 `Secure` 也没有 `Domain=`**。

浏览器打开 `http://<IP>` 登录，能进首页就成功了。

---

## 九、可选：配 HTTPS 域名

**前提**：有域名 + 能改 DNS。

**① 申请证书**（Cloudflare Origin Certificate 或 Let's Encrypt）
```bash
# Let's Encrypt（需要域名已解析到 IP）
ssh azureuser@<IP> 'sudo apt install -y certbot && sudo certbot certonly --standalone -d your.domain.com'
```

**② 放证书到项目目录**
```bash
ssh azureuser@<IP> 'sudo mkdir -p /opt/shiguang/pkg-shiguang/infra/certs && sudo cp /etc/letsencrypt/live/your.domain.com/fullchain.pem /opt/shiguang/pkg-shiguang/infra/certs/ && sudo cp /etc/letsencrypt/live/your.domain.com/privkey.pem /opt/shiguang/pkg-shiguang/infra/certs/ && sudo chown -R azureuser:azureuser /opt/shiguang/pkg-shiguang/infra/certs'
```

**③ 改 `.env`**
```
COOKIE_SECURE=true
# ALLOW_INSECURE_HTTP 删掉或设 false
```

**④ 重启**
```bash
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart proxy'
```

---

## 十、重建时的七个坑（按出现频率）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | `Permission denied (publickey)` | Cloud Shell 临时，密钥丢了；或 `az vm user update` 换过 | 重建密钥 + 重新注入 |
| 2 | api 一直 `Restarting` | 缺 `ALLOW_*`，或 `POSTGRES_PASSWORD` 是默认值 | 看 `docker compose logs api` |
| 3 | 登录后立刻退出 | `COOKIE_SECURE` / `COOKIE_DOMAIN` 配错 | 删 `COOKIE_DOMAIN`，HTTP 下 `COOKIE_SECURE=false` |
| 4 | 推荐 0 道 | 今天没菜单 | 跑第七节的 SQL |
| 5 | 数据被清 | 有人跑了 seed | `SEED_DEMO_DATA` 必须是 `false` |
| 6 | 恢复数据后 0 行 | `docker compose exec` 缺 `-T`，管道没进去 | 加 `-T` |
| 7 | 页面 502 | api 重建后 nginx 还指旧 IP | `restart proxy` |

---

## 十一、重建后的交接清单

- [ ] 5 个容器 healthy
- [ ] `health` 返回 `code: 0`
- [ ] 数据库行数正确（59/120/39）
- [ ] 浏览器能登录
- [ ] 首页出 3 道推荐
- [ ] 评价页有数据
- [ ] **记下新的公网 IP**（如果变了，提交链接要更新）
- [ ] 备份任务：`bash scripts/backup.sh` 跑一次，确认能生成

---

## 十二、删服务器前的备份流程（对照用）

```bash
# ① 生成备份
ssh azureuser@<IP> 'cd /opt/shiguang/pkg-shiguang && bash scripts/backup.sh && ls -lh backups/'

# ② 下载到本地（在 Cloud Shell 执行）
ssh azureuser@<IP> 'cat /opt/shiguang/pkg-shiguang/backups/<文件名>' > ~/shiguang-backup.sql.gz

# ③ Cloud Shell 右上角「下载文件」→ 输入 ~/shiguang-backup.sql.gz
```

**这份 `shiguang-backup.sql.gz` 就是重建时第六节的输入。**

---

*本指南基于 2026-11 的实际部署流程。若 Azure 或镜像源有变化，以实际输出为准。*
