# 架构说明

## 1. 总体形态

pnpm workspace 的 TypeScript 全栈 Monorepo，**模块化单体**而非微服务：一个 NestJS API + 一个 Next.js Web + 一个零依赖共享包。理由是本项目业务量级不需要分布式复杂度，单体更容易保证事务一致性（订单/库存/时段）与部署可维护性。

```
apps/web (Next.js 14 App Router)
        │  HttpOnly Cookie + REST /api/v1
        ▼
apps/api (NestJS 10)  ── Prisma ──▶ PostgreSQL 16
        │                         └─ Redis 7（队列/限流扩展位）
        └── packages/shared（领域模型 + 推荐引擎，纯函数）
```

## 2. 为什么推荐引擎放在 shared

推荐引擎必须同时被 **API 运行时**、**单元测试**、以及未来的**离线评估脚本**使用。放进 `packages/shared` 有三个好处：

1. 零外部依赖的纯函数，可被 Vitest 直接测，不需要数据库或 Nest 容器；
2. 前后端共享同一套领域类型（`DishCandidate`、`TasteProfile`、`FeedbackSignal`），避免接口定义漂移；
3. 未来替换为 LLM / Embedding Provider 时，只需实现同一接口，不动业务层。

## 3. 后端分层

| 层 | 位置 | 职责 |
|---|---|---|
| 横切 | `src/common` | 统一响应/错误码、异常过滤、日志脱敏、RBAC Guard、档口数据边界、限流 |
| 接入 | 各 `*.module.ts` 的 Controller | DTO 校验（class-validator）、参数解析、调用 service |
| 领域 | 各 `*.module.ts` 的 Service | 业务规则、事务、权限断言、事件副作用（通知/行为日志） |
| 持久化 | `PrismaService` | 连接池、可串行化事务封装 |
| 算法 | `packages/shared` | 推荐评分、解释、画像更新、订单金额与状态机 |

**权限在后端执行**：`JwtAuthGuard`（全局）解析身份 → `RolesGuard`（全局）校验角色 → Service 内 `assertStallScope` / `assertOwnerOrAdmin` 校验数据边界。前端隐藏按钮不构成安全边界。

## 4. 一致性设计

- **订单**：`withSerializable` 事务 + `Inventory.version` 乐观锁 + 条件更新（`remaining >= qty`），防超卖；`idempotencyKey` 唯一约束防重复下单；时段用 `booked < capacity` 条件更新防超卖名额。
- **评价**：写入后在同一事务内（1）按全部现存评价重算菜品均分（2）**重放**该用户全部评价重建画像。选择重放而非增量补丁，是为了让修改/删除评价后不留漂移。
- **审核**：`status=HIDDEN` 只影响前台展示，不删除记录、不改统计与画像，保证历史与推荐一致。
- **订单价格**：`OrderItem.unitPriceCents` 为成交价快照，菜品改价不影响历史订单。

## 5. 前端结构

- App Router，页面按业务分目录；`Providers` 统一注入 TanStack Query 与主题状态（Zustand）。
- 展示组件（`StarRating`、`FeelingTags`、`DishCard`、`BottomNav`）与页面解耦，便于后台复用。
- `lib/api.ts` 统一处理 Cookie 登录态、响应解包、`ApiError` 与网络异常；页面必须区分 loading / empty / error 三种状态。
- 深浅色通过 `:root` / `.dark` CSS 变量切换；`prefers-reduced-motion` 下强制关闭动画。

## 6. 扩展边界

`RecommendationProvider` / `LLMRecommendationProvider` / `EmbeddingRecommendationProvider` / `RecommendationExplanationProvider` / `NotificationProvider`，以及 `PaymentOrder(provider, isMock)` 字段，构成未来接入 AI、支付、通知、校园系统的替换点。默认实现全部本地可运行，无凭证不阻塞核心链路。

---

## 7. 后端模块清单

| 模块 | 职责 | 关键依赖 |
|---|---|---|
| `auth` | 注册、登录、刷新、登出、体验账号 | `users`、`runtime-config` |
| `users` | 资料读写、隐私删除 | — |
| `preferences` | 口味问卷、画像读写、重置推断、忌口 | `shared`（画像算法） |
| `canteens` / `stalls` | 食堂与档口 | — |
| `dishes` | 菜品 CRUD、搜索分页、上下架 | `shared`（营养估算） |
| `menus` | 每日菜单、菜单项、库存、取餐时段 | `orders`（时段校验） |
| `recommendations` | 推荐查询、解释、权重配置 | `shared`（推荐引擎）、`menus`、`preferences`、`reviews` |
| `orders` | 下单、取消、状态流转、商户看板 | `menus`、`pickup`、`notifications` |
| `pickup` | 取餐码、核销 | `orders` |
| `reviews` | 评价写入、均分重算、画像重放 | `preferences`、`dishes` |
| `nutrition` | 菜品营养、单餐汇总、历史 | `orders` |
| `favorites` | 收藏 | — |
| `notifications` | 站内通知、公告 | — |
| `analytics` | 学生报告、商户看板 | `orders`、`reviews` |
| `admin` | 用户/角色、审核、订单监督、审计日志 | 全部 |
| `tasks` | 订单超时扫描（定时） | `orders` |
| `prisma` | 连接、事务封装 | — |
| `common` | 响应包装、错误码、Guard、限流、脱敏 | — |

**依赖纪律**：
- `common` 与 `prisma` 是基础设施，**任何模块都可依赖，它们不反向依赖业务模块**
- 业务模块之间**单向依赖**，避免循环（`orders → pickup` 可以，`pickup → orders` 只在类型层面）
- 跨模块的纯逻辑一律下沉到 `packages/shared`，不在模块之间互相 import service

---

## 8. 关键数据流

### 8.1 一次推荐请求

```
GET /recommendations/today
  │
  ├─ JWT 校验 → AuthUser
  ├─ 读 UserPreference（画像）
  ├─ 读最近 30 天 FeedbackSignal（评价）
  ├─ campusDate(now) / campusMealType(now)  ← 统一时间口径
  │
  ├─ loadCandidates(date, mealType)
  │    ├─ MenuItem.where(menu.date=今天, mealType, status=PUBLISHED)
  │    ├─ 关联 Dish（含 tags/ingredients/nutrition）
  │    └─ 关联 Inventory（当天该餐次库存）
  │
  ├─ hardFilter(候选, 忌口, 画像, ctx)
  │    └─ 过敏原 / 忌口 / 饮食模式 / 售罄 / 餐次 / 价格 / 预算上限
  │
  ├─ 七维打分 → 加权 → 多样性调整
  ├─ 生成理由（引用实际生效的条件）
  └─ 写 RecommendationLog（用于排序去重）
```

**关键约束**：`loadCandidates` 返回 0 条 → 直接返回空，**不做随机兜底**。这是刻意的：宁可告诉用户"没有合适的"，也不推荐明显不匹配的菜。

### 8.2 一次下单

```
POST /orders  { pickupSlotId, items[], idempotencyKey }
  │
  ├─ withSerializable 事务开始
  │    ├─ 按 (userId, idempotencyKey) 查已有订单
  │    │    ├─ 有 → 比对请求指纹 → 同内容返回原单 / 异内容 10008
  │    │    └─ 无 → 继续
  │    │
  │    ├─ 从 pickupSlot 反推 stallId / date / mealType（不信客户端传的）
  │    ├─ 校验时段未过截止、容量未满
  │    │
  │    ├─ 逐个 item：
  │    │    ├─ Inventory.updateMany({ remaining >= qty })  ← 条件更新
  │    │    ├─ count !== 1 → 抛 10006 库存冲突
  │    │    └─ 价格与客户端确认值比对 → 不一致抛 10015
  │    │
  │    ├─ Order.create（含成交价快照 unitPriceCents）
  │    ├─ PickupSlot 名额 +1
  │    └─ 写通知、行为日志
  │
  └─ 提交事务（任何一步失败全部回滚）
```

**幂等语义**：
- 同账号 + 同键 + 同内容 → 返回原单，不重复扣库存
- 同账号 + 同键 + 异内容 → 409（10008）
- 其他账号无法读取该订单

### 8.3 一次核销

```
POST /pickup/verify  { code, stallId }
  │
  ├─ 查 token（code）
  ├─ Order.updateMany({ id, status: 'READY', stallId })  ← 条件更新
  │    └─ count !== 1 → 409（已核销 / 状态不对 / 不是本档口）
  ├─ PickupToken.updateMany({ id, status: 'ACTIVE', expiresAt > now })
  │    └─ count !== 1 → 400（过期或已用）
  ├─ 写 PaymentOrder（MOCK_PAID）
  └─ 通知学生评价
```

**两条条件更新必须都在同一事务**，否则会出现"订单完成但凭证未消耗"的不一致。

---

## 9. 部署拓扑

```
                    Internet
                       │
              ┌────────▼────────┐
              │  Nginx (proxy)  │  80 / 443
              │  静态 + 反代     │
              └───┬─────────┬───┘
                  │         │
        ┌─────────▼──┐  ┌──▼─────────┐
        │  web:3000  │  │  api:3001  │
        │  Next.js   │  │  NestJS    │
        └────────────┘  └──┬──────┬──┘
                           │      │
                    ┌──────▼──┐ ┌─▼────────┐
                    │postgres │ │  redis   │
                    │  5432   │ │  6379    │
                    └─────────┘ └──────────┘
```

**端口暴露**：只有 `proxy` 映射到宿主机 80/443。`postgres` / `redis` **不对外映射**（生产 overlay 里 `ports` 被移除），`web` / `api` 仅 `expose` 给 compose 内网。

**单机约束**：当前是单机 Docker Compose，没有水平扩展。若将来需要多机：
- 静态资源要外置（S3 / CDN）
- 会话要外置（Redis，目前是 JWT 无状态，可平滑迁移）
- 数据库要做主从或托管服务
- 定时任务要加分布式锁（`tasks` 模块现在是单实例假设）
