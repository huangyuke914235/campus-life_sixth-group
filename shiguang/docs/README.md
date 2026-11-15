# 文档导航

> 按「你需要做什么」找文档，不用从头读。

---

## 一、快速上手

| 我想… | 看这个 |
|---|---|
| **了解这个项目是干什么的** | [PRD.md](PRD.md) — 背景、目标用户、功能范围、成功指标 |
| **部署一套新的** | [DEPLOYMENT.md](DEPLOYMENT.md) — 从零到可访问 |
| **服务器删了/挂了，要重建** | [REBUILD-GUIDE.md](REBUILD-GUIDE.md) — 25 分钟从零拉起 |
| **接手代码继续开发** | [../HANDOVER.md](../HANDOVER.md) — 环境、账号、踩坑、核心命令 |
| **知道现在做到哪了** | [DEVELOPMENT-EXECUTION.md](DEVELOPMENT-EXECUTION.md) — 12 项任务验收状态 |
| **日常运维 / 出问题怎么查** | [OPERATIONS.md](OPERATIONS.md) — 巡检、故障速查、Q&A |
| **回顾整个项目怎么做成的** | [RETROSPECTIVE.md](RETROSPECTIVE.md) — 关键转折点与经验教训 |
| **我不懂 Web 开发，但想看懂这个项目** | [LEARNING-GUIDE.md](LEARNING-GUIDE.md) — 用餐厅类比讲清前端后端数据库 |
| **想把经验搬到下一个项目** | [LESSONS.md](LESSONS.md) — 22 张可检索的经验卡片 |

---

## 二、按角色

### 学生 / 演示者

- [USER_GUIDE.md](USER_GUIDE.md) — 注册、选餐、下单、评价的完整流程
- [PRD.md](PRD.md) 第 2 节 — 核心场景说明

### 商户 / 食堂运营

- [USER_GUIDE.md](USER_GUIDE.md) — 菜单发布、接单、核销
- [PILOT-PLAYBOOK.md](PILOT-PLAYBOOK.md) — 试点准入清单、异常处理、指标口径

### 开发者

- [ARCHITECTURE.md](ARCHITECTURE.md) — 分层、模块边界
- [ADR.md](ADR.md) — **10 条架构决策**（为什么这么选，改方向前必读）
- [DATABASE.md](DATABASE.md) — 表结构、约束、索引
- [API.md](API.md) — 接口清单与鉴权
- [RECOMMENDATION.md](RECOMMENDATION.md) — 推荐算法七维权重
- [TESTING.md](TESTING.md) — 测试策略与覆盖
- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) — 视觉规范（改 UI 前必读）

### 运维 / 管理者

- [OPERATIONS.md](OPERATIONS.md) — 每日巡检、故障处理、紧急暂停
- [DEPLOYMENT.md](DEPLOYMENT.md) — 部署与环境变量
- [../HANDOVER.md](../HANDOVER.md) 第 6 章 — 8 个已踩过的坑

### 评审 / 答辩

- [PRD.md](PRD.md) — 产品价值与设计原则
- [RECOMMENDATION.md](RECOMMENDATION.md) — 算法可解释性
- [DEVELOPMENT-EXECUTION.md](DEVELOPMENT-EXECUTION.md) — 工程严谨性证据
- [AUDIT-2026-11-11.md](AUDIT-2026-11-11.md) — 第三方审计报告（历史存档）

---

## 三、按主题

| 主题 | 文档 |
|---|---|
| **产品定位与边界** | PRD 第一、三、四节 |
| **推荐算法** | ADR-002 / RECOMMENDATION / PRD 4.1 |
| **数据模型** | DATABASE / ADR-006（菜单按天）/ ADR-007（并发） |
| **权限与安全** | ADR-004（Cookie）/ ADR-010（测试隔离）/ OPERATIONS 2.2 |
| **时区处理** | ADR-008 / OPERATIONS Q1 |
| **视觉规范** | DESIGN-SYSTEM |
| **部署与回滚** | DEPLOYMENT / OPERATIONS 第六节 |
| **测试与验收** | TESTING / DEVELOPMENT-EXECUTION 第七、八节 |

---

## 四、文档维护约定

| 文档 | 什么时候必须改 |
|---|---|
| `PRD.md` | 产品范围、目标用户、成功指标变化时 |
| `ADR.md` | 做出新的架构决策时（**追加，不改旧的**） |
| `ARCHITECTURE.md` / `DATABASE.md` / `API.md` | 代码结构、表、接口变化时 |
| `DESIGN-SYSTEM.md` | `tailwind.config.ts` 的颜色/圆角变了 |
| `OPERATIONS.md` | 发现新的故障模式时 |
| `DEVELOPMENT-EXECUTION.md` | 任务状态变化时（第八节交接记录） |
| `../HANDOVER.md` | 环境、账号、部署流程变化时 |

**原则**：文档与代码**同一次提交**里改。不要留"待更新"。

---

## 五、文档清单

| 文件 | 行数 | 定位 |
|---|---|---|
| `PRD.md` | 217 | 产品需求 |
| `ADR.md` | 199 | 架构决策记录 |
| `ARCHITECTURE.md` | 188 | 系统架构 + 模块清单 + 数据流 + 部署拓扑 |
| `RECOMMENDATION.md` | 82 | 推荐算法 |
| `DATABASE.md` | 145 | 数据模型 + 字段字典 + 常见查询 |
| `API.md` | 84 | 接口 |
| `DESIGN-SYSTEM.md` | 254 | 视觉规范 |
| `OPERATIONS.md` | 265 | 运维手册 |
| `USER_GUIDE.md` | 289 | 三角色完整操作 + FAQ |
| `PILOT-PLAYBOOK.md` | 189 | 试点准备 |
| `TESTING.md` | 173 | 测试分层、45+20 用例明细、未覆盖项 |
| `DEPLOYMENT.md` | 96 | 部署 |
| `DEVELOPMENT-ROADMAP.md` | 53 | 6 周路线图 |
| `DEVELOPMENT-EXECUTION.md` | 171 | 12 项任务执行书 |
| `CHANGELOG.md` | 234 | 开发过程（四阶段 + 16 个坑） |
| `RETROSPECTIVE.md` | 250 | **复盘**：5 个转折点、10 类教训、可迁移方法论 |
| `LEARNING-GUIDE.md` | 400 | **技术入门**：餐厅类比、请求全流程、代码导航、术语表 |
| `LESSONS.md` | 250 | **经验卡片**：22 条，按症状检索 |
| `REBUILD-GUIDE.md` | 400 | **重建指南**：建 VM→装 Docker→拉代码→配 env→恢复数据→修菜单 |
| `PROGRESS.md` | 160 | 历史进度记录 |
| `AUDIT-2026-11-11.md` | 367 | 第三方审计（存档） |
| `../HANDOVER.md` | 453 | 全量交接 |

---

*新建文档请同时更新本索引。*
