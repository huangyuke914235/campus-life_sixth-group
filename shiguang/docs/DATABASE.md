# 数据库设计

PostgreSQL 16 + Prisma 5。全库金额使用 `Int priceCents`（分），避免浮点误差。

## 核心实体（30 个模型/枚举）

| 域 | 模型 | 说明 |
|---|---|---|
| 用户 | `User` `RefreshToken` `UserPreference` `UserTasteProfile` `DietaryRestriction` | 显式偏好与推断画像**分表**；RefreshToken 只存哈希 |
| 组织 | `Canteen` `Stall` | 食堂 1:N 档口；`Stall.managers` 隐式多对多授权商户 |
| 菜品 | `Dish` `DishIngredient` `DishNutrition` `DishTag` | `DishTag` 与 `Dish` 隐式多对多 |
| 菜单 | `Menu` `MenuItem` `Inventory` `PickupSlot` | 库存按「菜品+日期+餐次」独立记账，含 `version` 乐观锁 |
| 交易 | `Order` `OrderItem` `PickupToken` `PaymentOrder` | 明细存名称与成交价快照；`PaymentOrder.isMock` 标记演示 |
| 反馈 | `Review` `ReviewFeeling` `Favorite` `UserBehavior` | 评价唯一约束 `(orderId, dishId, userId)`；体感按 group+code 唯一 |
| 算法 | `RecommendationLog` `RecommendationItem` | 落权重快照、各维度得分、推荐理由，便于复盘与升级 |
| 运营 | `Notification` `SystemAnnouncement` `AuditLog` | 通知读态索引；审计记录操作人/角色/IP（脱敏） |

## 关键约束

- `@@unique([orderId, dishId, userId])` — 同一订单同一菜品只能评价一次。
- `@@unique([dishId, date, mealType])` — 库存唯一记账位。
- `@@unique([userId, idempotencyKey])` 为同一账号提供幂等下单。新订单记录请求指纹，旧订单按已保存的时段、明细和成交快照识别重试。
- `PickupToken.orderId @unique` + `code @unique` — 一单一凭证、码不重复。
- `@@unique([menuId, dishId])`、`@@unique([stallId, date, mealType])`、`@@unique([stallId, date, mealType, startTime])` 避免菜单和时段重复。

## 订单迁移与历史检查

将 `20261112110000_scope_order_idempotency` 与支持账号级查询的新应用版本一起发布。迁移为订单增加可空指纹并将唯一索引改为账号和幂等键组合。升级后允许不同账号使用相同键，回退需要保留账号级查询语义。

在获授权的数据副本上检查历史异常。可先运行以下只读查询，把结果交给业务负责人核对实际供餐记录。

```sql
SELECT o.id, o."pickupSlotId"
FROM "Order" o JOIN "PickupSlot" s ON o."pickupSlotId" = s.id
WHERE o."stallId" <> s."stallId" OR o."scheduledDate" <> s.date OR o."mealType" <> s."mealType";

SELECT id, total, remaining FROM "Inventory" WHERE remaining < 0 OR remaining > total;
SELECT id, capacity, booked FROM "PickupSlot" WHERE booked < 0 OR booked > capacity;
```

## 索引策略

高频查询路径均建索引：`Order(userId, createdAt)`、`Order(stallId, status)`、`Order(status, createdAt)`、`Review(dishId, status, createdAt)`、`Review(userId, createdAt)`、`MenuItem(dishId)`、`Inventory(date, mealType)`、`Notification(userId, readAt, createdAt)`、`RecommendationItem(dishId, createdAt)`、`UserBehavior(userId, type, createdAt)`。

## 删除策略（防孤儿）

| 关系 | 策略 |
|---|---|
| User → RefreshToken / Preference / Profile / Restriction / Favorite / Behavior / Notification / RecommendationLog / Review | `Cascade` / `Restrict`（评价保留，账号删除走软停用 + 匿名化批处理） |
| Stall → Dish / Menu / PickupSlot / Order | `Restrict`（有历史订单的档口不可删） |
| Dish → MenuItem / Nutrition / Ingredient | `Cascade`；Dish → OrderItem / Review `Restrict` |
| Order → OrderItem / PickupToken / PaymentOrder | `Cascade`（订单是聚合根） |
| Review → ReviewFeeling | `Cascade` |
| AuditLog.actor | `SetNull`（操作人注销后仍保留审计事实） |

菜品不做物理删除，`status` 改为 `OFF_SHELF`，避免历史订单出现悬空引用。

## 迁移与演示数据

```bash
pnpm exec prisma generate
pnpm exec prisma migrate dev --name init
pnpm db:seed
```

`prisma/seed.ts` 会清空演示表后重建：**13 个食堂 / 13 个档口 / 59 道菜 / 三餐菜单（39 条菜单、137 个菜单项）/ 库存 / 取餐时段（91 个）/ 120 条历史评价 / 6 个用户画像**。演示账号密码来自 `DEMO_PASSWORD`，未设置时生成一次性随机值并打印。

> ⚠️ **seed 开头是 `TRUNCATE ... CASCADE`**，生产环境禁止执行。启动校验已拒绝 `SEED_DEMO_DATA=true`。

---

## 核心表字段字典

只列**容易踩坑**的字段，完整定义看 `prisma/schema.prisma`。

### `Dish`（菜品）

| 字段 | 类型 | 说明 |
|---|---|---|
| `priceCents` | Int | **分**为单位，不是元 |
| `spiceScore` / `oilScore` / `saltScore` | Int 0–5 | 三维评分，推荐的「口味匹配」直接读这三个 |
| `sweetnessScore` / `flavorIntensity` / `portionScore` | Int 0–5 | 辅助维度 |
| `isVegetarian` | Bool | `VEGETARIAN` 饮食模式只看这个 |
| `verifiedDietPatterns` | String[] | `VEGAN` / `HALAL` / `PESCATARIAN` 需要核验；`dietVerifiedAt` 为空时不参与推荐 |
| `avgRating` / `ratingCount` | Float / Int | 派生值，由评价事务重算，**不要手工改** |
| `status` | Enum | `ACTIVE` / `OFF_SHELF`，下架不做物理删除 |
| `stallId` | String | **商户不可通过 update 修改**（白名单拦截），改档口走管理员 |

### `Order`（订单）

| 字段 | 类型 | 说明 |
|---|---|---|
| `unitPriceCents`（在 OrderItem） | Int | **成交价快照**，菜品改价不影响历史订单 |
| `idempotencyKey` | String | 与 `userId` 组成唯一键；同键异内容返回 10008 |
| `requestFingerprint` | String? | 请求内容指纹，用于判定"同内容重试" |
| `status` | Enum | `PENDING → CONFIRMED → READY → COMPLETED`，分支 `CANCELLED` / `EXPIRED` |
| `scheduledDate` | Date | 从 `pickupSlot` 反推，**不信客户端传的** |
| `pickupSlotId` | String | 订单的日期/餐次/档口都以它为准 |

### `Inventory`（库存）

| 字段 | 类型 | 说明 |
|---|---|---|
| `total` / `remaining` | Int | 扣减只改 `remaining`，`total` 是当天的备货量 |
| `version` | Int | 乐观锁版本号，配合条件更新防超卖 |
| `updatedAt` | DateTime | **Prisma `@updatedAt`，数据库层无默认值**；裸 SQL 插入必须显式给 `now()` |

### `PickupSlot`（取餐时段）

| 字段 | 类型 | 说明 |
|---|---|---|
| `startTime` / `endTime` | String | `"11:30"` 格式；日期用字段 `date` |
| `capacity` / `booked` | Int | 名额；`booked < capacity` 条件更新防超卖 |
| `cutoffMinutes` | Int | 提前多少分钟停止预约，默认 15 |
| `isClosed` | Bool | 手动关闭该时段 |

### `UserPreference`（显式偏好）vs `UserTasteProfile`（推断画像）

**两张表分开存**，这是刻意的：

- `UserPreference`：用户问卷填的（菜系、辣度、预算、忌口），**系统永不覆盖**
- `UserTasteProfile`：从评价里学的（各维度偏好值、置信度），可重置

推荐时先看显式偏好，推断画像只做微调。

---

## 常见查询

```bash
# 核心数据量
docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -F"|" -c "SELECT (SELECT COUNT(*) FROM \"Dish\") dishes, (SELECT COUNT(*) FROM \"Review\") reviews, (SELECT COUNT(*) FROM \"Menu\" WHERE date = CURRENT_DATE) today_menus, (SELECT COUNT(*) FROM \"UserPreference\") prefs;"

# 今天的菜单分布
docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -c "SELECT \"mealType\", count(*) FROM \"Menu\" WHERE date = CURRENT_DATE GROUP BY \"mealType\";"

# 订单状态分布
docker compose exec -T postgres psql -U shiguang -d shiguang -t -A -c "SELECT status, count(*) FROM \"Order\" GROUP BY status;"
```

> **时区提示**：数据库会话时区是 `Asia/Shanghai`，`CURRENT_DATE` 就是北京今天。**写 SQL 时不要再 `+ interval '8 hours'`**，否则会跨到明天（这个坑踩过）。

---

> 本文件描述的是设计意图；schema 是否通过 `prisma validate`、迁移是否实际执行，见 [TESTING.md](TESTING.md) 的实测记录。
