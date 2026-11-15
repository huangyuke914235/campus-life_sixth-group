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
