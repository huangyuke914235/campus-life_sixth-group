# 运维手册（OPERATIONS）

> 面向日常运维：每天看什么、出问题怎么查、紧急情况怎么停。
> 部署流程见 `DEPLOYMENT.md`，环境信息见根目录 `HANDOVER.md`。

---

## 一、日常巡检（每天 2 分钟）

在 Cloud Shell 执行：

```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && echo "=== 容器 ===" && docker compose ps --format "{{.Name}}\t{{.Status}}" && echo "=== 数据 ===" && docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -F"|" -c "SELECT (SELECT COUNT(*) FROM \"Dish\") dishes, (SELECT COUNT(*) FROM \"Review\") reviews, (SELECT COUNT(*) FROM \"Menu\" WHERE date = CURRENT_DATE) today_menus, (SELECT COUNT(*) FROM \"Order\") orders;" && echo "=== 健康 ===" && curl -s http://127.0.0.1/api/v1/health | head -c 60'
```

**健康标准**：

| 检查 | 正常值 | 异常含义 |
|---|---|---|
| 容器状态 | 5 个 `Up (healthy)` | 有 `Restarting` → 看日志 |
| dishes | 59（或稳定增长） | 掉到 0 → **数据被清，立即排查 seed** |
| today_menus | **39** | 0 → **今天没菜单，推荐会空** |
| reviews | 120+ | 掉到 0 → 数据丢失 |
| health | `{"code":0,...}` | 非 0 → API 挂了 |

**每天必看的一项**：`today_menus` 是否为 39。**归零就意味着今天推荐不出菜**（见第四节 Q1）。

---

## 二、故障处理速查

### 2.1 站点打不开

| 症状 | 排查顺序 | 修法 |
|---|---|---|
| 浏览器显示 502 | `docker compose ps` 看 api 是否 Up | 若 api 刚重建，`restart proxy` |
| 502 且 api 也在重启 | `docker compose logs api --tail 30` | 日志有 `Unsafe production configuration` → 缺 `ALLOW_*` 变量 |
| 连接超时 | `curl -I http://20.247.26.140` 在 VM 上 | 通 → 本地网络问题；不通 → nginx 或 VM 挂了 |
| 域名打不开但 IP 能开 | Cloudflare 代理状态 | 控制台检查 DNS / SSL 模式 |

### 2.2 登录成功后立刻退回登录页

**这是本项目最高频的问题**，三个条件缺一不可：

```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && grep -E "^(COOKIE_SECURE|COOKIE_DOMAIN|CSRF_ENABLED|ALLOW_INSECURE_HTTP)" .env'
```

| 配置 | IP 访问时必须 | 域名 HTTPS 时 |
|---|---|---|
| `COOKIE_SECURE` | `false` | `true` |
| `COOKIE_DOMAIN` | **不存在这一行** | 可留空或写域名 |
| `ALLOW_INSECURE_HTTP` | `true` | 可删 |

**验证 Cookie 是否正确下发**：
```bash
curl -s -i -X POST http://20.247.26.140/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"student.a@demo.shiguang.local","password":"<DEMO_PASSWORD>"}' | grep -i set-cookie
```
**`Set-Cookie` 里既不能有 `Secure` 也不能有 `Domain=`**。

### 2.3 推荐 0 道

按顺序查：

```bash
# ① 今天的菜单数（必须 39）
docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -c "SELECT CURRENT_DATE, count(*) FROM \"Menu\" WHERE date = CURRENT_DATE;"

# ② 食堂/档口/菜品是否正常
docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -c "SELECT (SELECT count(*) FROM \"Canteen\" WHERE \"isOpen\"), (SELECT count(*) FROM \"Stall\" WHERE \"isActive\"), (SELECT count(*) FROM \"Dish\" WHERE status = 'ACTIVE');"

# ③ 后端算出来的"今天"是哪天
docker compose exec -T api node -e "const d=new Date(); console.log(d.toISOString(), new Date(d.getTime()+8*3600*1000).toISOString().slice(0,10))"
```

**对应修法**：

| 结果 | 修法 |
|---|---|
| ① = 0 | 补菜单（见第四节 Q1 的 SQL） |
| ② 任一项为 0 | `UPDATE "Canteen" SET "isOpen"=true;` / `UPDATE "Stall" SET "isActive"=true;` |
| ③ 的日期 ≠ ① 的日期 | 时区错位，按 ③ 的日期补菜单 |

### 2.4 数据突然归零

**几乎一定是 seed 被跑了。**

```bash
# 查 api 启动日志里有没有 seed 痕迹
docker compose logs api --since 24h | grep -i "seed\|truncate" | head
```

**根因排查**：
- `.env` 里 `SEED_DEMO_DATA=true` → 改成 false
- 有人手动执行了 `pnpm exec tsx prisma/seed.ts` → 无法撤回，只能从备份恢复

**从备份恢复**：
```bash
# 先确认备份文件
ls -lh /opt/shiguang/pkg-shiguang/backups/

# 恢复到临时库并核对（不要直接覆盖生产库）
bash scripts/restore.sh backups/xxx.sql.gz shiguang_restore_check
```
核对无误后再决定是否用 `pg_restore` 覆盖生产库——**这一步需要人工确认**。

### 2.5 磁盘满了

```bash
df -h /
du -sh /var/lib/docker/* 2>/dev/null | sort -rh | head -5
```

**安全清理**（不删数据）：
```bash
docker image prune -f          # 悬空镜像
docker builder prune -f        # 构建缓存
docker logs --tail 0 $(docker ps -q) 2>/dev/null  # 确认日志卷没爆
```

**不要做**：`docker system prune -a --volumes`（会连数据库卷一起删）。

---

## 三、日志与监控

### 3.1 日志位置

| 服务 | 查看命令 |
|---|---|
| api | `docker compose logs api --tail 100 -f` |
| nginx | `docker compose logs proxy --tail 100` |
| postgres | `docker compose logs postgres --tail 50` |

**按时间过滤**：`--since 2h` / `--since "2026-11-13T10:00:00"`

### 3.2 关键错误关键词

```bash
docker compose logs api --since 24h | grep -E "Unsafe production|P20|ETIMEDOUT|ECONNREFUSED" | head -20
```

| 关键词 | 含义 |
|---|---|
| `Unsafe production configuration` | 启动校验失败，缺环境变量 |
| `P2002` | 唯一约束冲突（幂等键重复是正常的） |
| `ECONNREFUSED` | 依赖服务没起来 |
| `ETIMEDOUT` | 网络超时（数据库慢或挂了） |

### 3.3 建议告警阈值（当前无自动告警，靠巡检）

| 指标 | 阈值 | 说明 |
|---|---|---|
| api 容器非 healthy | 持续 2 分钟 | 立即介入 |
| today_menus | 0 | 当天中午 11:00 前必须 > 0 |
| 订单创建失败率 | > 5% | 可能库存或事务出问题 |
| 备份文件年龄 | > 7 天 | 该做备份了 |

---

## 四、常见问题（Q&A）

### Q1：今天推荐不出来，怎么快速补菜单？

```bash
cat <<'SQL' | ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && docker compose exec -T postgres psql -U shiguang -d shiguang -v ON_ERROR_STOP=1 -q'
SET client_min_messages TO NOTICE;
DO $$
DECLARE src date; tgt date := CURRENT_DATE;
BEGIN
  SELECT MAX(date) INTO src FROM "Menu" WHERE status = 'PUBLISHED' AND date < tgt;
  IF src IS NULL THEN RAISE NOTICE '没有可复制的历史菜单'; RETURN; END IF;
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

**注意**：数据库会话时区是 **Asia/Shanghai**，`CURRENT_DATE` 就是北京今天，**不要加 `interval '8 hours'`**（会跨天）。

### Q2：怎么改体验账号的密码？

```bash
# 生成新密码哈希
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && docker compose exec -T api node -e "console.log(require(\"bcryptjs\").hashSync(\"新密码\", 10))"'
```
拿到 hash 后：
```bash
docker compose exec -T postgres psql -U shiguang -d shiguang -c "UPDATE \"User\" SET \"passwordHash\"='<上一步的 hash>' WHERE email='student.a@demo.shiguang.local';"
```

### Q3：怎么停机省钱？

```bash
az vm deallocate -g shiguang-rg -n shiguang-vm   # 停机（不产生计算费用，磁盘仍计费）
az vm start -g shiguang-rg -n shiguang-vm        # 开机（约 30 秒恢复，数据在磁盘上）
```

**注意**：停机后公网 IP 可能变化（除非是静态 IP），需要重新确认提交链接。

### Q4：怎么备份？

```bash
ssh azureuser@20.247.26.140 'cd /opt/shiguang/pkg-shiguang && bash scripts/backup.sh'
```
产物在 `/opt/shiguang/pkg-shiguang/backups/*.sql.gz`。**建议每周一次**，并下载到本地留档。

### Q5：怎么确认备份能恢复？

本地（有 Docker）跑：
```bash
cd /e/campus-life_sixth-group/shiguang && bash scripts/verify-restore.sh
```
它会用自造数据完整演练一遍备份→恢复→比对。

---

## 五、紧急暂停

**当前没有一键暂停开关**，用以下方式阻断新预约：

1. 后台把当日所有档口的**取餐时段容量改为 0**
2. 或把当日菜单状态改为 `DRAFT`

**已有订单仍可履约或取消**——暂停只阻断新预约。

**立即暂停的四个条件**（满足任一）：
- 数据丢失（订单/库存/评价无法解释地缺失）
- 越权（商户能改别人档口、学生看到后台数据）
- 负库存
- 同一取餐码被核销两次且都成功

---

## 六、容器与端口

| 容器 | 端口 | 说明 |
|---|---|---|
| `pkg-shiguang-proxy-1` | 80 / 443 | nginx，唯一对外 |
| `pkg-shiguang-web-1` | 3000（内部） | Next.js |
| `pkg-shiguang-api-1` | 3001（内部） | NestJS |
| `pkg-shiguang-postgres-1` | 5432（仅 127.0.0.1） | 生产 overlay 不对外映射 |
| `pkg-shiguang-redis-1` | 6379（内部） | |

**公网只开 80 / 443 / 22**，数据库和 Redis 都不暴露。

---

*本文档记录的是当前（单机 Docker Compose）的运维方式。若将来水平扩容，本手册的"单容器"假设需要重写。*
