# 测试说明

> 记录测试**分层、实际用例、真实结果、未覆盖项**。数据更新于 2026-11-15。

---

## 一、当前实测结果（2026-11-15）

| 层级 | 命令 | 结果 |
|---|---|---|
| 单元测试（shared） | `corepack pnpm --filter @shiguang/shared test` | **45 passed** |
| 单元测试（api） | `corepack pnpm --filter @shiguang/api test` | **17 passed，24 skipped**（集成用例无 DB URL 时跳过） |
| 集成测试（真实 PostgreSQL） | `bash scripts/verify-integration.sh` | **20 passed / 3 files** |
| 备份恢复演练 | `bash scripts/verify-restore.sh` | **通过**（行数一致、哨兵可读） |
| 类型检查 | `pnpm -r typecheck` | **3 包 0 error** |
| E2E（Playwright） | `pnpm test:e2e` | **未运行**（需装浏览器，见第五节） |

**说明**：`shared 45` 中包含 2 条预算硬约束回归用例（2026-11-13 新增）；`api 17` 是 common 层 + 运行时校验 + 体验账号模块；`20 个集成` 需要 Docker。

---

## 二、测试分层

```
┌─────────────────────────────────────┐
│ E2E（Playwright）  ⏸ 未运行          │  浏览器全流程
├─────────────────────────────────────┤
│ 集成（真实 PostgreSQL）20 例  ✅      │  并发、事务、权限
├─────────────────────────────────────┤
│ 单元（vitest）45 + 13 例      ✅      │  算法、领域函数、common
└─────────────────────────────────────┘
```

**为什么这么分**：

| 层 | 适合测什么 | 不适合测什么 |
|---|---|---|
| 单元 | 纯函数：推荐打分、过滤、金额计算、状态机 | 数据库约束、并发 |
| 集成 | 条件更新、事务边界、权限、唯一约束 | UI 交互 |
| E2E | 用户可见的完整链路 | 边界条件（跑得慢） |

---

## 三、单元测试明细（45 例，`packages/shared`）

| 分组 | 覆盖点 | 用例数 |
|---|---|---|
| 权重与评分 | 权重和为 1、归一化、贝叶斯平滑（先验 7.0 / 权重 10） | ~6 |
| 硬过滤 | 过敏原（字段 + 食材文本）、显式忌口、系统推断不参与、售罄/下架/非餐次、素食模式 | ~9 |
| **预算约束** | 只有 `budgetMaxCents` 无 `priceFilter` 时超预算被排除；预算下限不过滤 | **2（新增）** |
| 冷启动 | 判定条件、反馈权重让渡、解释不编造历史 | ~4 |
| 验收场景 C | 初始推荐 → 2 星 +「有点油腻」→ 画像下调 → 高油菜降幅大于清淡菜 → 清淡菜反超 | ~3 |
| 学习机制 | 离线补评影响更小、时间衰减、高分增强、3 星中性 | ~5 |
| 多样性/场景 | 避免连续重复、清淡情境、空结果不随机兜底、分数有界 | ~5 |
| 订单领域 | 分为单位、价格快照、非法输入、状态机、时段容量、取餐码防重放 | ~8 |
| 套餐搭配 | 总价不超预算、缺失角色提示 | ~3 |

**api 单元（13 例）**：
- `common.test.ts`：脱敏、错误码、限流、数据边界
- `runtime-config.test.ts`：生产配置校验（JWT 密钥长度、Cookie、豁免开关）
- `demo-accounts.test.ts`：体验账号列表生成

---

## 四、集成测试明细（20 例，需要真实 PostgreSQL）

**运行方式**：
```bash
cd shiguang && bash scripts/verify-integration.sh
```
它自建一次性 postgres 容器（随机端口、库名 `shiguang_test`），跑完自动销毁。

### 4.1 订单与取餐（11 例，`orders.integration.test.ts`）

| 用例 | 断言 |
|---|---|
| 20 次同键重试 | 只创建 1 单；同键异内容返回冲突；其他账号作用域独立 |
| 20 并发抢**库存 1**、名额 20 | **只有 1 单成功**，库存不为负 |
| 20 并发抢库存 20、**名额 1** | **只有 1 单成功** |
| 拒绝错配/过期/旧价格 | 库存和名额无副作用 |
| **并发取消** | 库存只释放一次，回补不超总量 |
| 迁移前无指纹的订单重试 | 仍以历史成交价为准 |
| **并发核销** | 只成功一次，同时写支付和评价提醒 |
| 并发取码 | 得到同一凭证；另一档口无法核销 |
| **取消 vs 核销** | 只有一个终态；已备餐库存不自动回补 |
| 超时任务 | 按实际取餐截止扫描 READY；重复执行不重复释放；保留未来预约 |
| 暂停新预约 | 已有订单仍可重试、取消、核销 |

### 4.2 评价与画像（3 例，`reviews.integration.test.ts`）

- 补评限频 24 小时 3 条
- 重复评价返回冲突
- 修改/删除后均分与画像一致

### 4.3 菜品写入权限（6 例，`dishes.integration.test.ts`）

| 用例 | 断言 |
|---|---|
| 商户改自己档口 | 成功 |
| **跨档口改** | **403**，数据不变 |
| 学生调用 | 403 |
| 夹带 `stallId` | 被白名单丢弃，归属不变 |
| 夹带 `avgRating` / `ratingCount` / `status` | 被丢弃 |
| 管理员改任意档口 | 成功 |

**这组用例的意义**：`Partial<DishDto>` 在运行时是 `Object`，ValidationPipe 的 whitelist 会整体跳过——所以**类型系统挡不住**，只能靠 service 层白名单 + 这里的行为测试兜底。

---

## 五、未覆盖项（诚实记录）

| 项 | 为什么没做 | 影响 |
|---|---|---|
| **Playwright E2E** | 需 `playwright install --with-deps chromium`（下载 ~300MB），本地网络受限 | 浏览器层交互未验证；API 层已覆盖 |
| **CI（GitHub Actions）实跑** | 代码已推，但未确认 Actions 结果 | 无法证明"干净环境下可构建" |
| **真实生产备份的恢复** | 需要从 VM 导一份真实备份 | 演练用的是自造数据 |
| **CSRF 开启后的浏览器回归** | 需要浏览器 | 停用、上传、会话续期未端到端验证 |
| **性能/压力测试** | 无压测工具 | 只知道"20 并发正确"，不知道吞吐上限 |
| **暗色模式视觉回归** | 无截图对比工具 | 手动切换验证过，无自动化 |

---

## 六、如何复现

### 6.1 只跑单元测试（不需要 Docker）

```bash
cd /e/campus-life_sixth-group/shiguang
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack pnpm --filter @shiguang/shared test
corepack pnpm --filter @shiguang/api test
```

### 6.2 跑集成测试（需要 Docker）

```bash
cd /e/campus-life_sixth-group/shiguang && bash scripts/verify-integration.sh
```

**前置**：
- Docker Desktop 已启动
- 有 `postgres:16-alpine` 镜像（拉不到就用 `docker.m.daocloud.io/library/postgres:16-alpine` 再打标签）

### 6.3 跑备份恢复演练

```bash
cd /e/campus-life_sixth-group/shiguang && bash scripts/verify-restore.sh
```

---

## 七、踩过的测试相关坑

| 现象 | 根因 | 修法 |
|---|---|---|
| 集成测试全部 `skipped` | `describe.runIf(Boolean(databaseUrl))`，没设环境变量就静默跳过 | 脚本里 `export ORDER_TEST_DATABASE_URL` |
| 评价测试仍跳过 | 它用**另一个**变量 `REVIEW_TEST_DATABASE_URL` | 两个都要 export |
| 报"必须显式指向专用测试库" | 库名不匹配 `/^\/[a-z][a-z0-9_]*_test/` | 库名改成 `shiguang_test` |
| `pnpm: command not found` | 脚本里直接调 pnpm，但本机只有 corepack | 用 `./node_modules/.bin/vitest` |
| 冒烟测试用 vitest 失败 | vitest 基于 esbuild，不生成 `emitDecoratorMetadata`，NestJS 构造器注入拿到 `undefined` | 改跑 tsc 产物（`node apps/api/scripts/smoke.js`） |

---

## 八、如果继续补测试，优先做什么

1. **Playwright E2E**（最高价值）：`student-flow.spec.ts` 已写好框架，缺的是装浏览器和跑通
2. **CSRF 浏览器回归**：开启 `CSRF_ENABLED=true` 后验证停用、上传、会话续期
3. **性能基线**：下单接口的 p95 延迟、推荐接口的 p95
4. **暗色模式截图对比**：引入 Playwright 的 `toHaveScreenshot`

---

*本文档的"当前实测结果"随每次跑测试更新。若发现与实际不符，以实际输出为准。*
