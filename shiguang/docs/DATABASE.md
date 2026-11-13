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

`prisma/seed.ts` 会清空演示表后重建：3 食堂 / 12 档口 / 54 道菜 / 三餐菜单 / 库存 / 取餐时段 / 历史评价 / 已完成订单 / 4 类演示账号。演示账号密码来自 `DEMO_PASSWORD`，未设置时生成一次性随机值并打印。

> 本文件描述的是设计意图；schema 是否通过 `prisma validate`、迁移是否实际执行，见 [PROGRESS.md](PROGRESS.md) 的实测记录。
