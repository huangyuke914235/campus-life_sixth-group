# API 说明

Base：`/api/v1`（Nginx 反代下为同域 `/api/v1`）
文档：`/docs`（Swagger UI，由 NestJS 自动生成）
认证：登录成功后下发 **HttpOnly Cookie**（`access_token` / `refresh_token`），也支持 `Authorization: Bearer <access>`。

## 统一响应

```json
{ "code": 0, "message": "ok", "data": {}, "timestamp": "2026-11-08T00:00:00.000Z", "requestId": "abc123" }
```

分页数据统一为 `{ "items": [], "meta": { "page", "pageSize", "total", "totalPages" } }`。

## 错误码

| code | 含义 | HTTP |
|---:|---|---|
| 0 | 成功 | 200 |
| 10001 | 参数错误 | 400 |
| 10002 | 未登录 / 登录失效 | 401 |
| 10003 | 权限不足 | 403 |
| 10004 | 数据不存在 | 404 |
| 10006 | 库存冲突 | 409 |
| 10007 | 重复评价 | 409 |
| 10008 | 重复下单 | 409 |
| 10009 | 预约时段已满 | 409 |
| 10010 | 预约时间已过 | 400 |
| 10012 | 请求过于频繁 | 429 |
| 10013 | 内容未通过审核 | 400 |
| 10014 | 取餐凭证无效 | 400 |
| 10015 | 菜品价格已更新，需重新确认 | 409 |
| 10016 | 新预约暂停 | 503 |
| 10500 | 服务异常 | 500 |

所有错误都带 `requestId`，日志按该 ID 可追踪；日志中的 `password` / `token` / `cookie` / `idempotencyKey` 已脱敏。

## 端点清单

### 认证 `/auth`
`POST /register` · `POST /login` · `POST /refresh` · `POST /logout` · `GET /me` · `GET /demo-accounts`（仅演示开关打开时返回）

### 用户 `/users`
`GET /me` · `PATCH /me` · `DELETE /me`（隐私删除请求：停用 + 撤销登录态）

### 偏好与画像 `/preferences`
`GET /` · `PUT /` · `GET /profile`（显式 vs 推断）· `POST /profile/reset`（只清推断）· `GET|POST /restrictions` · `DELETE /restrictions/:id`

### 食堂 / 档口 / 菜品 / 菜单
`GET /canteens` `GET /canteens/:id`（ADMIN 可写）
`GET /stalls` `GET /stalls/:id`
`GET /dishes?q&category&minPrice&maxPrice&tags&canteenId&stallId&page` · `GET /dishes/:id` · `POST|PATCH /dishes` · `POST /dishes/:id/off-shelf`（MERCHANT/ADMIN，档口越权拦截）
`GET /menus?date&mealType&canteenId&stallId` · `POST /menus/publish` · `POST /menus/copy-yesterday` · `PATCH /menus/items/:id` · `PATCH /menus/inventory/:id`

### 推荐 `/recommendations`
`GET /today` · `POST /query`（辣/清淡/高蛋白/尝新/预算/食堂）· `GET /explain/:dishId` · `POST /dislike/:dishId` · `GET /config` · `PUT /config`（ADMIN）

### 订单 `/orders`
`POST /`（需 `idempotencyKey`，同档口约束）· `GET /` · `GET /:id` · `POST /:id/cancel` · `POST /:id/status`（MERCHANT/ADMIN）· `GET /stall/board`

- 创建订单以 `pickupSlotId` 对应的档口、日期和餐次为准。旧客户端可提交 `stallId`、`scheduledDate` 和 `mealType`，提供的值须与时段一致。
- `items[].expectedUnitPriceCents` 接收客户端确认的单价。价格发生变化时，返回 `10015`，`data.prices` 包含各明细的 `dishId` 与最新 `unitPriceCents`。确认新报价后使用新幂等键提交。
- 同一账号使用同一幂等键重试同一请求会返回原订单。使用该键提交不同内容时返回 `10008`。新预约暂停期间，可重试已接受的订单、取消订单和核销。
- 创建订单可填 `expectedUserId`，标明发起结算的当前账号。会话账号不匹配时返回 403。网络中断后可用原请求和原幂等键重试，已创建的订单仍可找回。
- `GET /orders` 的 `page` 从 1 开始，`pageSize` 取 1–50。传入未知的 `status` 或无效分页参数时返回 400。
- 商户操作台可确认、开始备餐、标记待取或取消订单。取餐完成由核销入口登记。取消或过期释放时段名额，开始备餐前的订单同时归还库存。已备餐菜品由档口确认后另行计入可售库存。
- `GET /orders/stall/board?date=YYYY-MM-DD&stallId=...&activeOnly=true&page=1` 在分页前按授权档口与订单状态筛选，返回 `{ items, meta }`，每页最多 20 笔。待处理订单按取餐时段及下单时间排列。省略 `page` 时兼容原来的数组响应。

### 取餐 `/pickup`
`GET /slots?stallId&date&mealType` · `POST /slots`（MERCHANT/ADMIN）· `GET /orders/:orderId/token`（6 位码 + 二维码 data URL）· `POST /verify`（后端校验状态/档口/有效期，防重放）

日期、餐次和预约截止均按 `Asia/Shanghai` 计算。预约截止为时段开始时刻减去配置的提前量，凭证于时段结束时到期。

### 评价 `/reviews`
`POST /`（`orderItemId` 有值为已核验；无值走线下补评限频）· `PATCH /:id` · `DELETE /:id` · `GET /mine` · `GET /dish/:dishId` · `GET /feelings`

### 其他
`/nutrition`（菜品营养 / 单餐汇总 / 历史）· `/favorites` · `/notifications`（含 announcements、read-all）· `/analytics`（my-report、merchant/reviews、merchant/dashboard）· `/admin`（dashboard、users、announcements、reviews/:id/moderate、orders、audit-logs）· `GET /health`

## 输入校验与安全

DTO 使用 `class-validator`，全局 `ValidationPipe` 开启 `whitelist + forbidNonWhitelisted`，未声明字段直接拒绝。登录按 IP + 邮箱双键限流；刷新令牌一次性轮换；取餐核销使用条件更新（`status: ACTIVE`）保证并发下只有一次成功。

> 端点是否全部实测通过见 [PROGRESS.md](PROGRESS.md)，未运行的部分不要当作已验证。
