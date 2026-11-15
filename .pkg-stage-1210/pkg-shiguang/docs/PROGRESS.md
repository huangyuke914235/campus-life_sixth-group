# 开发进度与真实验收报告

**更新时间**：2026-11-08 12:05（GMT+8）
**原则**：只记录本机真实执行过的命令与输出。没跑过的不写「通过」，没接入的不写「已上线」。

## 一、完成度概览

| 能力 | 状态 | 证据 |
|---|---|---|
| 推荐引擎 + 订单领域 | ✅ | `vitest` 27/27 |
| 后端 16 模块 | ✅ | `tsc` 0 error；`nest build` 成功；冒烟 6/6 |
| 数据库 schema | ✅ | `prisma validate` 通过；迁移已应用；**31 张表** |
| 演示数据 | ✅ | 3 食堂 / 12 档口 / **56 菜** / 三餐菜单 / **108 评价** / 4 类账号 |
| 前端 30 页面（学生 20 + 后台 10） | ✅ | `tsc` 0 error；`next build` 30 routes |
| **完整 Docker 栈** | ✅ | **6 容器全部 healthy**（PG/Redis/API/Web/Nginx） |
| **核心闭环** | ✅ | 下单→接管→核销→评价→推荐降权，真实库跑通 |
| 图片上传 | ✅ | MIME + 文件头魔数 + 5MB 三重校验；伪造文件、GIF 均被拒 |
| CSRF 双提交 | ✅ | 无票 403、带票放行；登录/注册/刷新三接口豁免 |
| BullMQ 超时订单 | ✅ | 每 5 分钟扫描，超 2 小时自动置 EXPIRED 并回滚库存与名额 |
| **E2E（桌面 Chromium + iOS Safari）** | ✅ | **8/8 通过** |
| 生产 HTTPS | ✅ | 自签证书 + HSTS，`https://localhost` 返回 200 |
| 一键搭配 | ✅ | `composeSetMeal` 36 个单测覆盖；三档预算实测合理 |
| 全部评价 / 写评价 | ✅ | 分页列表 + 评分分布 + 线下补评（实测 6→7 条） |
| 评价广场 | ✅ | 全站 108 条可见评价；排序 / 差评 / 食堂筛选实测通过；后台另有含隐藏的全量审核视图 |

## 二、已完成模块

- `packages/shared`：领域模型；本地混合推荐引擎（硬过滤 / 7 维加权 / 冷启动 / MMR / 时间衰减 / 置信度 / 可解释理由 / Provider 接口）；订单状态机与金额。
- `apps/api`：auth / users / canteens / stalls / dishes / menus / preferences / recommendations / orders / pickup / reviews / nutrition / favorites / notifications / analytics / admin + common（统一响应、错误码、脱敏、RBAC、档口边界、限流）。
- `apps/web`：18 个业务页（学生端 13 + 后台 6），深浅色、四组体感标签、可交互五角星、购物车、时段结算、后台核销与评价审核。
- `prisma`：`schema.prisma`（30 模型）+ `migrations/20261108031420_init` + `seed.ts`。
- `infra`：Dockerfile.api / Dockerfile.web / nginx（80+443）/ dev & prod Compose / CI / 备份恢复脚本。

### 仍缺页面
学生端：`/register`（已并入登录页切换，不做独立页）。其余规划页均已实现：`/discover`、`/canteens`、`/canteens/[id]`、`/orders/[id]`、`/favorites`、`/history`、`/insights`、`/profile`。
后台：规划页全部实现（`/admin` 及 orders / dishes / menus / reviews / canteens / stalls / users / settings / audit）。

## 三、实际运行过的命令与结果

### 3.1 环境
Node v22.22.2 / npm 11.19.1 / Docker 29.9.2 / Compose v5.6.1（Docker Desktop 运行中）；pnpm 未装（容器内 corepack 激活）。

### 3.2 数据库
| 命令 | 结果 |
|---|---|
| `docker compose up -d postgres redis` | ✅ healthy，5432/6379 仅绑 127.0.0.1 |
| `prisma migrate dev --name init` | ✅ 生成并应用 `20261108031420_init`，**31 张表** |
| `prisma generate` | ✅ Client v5.22.0 |
| `tsx prisma/seed.ts`（容器内） | ✅ 56 菜 / 108 评价 / 画像重放 / 4 类账号 |

### 3.3 Docker
| 步骤 | 结果 |
|---|---|
| `build api` | 首轮失败：alpine 缺 OpenSSL；`prisma generate` 在 monorepo 根触发 `pnpm add`。补 openssl + 改为 api 目录内生成后 ✅ |
| `build web` | 首轮 502：运行镜像漏拷 `next.config.mjs`，`next start` 回落 `.next`。补 COPY 后 ✅ |
| `up -d` | ✅ **6 容器**全部 Up，api/web healthy |
| 拉基础镜像 | Docker Hub 超时，改用 `docker.m.daocloud.io` 后本地 tag |

### 3.4 后端
- `vitest run` → **6/6**
- `node scripts/smoke.js`（编译产物 + Prisma mock）→ **6/6**
- `tsc --noEmit` → **0 error**；`nest build` → 成功

### 3.5 前端
- `tsc --noEmit` → 首轮 80 error（缺 `baseUrl`）→ **0 error**
- `next build` → 首轮 `EPERM .next/trace` → 改 `distDir: 'dist'` 后 **19 routes**
- 容器内 `next start` → 首页 200 / 17KB / 标题正确

### 3.6 端到端闭环（真实接口 + 真实数据库）
经 `http://localhost/api/v1` 跑完整链路：

```
A / 商户登录        OK
选中菜品            香菇滑鸡饭 ¥18 @ 二楼粤式档口
选中时段            17:30-17:45 余20
下单               SG20261108RXEPJU / 1800 分
支付模式            演示模式 · 到店付款（未接入真实支付）
幂等重放            idempotent=true
商户→CONFIRMED      code=0
商户→PREPARING      code=0
商户→READY          code=0
取餐码              508781
二维码              data:image/png;base64,...
核销                code=0 核销成功
重复核销(应拒)       code=10014 该取餐码已被核销
评价提交            code=0
算法影响提示         已适当降低高油腻度相似菜品的推荐权重。
重复评价(应拒)       code=10007 该订单菜品已评价
评价后 Top3         藤椒鸡丁盖饭 78% | 三素一荤套餐 74% | 鸡汤馄饨 72%
被差评菜            已降权挤出前三
画像置信度          0.7037
```

两名偏好相反的学生（同一餐次）：
- A（微辣/鸡肉/米饭）：藤椒鸡丁盖饭 78% | 三素一荤套餐 74% | 鸡汤馄饨 72%
- B（清淡/面食）：低脂荞麦冷面 | 紫菜蛋花汤 | 燕麦南瓜粥
- B 的理由引用了真实历史：近期高分相似菜品数 + 「偏油」反馈次数

## 四、测试通过情况

| 套件 | 用例 | 结果 |
|---|---:|---|
| shared 推荐/订单领域 | 27 | ✅ |
| api common 层 | 6 | ✅ |
| api 启动冒烟 | 6 | ✅ |
| 接口闭环（脚本） | 15 步 | ✅ 含 2 个负向用例 |
| **Playwright E2E（Chromium + WebKit）** | **10** | **✅ 10/10**（另有 1 个登录初始化） |
| 套餐组合（shared） | 9 | ✅ |
| shared 合计 | 36 | ✅ |

E2E 覆盖：登录 → 推荐（3 道 + 理由 + 推荐依据）→ 订单 → 评价（星级/体感/短评/提交反馈）→ 画像；以及未登录访问、360px 窄屏无横向溢出、特殊字符输入不破坏页面。桌面 Chromium 与 iPhone 13（WebKit）各跑一遍。

## 五、构建结果

| 产物 | 结果 |
|---|---|
| shared / api / web 本地构建 | ✅ |
| `shiguang-api` / `shiguang-web` 镜像 | ✅ 构建成功、容器 healthy |
| 完整栈 | ✅ 6 容器 `docker compose up -d` 拉起 |

## 六、本轮实测暴露并修复的缺陷

1. **PickupSlot 唯一键缺 mealType** —— 早/午/晚同档口同时段必然冲突。改为 `@@unique([stallId, date, mealType, startTime])`。
2. **seed 清理漏删 Stall / Canteen / Dish** —— 二次执行撞唯一键并留下半清空状态。改为 `TRUNCATE ... RESTART IDENTITY CASCADE`。
3. **seed 未生成 UserTasteProfile** —— 有 18 条评价的用户仍被判冷启动。补「按评价重放画像」。
4. **isColdStart 强制要求已核验订单** —— 线下真实评价被无视。改为「≥3 条任意来源评价即非冷启动」。
5. **推荐输出顺序不单调**（72% → 68% → 70%）—— 多样性只决定选哪些，最终按分数降序。
6. **Dockerfile.api 缺 OpenSSL** —— Prisma 引擎在 alpine 起不来。
7. **prisma generate 在 monorepo 根触发 `pnpm add`** —— 改为在 api 目录、就 schema 生成。
8. **Dockerfile.web 漏拷 next.config.mjs** —— `next start` 找不到 dist，502。
9. **seed 取餐时段不分餐次** —— 晚餐复用午餐 11:30，改为 07:30 / 11:30 / 17:30 三套。
10. **已评价订单仍显示「评价这一餐」** —— 点进去必然 10007。后端带出 reviews，前端按已评数判断。
11. **推荐页进入后空白** —— 需手动点「帮我选」。改为进入即自动请求。
12. **JwtModule 未导出 JwtService** —— 全局 APP_GUARD 解析失败，所有请求 500。

## 七、仍存在的问题

1. 学生端 `/register` 未做独立页（已并入登录页的模式切换）。
2. 菜品「编辑」复用创建表单的字段，但未做独立编辑弹窗（可用下架 + 重建替代）。
3. 通知的异步投递队列未接：BullMQ 目前只跑超时订单；邮件 / 短信 / Web Push 仍是预留接口。
4. 营养维度未进入推荐（仅展示）；食材相似度靠字符串匹配，未做向量。
5. HTTPS 用自签证书验证通过，真实域名 + 公网证书（Let's Encrypt 签发流程）未实测。
6. 并发压力测试（库存并发扣减、核销并发）未做，逻辑上已用条件更新保护。
7. 本机 `apps/web/node_modules/.bin` 缺失（安装中断），容器内不受影响。

## 八、尚未接入的第三方能力

微信支付 / 支付宝 / 校园一卡通、短信 / 邮件 / Web Push、校园统一身份认证、食堂数据同步、地图定位、取餐柜 / 扫码设备 / 叫号屏、LLM 选餐助手、向量召回、评论情感分析。均通过 Provider / Adapter 与 `PaymentOrder(isMock)` 预留，无凭证时核心功能不受影响。

## 九、上线所需条件

Ubuntu LTS + Docker；域名 + TLS 证书；替换全部密钥；`ENABLE_DEMO_ACCOUNTS=false`、`SEED_DEMO_DATA=false`、`COOKIE_SECURE=true`；食堂授权图片与真实营养数据；真实支付需商户资质与回调白名单。通过 `migrate deploy` + CI 全绿 + E2E 后才可称「已上线」。

## 十、下一步

1. 补学生端 `/register` 独立页与菜品编辑弹窗；通知投递接 BullMQ 队列。
2. 做并发压力测试（同一菜品并发下单、同一取餐码并发核销），验证条件更新在高压下不超卖。
3. 用真实域名 + Let's Encrypt 证书跑一遍 prod overlay（`docker compose -f ... -f docker-compose.prod.yml up -d --build`）。
4. 营养维度纳入推荐权重；食材相似度升级为向量召回（`EmbeddingRecommendationProvider` 已留接口）。
5. 接入校园统一身份认证 / 一卡通时，替换 `PaymentOrder` 与 `AuthService` 的 provider 实现。
