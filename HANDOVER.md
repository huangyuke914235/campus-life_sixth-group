# 食光有数 · 项目交接文档

> 本文档用于对话删除后的继续开发。记录**全部关键决策、踩过的坑、核心命令、当前状态**。
> 生成时间：2026-11-13 23:50（GMT+8）
> 文档位置：`E:\campus-life_sixth-group\HANDOVER.md`

---

## 一、项目速览

| 项 | 内容 |
|---|---|
| 名称 | 食光有数（荔园智慧膳食服务平台） |
| 性质 | 深圳大学课程项目 / 评优作品，**已通过评审** |
| 定位 | 面向在校学生的一餐决策工具：按口味、预算、忌口给出可解释推荐 |
| 技术栈 | Next.js 14（App Router）+ NestJS + Prisma + PostgreSQL 16 + Redis + Nginx |
| 仓库根 | `E:\campus-life_sixth-group`（Windows，E 盘） |
| 应用目录 | `E:\campus-life_sixth-group\shiguang` |
| GitHub | https://github.com/huangyuke914235/campus-life_sixth-group （main 分支，已推送） |
| 代码规模 | 160 个跟踪文件（apps/web 65、apps/api 34、shared 8、docs 12、scripts 6） |

**真实数据规模**：13 个食堂 / 59 道菜 / 137 个菜单项 / 120 条评价 / 6 个用户画像（A–F）。

---

## 二、线上环境（重要，请保密）

| 项 | 值 |
|---|---|
| 服务器 IP | `20.247.26.140` |
| 域名 | `www.campus-life.ccwu.cc`（Cloudflare 代理） |
| 提交链接 | **只能用 IP**：`http://20.247.26.140`（评审平台限制） |
| SSH 用户 | `azureuser` |
| Azure 资源组 | `shiguang-rg` / VM 名 `shiguang-vm` |
| 部署目录 | `/opt/shiguang/pkg-shiguang` |
| 体验账号密码 | `<DEMO_PASSWORD，见服务器 .env 或 HANDOVER.local.md>`（8 个账号共用：student.a–f、merchant、admin） |
| 体验账号 | `student.a@demo.shiguang.local` 等，登录页可一键填入 |
| 数据库 | `shiguang` / 用户 `shiguang`，容器内 `postgres:5432` |

**登录 Cloud Shell 的前提**：Cloud Shell 家目录每次重开都会清空，只有 `~/clouddrive` 持久。

---

## 三、架构与关键设计

### 3.1 目录结构

```
shiguang/
├── apps/web/          Next.js 前端（学生端 + 商户端 + 管理端）
├── apps/api/          NestJS 后端（模块化：dishes/orders/pickup/reviews/recommendations/...）
├── packages/shared/   共享算法包（推荐算法、订单领域函数、类型）
├── prisma/            schema + 3 个迁移
├── scripts/           部署与验证脚本
├── docs/              12 个文档（含 DEVELOPMENT-EXECUTION.md 执行书）
└── infra/             Dockerfile、nginx 配置
```

### 3.2 推荐算法（`packages/shared/src/recommendation.ts`）

**七维权重**：`taste 0.30 / diet 0.20 / feedback 0.15 / dishQuality 0.10 / budget 0.10 / mealSupply 0.10 / diversity 0.05`

**流程**：
1. `loadCandidates`：按**当天日期 + 餐次**查已发布菜单中的在售菜品
2. `hardFilter`：过敏原 / 忌口 / 饮食模式 / 售罄 / 餐次 / 价格区间 / **预算上限（硬约束）**
3. 各维度打分 → 加权 → 多样性（同档口降权）
4. 生成「为什么推荐它」理由，引用实际生效的偏好

**关键常量**：
- 贝叶斯评分先验 7.0 / 权重 10（10 分制）
- 「便宜点」场景把预算上限压到 15 元
- 冷启动：`isColdStart(tasteProfile, feedbacks)` 为真时反馈权重让渡给口味

### 3.3 时间口径（`packages/shared/src/order.ts`）

**全部用 Asia/Shanghai**：
```ts
campusDate(now)      // 营业日 YYYY-MM-DD
campusClock(now)     // HH:mm
campusMealType(now)  // <10 早餐 / <15 午餐 / 否则晚餐
campusTime(date, t)  // 日期+时刻 → 实际 Date
```

**踩过的坑**：`inferMealType` 原来用 `getUTCHours() + 8`，UTC 16:00 后算出 24 点，已废弃改用 `campusMealType`。

### 3.4 数据库关键约束

| 表 | 唯一键 | 说明 |
|---|---|---|
| `Menu` | `[stallId, date, mealType]` | 一个档口一天一餐一个菜单 |
| `Inventory` | `[dishId, date, mealType]` | 库存按天独立 |
| `PickupSlot` | `[stallId, date, mealType, startTime]` | 时段 |
| `UserPreference` | `userId`（一对一） | |
| `Order` | `[userId, idempotencyKey]` | 幂等作用域 |

**注意**：`Inventory.updatedAt` / `PickupSlot.updatedAt` 是 Prisma `@updatedAt`，**数据库层无默认值**，裸 SQL 插入必须显式给 `now()`。

---

## 四、部署全流程（核心命令）

### 4.1 前提：Cloud Shell 恢复 SSH

> `az vm user update` 是**替换** authorized_keys，每次执行都会让旧密钥失效。

```bash
rm -f ~/.ssh/id_rsa*; ssh-keygen -t rsa -b 2048 -f ~/.ssh/id_rsa -N '' -q && echo "生成完成"
```

```bash
az vm user update -g shiguang-rg -n shiguang-vm -u azureuser --ssh-key-value "$(cat ~/.ssh/id_rsa.pub)" >/dev/null && echo "公钥已注入"
```

```bash
ssh -o StrictHostKeyChecking=no azureuser@20.247.26.140 'echo OK'
```

**备份密钥到持久盘**（避免下次重置）：
```bash
mkdir -p ~/clouddrive/.ssh-backup && cp ~/.ssh/id_rsa* ~/clouddrive/.ssh-backup/ && echo 已备份
```

### 4.2 上传部署包

> Cloud Shell 的 `scp` 常被限制（SFTP 子系统），**用管道绕过**。

```bash
cat ~/campus-life-deploy.tar.gz | ssh azureuser@20.247.26.140 'cat > /opt/shiguang/campus-life-deploy.tar.gz'
```

```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang && tar -xzf campus-life-deploy.tar.gz && cat pkg-shiguang/MANIFEST.txt'
```

**期望**：`文件：157` / `菜品图：12` / `.env：0` / `*.pem：0`

### 4.3 环境变量（每次部署必查）

```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && (grep -q "^ALLOW_INSECURE_HTTP=" .env || echo "ALLOW_INSECURE_HTTP=true" >> .env) && (grep -q "^ALLOW_DEMO_ACCOUNTS=" .env || echo "ALLOW_DEMO_ACCOUNTS=true" >> .env) && sed -i "s|^SEED_DEMO_DATA=.*|SEED_DEMO_DATA=false|" .env && sed -i "/^COOKIE_DOMAIN=/d" .env && grep -E "^(NODE_ENV|COOKIE_SECURE|SEED_DEMO_DATA|ENABLE_DEMO_ACCOUNTS|ALLOW_)" .env'
```

**必须看到 6 行**（`COOKIE_DOMAIN` 必须不出现）：
```
NODE_ENV=production
COOKIE_SECURE=false
SEED_DEMO_DATA=false
ENABLE_DEMO_ACCOUNTS=true
ALLOW_INSECURE_HTTP=true
ALLOW_DEMO_ACCOUNTS=true
```

### 4.4 构建 + 启动 + 重启 nginx

```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && docker compose -f docker-compose.yml -f docker-compose.prod.yml build api web 2>&1 | tail -4'
```

```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api web && sleep 18 && docker compose ps --format "{{.Name}} {{.Status}}"'
```

```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart proxy && sleep 5'
```

**api 必须 `Up (healthy)`**；若 `Restarting`：
```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && docker compose logs api --tail 25'
```

### 4.5 验证

```bash
ssh azureuser@20.247.26.140 'curl -s http://127.0.0.1/api/v1/health | head -c 60; echo; curl -s -o /dev/null -w "首页 %{http_code}\n" http://127.0.0.1/'
```

### 4.6 本地打包（`scripts/package.sh` 有 bug，用下面这条）

> `package.sh` 里用了 `mktemp -d`，Git Bash 返回 `C:\` 盘符路径，tar 不认。临时用这条手工命令。

```bash
cd /e/campus-life_sixth-group && STAGE="/e/campus-life_sixth-group/.pkg-stage" && rm -rf "$STAGE" && mkdir -p "$STAGE/pkg-shiguang" && cd shiguang && tar -cf - --exclude=./node_modules --exclude='*/node_modules' --exclude=./dist --exclude='*/dist' --exclude=./.next --exclude=./test-results --exclude=./playwright-report --exclude=./coverage --exclude=./.env --exclude=./.env.local --exclude=./.env.production --exclude=./infra/certs --exclude='*.pem' --exclude='*.key' --exclude=./azure --exclude=./tests/e2e/.auth --exclude=./apps/api/seed.tmp.ts --exclude=./apps/api/seed-out --exclude=./apps/api/scripts/smoke.js --exclude=./.git --exclude=./.workbuddy --exclude='*.log' --exclude=./uploads --exclude=./backups --exclude=./package-lock.json . 2>/dev/null | tar -xf - -C "$STAGE/pkg-shiguang" && cd /e/campus-life_sixth-group && ( echo "文件：$(find "$STAGE/pkg-shiguang" -type f | wc -l)" ; echo "菜品图：$(find "$STAGE/pkg-shiguang/apps/web/public/images/dishes" -name '*.jpg' | wc -l)" ) > "$STAGE/pkg-shiguang/MANIFEST.txt" && rm -f campus-life-deploy.tar.gz && tar -czf campus-life-deploy.tar.gz -C "$STAGE" pkg-shiguang && ls -lh campus-life-deploy.tar.gz
```

---

## 五、验证脚本（可在任意有 Docker 的机器复现）

### 5.1 集成测试（订单并发 / 权限 / 评价）

```bash
cd /e/campus-life_sixth-group/shiguang && bash scripts/verify-integration.sh
```

**它会**：起一次性 postgres:16 容器（随机端口、独立库）→ 应用迁移 → 跑 20 个集成测试 → 自动销毁。

**预期**：`Test Files 3 passed` / `Tests 20 passed`

**覆盖**：
- 20 并发抢库存 1 只成功 1 单
- 20 并发抢名额 1 只成功 1 单
- 20 次同键重试只建一单
- 并发取消只释放一次库存
- 并发核销只成功一次
- 取消 vs 核销只有一个终态
- 商户跨档口 403 / 学生 403 / 夹带 stallId 被丢弃

**注意**：
- 库名必须 `*_test` 结尾（测试自带安全校验，防误连生产）
- 订单用 `ORDER_TEST_DATABASE_URL`，评价用 `REVIEW_TEST_DATABASE_URL`（两个变量）
- 拉不到镜像时用 `docker.m.daocloud.io/library/postgres:16-alpine`

### 5.2 备份恢复演练

```bash
cd /e/campus-life_sixth-group/shiguang && bash scripts/verify-restore.sh
```

**它会**：起容器 → 写哨兵数据 → `pg_dump` → `gzip -t` 校验 → 恢复到新库 → 逐表比对行数。

**预期**：`恢复演练通过：备份能生成、能校验、能还原、数据一致`

### 5.3 单元测试

```bash
cd /e/campus-life_sixth-group/shiguang && corepack pnpm --filter @shiguang/shared test
cd /e/campus-life_sixth-group/shiguang && corepack pnpm --filter @shiguang/api test
```

**预期**：shared **45 passed** / api **13 passed + 14 skipped**（集成用例无 DB URL 时跳过）

---

## 六、🚨 踩坑记录（最重要，避免重复踩）

### 6.1 SSH 反复失效

| 现象 | 根因 | 修法 |
|---|---|---|
| `Permission denied (publickey)` | Cloud Shell 家目录清空，私钥丢失 | 重新 `ssh-keygen` + `az vm user update` |
| 重建后旧密钥仍可用？ | **不会**：`az vm user update` **替换** authorized_keys | 每次重建都会踢掉旧的 |
| `azure-key.txt.txt` 用不了 | 文件内容损坏（`ssh-keygen -y` 也报 `libcrypto: unsupported`） | 弃用，重新生成 |
| `scp` 报 Permission denied 但 `ssh` 正常 | Cloud Shell 限制了 SFTP 子系统 | 用 `cat file \| ssh ... 'cat > path'` |

### 6.2 IP 访问无法登录（三连坑）

按发现顺序：

1. **`COOKIE_SECURE=true`** → HTTP 下浏览器不保存 Cookie → 改 `false`
2. **`COOKIE_DOMAIN=campus-life.ccwu.cc`** → 用 IP 访问时 Domain 不匹配，Cookie 被**直接丢弃** → 删掉这一行（留空 = 跟随当前 host）
3. **`csrf_token` 依赖 Cookie** → 前两个坏的时候它也一起坏

**验证方法**：
```bash
curl -s -i -X POST http://20.247.26.140/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"student.a@demo.shiguang.local","password":"<DEMO_PASSWORD>"}' | grep -i set-cookie
```
**Set-Cookie 里既没有 `Secure` 也没有 `Domain=` 才算对**。

### 6.3 每次重启清库

`SEED_DEMO_DATA=true` + `entrypoint-api.sh` 里的自动 seed → **每次容器重启都 `TRUNCATE ... CASCADE`**。

**已修**：
- `.env.production.example` 默认 `false`
- `deploy-app.sh` 在 seed 后自动 sed 关闭
- `entrypoint-api.sh` 已无 seed 逻辑
- `runtime-config.ts` 生产环境**拒绝** `SEED_DEMO_DATA=true`（无豁免口子）

**铁律**：部署后**绝不**执行 `pnpm exec tsx prisma/seed.ts`。

### 6.4 推荐 0 道（跨天必踩）

**根因**：`loadCandidates` 按**当天日期**查 `Menu`，而 seed 只在执行当天生成菜单。**隔天就空**。

**已做的补救**：把菜单复制到未来 30 天（11-14 至 12-14 已铺满）。

**补今天的 SQL**（DB 会话时区是 Asia/Shanghai，**不要**再手动 `+8 hours`）：
```bash
cat <<'SQL' | ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && docker compose exec -T postgres psql -U shiguang -d shiguang -v ON_ERROR_STOP=1 -q'
SET client_min_messages TO NOTICE;
DO $$
DECLARE src date; tgt date := CURRENT_DATE;
BEGIN
  SELECT MAX(date) INTO src FROM "Menu" WHERE status = 'PUBLISHED' AND date < tgt;
  RAISE NOTICE '复制 % → %', src, tgt;
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
END $$;
SQL
```

**验证**：
```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -c "SELECT CURRENT_DATE, count(*) FROM \"Menu\" WHERE date = CURRENT_DATE;"'
```
**期望**：`2026-11-13|39`

### 6.5 SQL 时区陷阱

- **DB 会话时区是 Asia/Shanghai**（不是 UTC）
- 所以 `now()` 已是北京时间，**再加 `interval '8 hours'` 会跨天**
- 生成"今天"用 `CURRENT_DATE` 即可

### 6.6 `docker exec` 缺 `-i` 静默失效

```bash
# ❌ 错的：heredoc 和管道都进不去，psql 空跑返回 0
docker exec mydb psql -U x -d y <<'SQL' ... SQL
# ✅ 对的
docker exec -i mydb psql -U x -d y <<'SQL' ... SQL
```

**症状**：日志说"已插入 3 条"，但表里是 0 行。

### 6.7 SQL 类型不匹配导致 DO 块整体回滚

```sql
m.id || i        -- ❌ text || integer，PostgreSQL 不隐式转换
m.id || i::text  -- ✅
```
`DO $$ ... $$` 是**单事务**，任何一处报错全部回滚，表现为"执行了但没效果"。

### 6.8 其他

| 现象 | 根因 | 修法 |
|---|---|---|
| 页面 502 | api 容器重建后 IP 变，nginx 还指旧 IP | `restart proxy` |
| `bcryptjs` 找不到 | 在 api 容器外跑 | `docker compose exec -T api node -e ...` |
| pnpm 命令找不到 | 本地只有 corepack，未 `corepack enable` | 用 `corepack pnpm` 或 `node_modules/.bin/xxx` |
| 打包脚本报 `a243c95:shiguang` | `package.sh` 的 `$$` 与 git 对象语法混淆 | 用 4.6 的手工命令 |
| GitHub push 502 | 网络代理问题 | 重试，或改 SSH 方式 |

---

## 七、任务状态（对应 `docs/DEVELOPMENT-EXECUTION.md`）

| 任务 | 状态 | 证据 |
|---|---|---|
| 00 盘点 | ✅ 已验收 | git / 锁文件 / CI 位置 / 忽略规则 |
| 01 可复现构建 | 🟡 部分 | 锁文件冻结校验通过；**真实依赖安装未跑** |
| 02 数据保护 | ✅ 已验收 | 线上重部署后 59/120/39/7 全保留，5 容器 healthy |
| 03 权限边界 | ✅ 已验收 | 6 个 PostgreSQL 权限用例 |
| 04 时间口径 | 🟢 实现 | campus* 全链路 + 45 单测 |
| 05 下单事务 | ✅ 已验收 | 11 个并发用例（20 并发抢库存只成 1 单） |
| 06 取消核销 | ✅ 已验收 | 并发取消/核销/终态唯一 |
| 07 评价画像 | ✅ 已验收 | 3 个 PostgreSQL 用例 |
| 08 推荐预算 | ✅ 已验收 | 45 单测含预算硬约束回归 |
| 09 三角色页面 | 🟢 实现 | CSRF/分页/搜索统一；**浏览器回归未做** |
| 10 CI | 🟡 部分 | 本地等价通过；**GitHub Actions 未确认** |
| 11 预发布恢复 | 🟡 部分 | 恢复演练通过；**真实备份未生成** |
| 12 试点准备 | 🟢 实现 | `docs/PILOT-PLAYBOOK.md` 9 节 |

---

## 八、待办事项

### 8.1 立即可做（10 分钟）

- [ ] **补今天的菜单**（见 6.4 的 SQL），否则推荐仍为 0
- [ ] **浏览器验证**：`http://20.247.26.140` 登录 → 首页出 3 道菜 → 评价页 120 条
- [ ] **看一眼 GitHub Actions**：https://github.com/huangyuke914235/campus-life-sixth-group/actions

### 8.2 短期（1–2 小时）

- [ ] **真实备份**：`ssh ... 'cd /opt/shiguang/pkg-shiguang && bash scripts/backup.sh'`
- [ ] **修 `scripts/package.sh`**：把 `mktemp -d` 换成固定路径，或加 Windows 兼容分支
- [ ] **修 `refresh-menu.ts` / SQL 的时区**：改用 `CURRENT_DATE`，不再 `+8 hours`

### 8.3 中期（产品化）

- [ ] **商户端加「一键复制昨日菜单」**：真正的业务解法，替代手工 SQL 铺数据
- [ ] **后端加菜单回退**：当天无菜单时回退最近一次，并在 UI 标注"今日未发布"
- [ ] **浏览器回归**：开 CSRF 后验证停用、上传、会话续期
- [ ] **恢复演练用真实备份**：从 VM 导一份，本地 `verify-restore.sh` 恢复核对

### 8.4 长期（试点）

- 参考 `docs/PILOT-PLAYBOOK.md`，先跑 1 个食堂 1–2 个档口的午餐周期

---

## 九、本地开发环境速查

| 项 | 状态 / 值 |
|---|---|
| Node | 22.x |
| pnpm | 通过 `corepack pnpm`（9.12.0），**不在 PATH** |
| Docker | Docker Desktop，镜像源用 `docker.m.daocloud.io` |
| 本地密钥 | `~/.ssh/azure_key`（**已损坏，弃用**）、`~/.ssh/id_ed25519`（连不上 VM） |
| 能连 VM 的只有 | **Cloud Shell 里现场生成的密钥** |
| 打包产物 | `E:\campus-life_sixth-group\campus-life-deploy.tar.gz` |
| 临时 staging | `E:\campus-life_sixth-group\.pkg-stage`（已加 gitignore） |

**本地 Docker 切勿留容器/卷**（会占 C 盘）：
```bash
docker rm -f $(docker ps -aq --filter "name=shiguang-") 2>/dev/null; docker volume prune -f; docker rmi docker.m.daocloud.io/library/postgres:16-alpine 2>/dev/null
```

---

## 十、数据查询速查

```bash
# 一键看核心数据（外面套 ssh ...）
docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -F"|" -c "SELECT (SELECT COUNT(*) FROM \"Dish\") dishes, (SELECT COUNT(*) FROM \"Review\") reviews, (SELECT COUNT(*) FROM \"Menu\" WHERE date = CURRENT_DATE) today_menus, (SELECT COUNT(*) FROM \"UserPreference\") prefs;"
```

**期望**：`59|120|39|7`

```bash
# 菜单按日分布
docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -c "SELECT date::text, count(*) FROM \"Menu\" GROUP BY date ORDER BY date DESC LIMIT 5;"

# 订单状态分布
docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -c "SELECT status, count(*) FROM \"Order\" GROUP BY status;"
```

---

## 十一、API 端点速查

| 端点 | 说明 |
|---|---|
| `GET /api/v1/health` | 健康检查 |
| `POST /api/v1/auth/login` | 登录（cookie 模式） |
| `POST /api/v1/auth/register` | 注册 |
| `GET /api/v1/auth/demo-accounts` | 体验账号列表 |
| `POST /api/v1/recommendations/query` | 推荐（body: mealType/limit/场景标签） |
| `GET /api/v1/recommendations/today` | 今日推荐 |
| `GET /api/v1/dishes?page&pageSize` | 菜品分页 |
| `GET /api/v1/reviews/feed?minRating=8` | 评价广场 |
| `POST /api/v1/orders` | 下单（需 idempotencyKey） |
| `POST /api/v1/pickup/verify` | 核销取餐码 |

---

*本文档由 AI 助手（阿岩）在对话结束前整理。若发现内容与实际不符，以线上实测为准。*
