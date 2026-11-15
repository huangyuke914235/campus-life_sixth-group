# 推荐算法说明

实现位置：`packages/shared/src/recommendation.ts`（零依赖纯函数，27 个单元测试覆盖）。

## 1. 硬性过滤（不参与打分）

任何一条命中即排除，并返回拒绝原因：

| 条件 | 说明 |
|---|---|
| `ALLERGEN` | 用户**明确设置**的过敏原；菜品 `allergens` 或食材文本命中都排除（信息不完整时保守处理） |
| `DISLIKE` / `RELIGIOUS` / `MEDICAL` | 用户明确忌口；**系统推断值不参与硬过滤** |
| `DIET_PATTERN` | 素食 / 纯素模式下排除非素菜 |
| `SOLD_OUT` | 下架或库存 ≤ 0 |
| `MEAL_MISMATCH` | 非当前餐次供应 |

## 2. 七维归一化评分

```
score = Σ wᵢ · sᵢ      (sᵢ ∈ [0,1], Σwᵢ = 1)
```

| 维度 | 默认权重 | 计算要点 |
|---|---:|---|
| 口味匹配 `taste` | 30% | 标签命中覆盖 34% + 辣度拟合 22% + 油腻容忍 18% + 咸/甜/浓郁各 10%/8%/8% |
| 饮食偏好 `diet` | 20% | 主食偏好、素食契合、高蛋白需求、饮食模式 |
| 历史反馈 `feedback` | 15% | 相似菜品高分正向（tanh 饱和）、低分负向、`TOO_OILY`/`TOO_SALTY` 按菜品油/盐度加权惩罚、`PORTION_SMALL` 正向、收藏/点餐频次 |
| 菜品质量 `dishQuality` | 10% | 贝叶斯平滑 `(avg·n + 3.6·10)/(n+10)/5`，避免 1 条五星冲榜 |
| 预算 `budget` | 10% | 区间内为 1；越界按距离线性衰减（`priority=PRICE` 时更敏感） |
| 餐次供应 `mealSupply` | 10% | 偏好食堂/档口契合 + 库存充足度 |
| 多样性 `diversity` | 5% | 新菜 + 尝新倾向 + 上架新鲜度 |

权重可由 `PUT /recommendations/config` 覆盖，**写入前强制归一化**，单项不得为负。

## 3. 冷启动

判定：`feedbackCount < 3` **或**没有任何已核验订单评价。
处理：`feedback` 权重置 0，让渡给 `taste`(+0.15) 与 `diet`(+0.10)，再归一化；解释文案改为引用问卷偏好（「你刚完成口味问卷，其中包含…」），**不编造历史**。

## 4. 反馈学习（平滑 + 衰减 + 置信度）

```
step = learningRate(0.12) × (1 − 0.5 × confidence) × sourceWeight
confidence = n / (n + 8)
sourceWeight = 1（已核验订单）/ 0.5（线下补评）
```

- 4–5 星增强该菜全部标签权重；1–2 星降低；**3 星中性不动**。
- 体感标签映射：`TOO_OILY −0.14`、`FELT_GREASY −0.08`、`TOO_SALTY −0.10`、`THIRSTY −0.05`、`TOO_BLAND +0.08`、`PORTION_SMALL +0.12`、`PORTION_LARGE −0.10`。
- 每次更新前先做**时间衰减**：所有推断值按半衰期 30 天向中性 0.5 收敛。
- 因此单次反馈影响有限（单次油腻容忍度下降 < 0.2），且旧反馈不会永久主导。

## 5. 排序层短期抑制（与画像分离）

用户对**同一道菜**打低分时，总分乘 `max(0.65, 1 − 0.28n)`。这是排序层的短期响应，不修改画像——既保证「下次推荐」有可见变化，又不违背「单次反馈不推翻长期偏好」。

其他乘性调整：近 3 天已推荐过的菜 `×0.65`；`wantSpicy` 且辣度 < 2 `×0.88`；`wantLight` 且油 ≥ 4 `×0.82`；`highProtein` 但非高蛋白 `×0.90`。

## 6. 多样性与重复控制

选出得分最高的菜后，用 MMR（`score − 0.28 × max Jaccard 相似度`）逐轮重排，避免 3 条结果全是同类盖饭。近 N 天推荐过的菜降权而非硬排除，保证任何情况下都有结果（除非全被硬过滤，此时返回空 + 明确原因，不做随机兜底）。

## 7. 可解释理由

`buildReason` 只引用**传入的真实数据**：命中的问卷标签、近期高分相似条目数、收藏/点餐次数、偏油反馈次数、份量反馈、是否在预算内、当前均分与评价数。数据不足时明确说明「暂时还没有足够的个人反馈」，不生成「你一定会喜欢」这类断言。

## 8. 扩展接口

```ts
RecommendationProvider        // 默认 LocalHybridRecommendationProvider
LLMRecommendationProvider     // 自然语言选餐助手（未启用）
EmbeddingRecommendationProvider // 向量召回候选集（未启用）
RecommendationExplanationProvider // 大模型解释改写（未启用）
```

配置 `RECO_PROVIDER=local` 为出厂值，**未配置任何 API Key 也能完整运行**。

## 9. 已知局限

- 相似度为标签/食材 Jaccard，未做语义向量，同义食材（「鸡腿肉」vs「鸡肉」）可能漏匹配。
- 营养维度尚未进入推荐（营养素比值仅用于展示），后续可加为第 8 维。
- 未做在线 A/B 与曝光偏差校正；`RecommendationItem.wasClicked` 已留字段，可用于后续离线评估。
