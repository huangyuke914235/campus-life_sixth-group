# 食光有数 · 荔园智慧膳食服务平台

> 每一餐，都更懂你的口味。

面向高校学生、食堂商户与校园管理者的智慧餐饮服务平台。核心不是「把菜谱搬上网」，而是跑通一条**可解释、可追溯、可验证**的闭环：

```
口味偏好 → 智能选菜 → 预约取餐 → 饭后评价 → 画像更新 → 下一次推荐
```

推荐引擎是纯本地混合模型（内容匹配 + 用户画像 + 行为反馈 + 菜品质量 + 场景条件），**不依赖任何付费 AI API**；忌口与过敏原为硬性过滤，不参与加权。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 14 App Router · React 18 · TypeScript · Tailwind CSS · Radix UI · Lucide · Framer Motion · TanStack Query · Zustand · React Hook Form + Zod · Recharts · PWA manifest |
| 后端 | Node.js 22 · NestJS 10 模块化单体 · Prisma 5 · PostgreSQL 16 · Redis 7 + BullMQ 预留 · JWT + HttpOnly Cookie · Swagger |
| 工程 | pnpm workspace · Docker / Compose · Nginx · GitHub Actions · Vitest · Playwright · ESLint/Prettier 配置位 |
| 存储 | MinIO / S3 兼容接口（开发环境可用本地磁盘适配器） |

## 目录

```text
shiguang/
├── apps/api/src      # 16 个业务模块 + common（统一响应/错误/RBAC/限流/脱敏）
├── apps/web/src      # App Router 页面与可复用组件
├── packages/shared   # 前后端共享领域模型 + 本地推荐引擎（零依赖纯函数）
├── prisma            # schema.prisma（30 个模型/枚举）+ seed.ts（演示数据）
├── infra             # Dockerfile.api / Dockerfile.web / nginx.conf / nginx-ssl.conf
├── scripts           # entrypoint / 备份 / 恢复
├── docs              # 架构、数据库、API、推荐、部署、测试、用户手册、进度
├── tests/e2e         # Playwright 端到端规格
├── docker-compose.yml / docker-compose.prod.yml
├── .env.example      # 全部配置项与演示标注
└── .github/workflows/ci.yml
```

## 快速启动

**前置**：Node ≥ 20、pnpm 9、PostgreSQL 16、Redis 7。Docker 方式只需 Docker + Compose。

```bash
cd shiguang
cp .env.example .env
# 必须替换：JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / POSTGRES_PASSWORD / DEMO_PASSWORD
corepack enable && corepack prepare pnpm@9.12.0 --activate
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate dev --name init
pnpm db:seed
pnpm --filter @shiguang/shared build     # api / web 依赖 shared 的构建产物
pnpm dev                                 # web :3000 / api :3001
```

**一条命令启动完整演示环境**（含 PostgreSQL / Redis / MinIO / API / Web / Nginx）：

```bash
cp .env.example .env
docker compose up -d --build
# 访问 http://localhost ，Swagger 文档 http://localhost/docs
```

生产部署见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)，**不要直接把演示配置当生产配置**。

## 演示账号

密码统一由 `.env` 的 `DEMO_PASSWORD` 注入；未设置时 seed 会生成一次性随机密码并打印。生产必须设置 `ENABLE_DEMO_ACCOUNTS=false`。

| 角色 | 邮箱（可在 .env 覆盖） | 画像 |
|---|---|---|
| 学生 A | `student.a@demo.shiguang.local` | 微辣 · 鸡肉 · 米饭 · 15–25 元 |
| 学生 B | `student.b@demo.shiguang.local` | 清淡 · 蔬菜 · 面食 · 10–20 元（含花生 / 乳糖过敏原，硬性过滤） |
| 商户 | `merchant@demo.shiguang.local` | 被授权管理荔园一食堂两个档口 |
| 管理员 | `admin@demo.shiguang.local` | 全平台权限 |

两名学生进入推荐页会得到明显不同的结果，且每条推荐都带来自真实偏好/评价的理由。

## 核心功能

- **一键搭配**：选风格（均衡/清淡/管饱/高蛋白/全素）+ 整餐预算，自动配出「主食 + 蛋白 + 蔬菜 + 汤饮」。一道盖饭可同时承担主食与蛋白，不会重复点两份饭；预算不够时明确提示缺了哪一类。
- **智能选菜**：3 道可解释推荐，含匹配度、价格、食堂、推荐理由、负反馈入口；支持辣/清淡/高蛋白/尝新等情境。
- **全部评价**：菜品详情页可查看该菜的全部评价（评分分布、体感标签、来源区分、分页）；「评价」页是**全站评价广场**，能看到所有人对每道菜的评价，支持最新 / 最高分 / 最低分排序与「有短评」「好评」「差评」筛选，也能按食堂筛。也可直接「写评价」（线下补评，24 小时限 3 条）。
- **饭后 10 秒反馈**：真五角星评分 + 4 组结构化体感标签 + 可选短评（≤120 字），单屏完成；提交后明确告知将如何影响推荐。
- **口味画像**：显式偏好与系统推断严格分离、可重置；平滑更新 + 时间衰减 + 置信度；过敏原恒定硬过滤。
- **预约取餐**：幂等下单、Serializable 事务扣库存、时段容量、价格快照、合法状态流转、取餐码 + 二维码后端核销、取消恢复库存。
- **评价一致性**：新增/修改/删除评价后重算均分，并基于剩余全部评价**重放**画像，杜绝增量漂移；管理员隐藏只影响展示。
- **营养 / 统计 / 通知 / 后台**：营养汇总与三大营养素比例、饮食报告、站内通知、商户订单台与评价分析、管理员审核与审计日志。

## 明确的模拟与预留（不伪装成真实接入）

| 能力 | 状态 |
|---|---|
| 支付 | **演示模式 · 到店付款**，只写 `PaymentOrder(isMock=true)`，未接入微信/支付宝/校园一卡通 |
| 营养数据 | **示例估算值**，标注 `ESTIMATED` + `sourceNote`，非实验室检测 |
| 图片 | 演示占位资源 / 本地生成素材，上线需替换为食堂授权图片 |
| 通知 | 站内信可用；邮件 / 短信 / Web Push 仅预留 `NotificationProvider` 接口 |
| AI 扩展 | 预留 `LLMRecommendationProvider` / `EmbeddingRecommendationProvider` / `RecommendationExplanationProvider`，默认不启用 |
| 校园系统 | 学号绑定字段与 SSO / 一卡通接口预留，未接入 |
| 智能硬件 | 取餐柜 / 叫号屏接口预留，未接入 |

主观体感不构成医学判断；过敏原信息以食堂公示为准，存在交叉接触风险。

## 实测状态（2026-11-11 12:05）

**已真实执行并通过**

| 验证项 | 结果 |
|---|---|
| 推荐引擎 + 订单领域单测 | **36 / 36** |
| 后端 common 层单测 | **6 / 6** |
| 应用启动冒烟（编译产物 + supertest） | **6 / 6**（health / 401 / DTO 400 / 多余字段拒绝 / 演示账号不泄露 / 404 统一格式） |
| `prisma validate` | **valid** |
| `prisma generate` | **Generated Client v5.22.0** |
| `apps/api` 类型检查 | **0 error** |
| `apps/api` 构建 | **成功** |
| `apps/web` 类型检查 | **0 error** |
| `apps/web` 生产构建 | **成功，19 routes** |
| 数据库迁移 + 演示数据 | **31 张表 / 56 菜 / 108 评价** |
| 完整 Docker 栈 | **6 容器全部 healthy**（PG / Redis / API / Web / Nginx） |
| 核心闭环端到端 | **下单→接管→核销→评价→推荐降权 全部通过** |
| 前端页面 | **34 页**（学生 24 + 后台 10），`next build` 通过 |
| 评价广场 | 全站 108 条评价，最新/最高分/差评排序 + 按食堂筛选实测通过 |
| 一键搭配 | 三档预算实测：1500 元一道盖饭覆盖三角色；2500 元加一份汤 |
| 全部评价 / 写评价 | 分页列表 + 评分分布；线下补评实测由 6 条增至 7 条 |
| 图片上传 | 合法 PNG 通过；伪造文件 / GIF 均被拒；静态访问 200 |
| CSRF 双提交 | 无票 403、带票放行 |
| BullMQ 超时订单 | 已启动，每 5 分钟扫描 |
| Playwright E2E（Chromium + WebKit） | **8 / 8** |
| 生产 HTTPS | 自签证书 + HSTS，`https://localhost` 200 |

**尚未验证**：真实域名 + 公网证书的 HTTPS（本机用自签证书）、并发压力测试、通知投递队列。其余项均已在本机真实执行，命令与输出见 **[docs/PROGRESS.md](docs/PROGRESS.md)**。

## 文档索引

[架构](docs/ARCHITECTURE.md) · [数据库](docs/DATABASE.md) · [API](docs/API.md) · [推荐算法](docs/RECOMMENDATION.md) · [部署](docs/DEPLOYMENT.md) · [测试](docs/TESTING.md) · [用户手册](docs/USER_GUIDE.md) · [进度与验收](docs/PROGRESS.md)
