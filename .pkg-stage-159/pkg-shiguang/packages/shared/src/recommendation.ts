/**
 * 本地混合推荐引擎 v1 —— 食光有数的核心竞争力
 *
 * 内容匹配 + 用户画像 + 行为反馈 + 菜品质量 + 场景条件。
 * 纯函数、零外部依赖、无需任何付费 AI API，可独立单元测试。
 *
 * 硬规则：忌口 / 过敏原 / 饮食模式 / 售罄 / 下架 / 非供应餐次
 *         一律硬过滤，绝不作为加权分数处理。
 */
import {
  DEFAULT_WEIGHTS,
  RECO_DEFAULTS,
  FEELING_BY_CODE,
  type BehaviorSignal,
  type DietaryRestriction,
  type DishCandidate,
  type FeedbackSignal,
  type RecommendationContext,
  type RecommendationResult,
  type RecommendationWeights,
  type RejectedDish,
  type ScoreParts,
  type ScoredDish,
  type TasteProfile,
  type UserPreference,
} from './domain';

// ─────────────────────────── 工具函数 ───────────────────────────

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round = (v: number, digits = 4): number => Number(v.toFixed(digits));

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, ms / 86_400_000);
}

function intersection(a: string[], b: string[]): string[] {
  const set = new Set(b.map((x) => x.toLowerCase()));
  return a.filter((x) => set.has(x.toLowerCase()));
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a.map((x) => x.toLowerCase()));
  const sb = new Set(b.map((x) => x.toLowerCase()));
  if (sa.size === 0 && sb.size === 0) return 0;
  let shared = 0;
  sa.forEach((x) => { if (sb.has(x)) shared += 1; });
  return shared / (sa.size + sb.size - shared);
}

const dishFeatures = (d: DishCandidate): string[] => [
  ...d.tags, ...d.ingredients, d.category, ...(d.cuisine ? [d.cuisine] : []),
];

/** 权重总和强制归一化为 1，避免后台配置出错导致分数漂移。 */
export function normalizeWeights(input: Partial<RecommendationWeights>): RecommendationWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...input };
  const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof RecommendationWeights)[];
  const total = keys.reduce((sum, k) => sum + Math.max(0, merged[k]), 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as RecommendationWeights;
  keys.forEach((k) => { out[k] = round(Math.max(0, merged[k]) / total, 4); });
  return out;
}

export function emptyTasteProfile(now: string): TasteProfile {
  return {
    tagWeights: {},
    oilToleranceInferred: 0.5,
    spiceAffinity: 0.5,
    saltSensitivity: 0.5,
    vegetableAffinity: 0.5,
    proteinAffinity: 0.5,
    flavorIntensity: 0.5,
    portionPreference: 0.5,
    noveltyAffinity: 0.5,
    confidence: 0,
    feedbackCount: 0,
    lastDecayAt: now,
  };
}

// ─────────────────────────── 硬性过滤 ───────────────────────────

export interface HardFilterResult {
  passed: DishCandidate[];
  rejected: RejectedDish[];
}

/**
 * 忌口 / 过敏原为硬性条件：只看 USER_EXPLICIT，系统推断不得覆盖用户设置。
 */
export function hardFilter(
  dishes: DishCandidate[],
  restrictions: DietaryRestriction[],
  pref: UserPreference,
  ctx: RecommendationContext,
): HardFilterResult {
  const allergens = new Set(
    restrictions
      .filter((r) => r.kind === 'ALLERGEN' && r.source === 'USER_EXPLICIT')
      .map((r) => r.value.toLowerCase()),
  );
  const dislikes = new Set(
    restrictions
      .filter((r) => (r.kind === 'DISLIKE' || r.kind === 'RELIGIOUS' || r.kind === 'MEDICAL') && r.source === 'USER_EXPLICIT')
      .map((r) => r.value.toLowerCase()),
  );
  const explicitIngredientDislikes = new Set(pref.ingredientDislikes.map((x) => x.toLowerCase()));
  const strictVegan = pref.dietPattern === 'VEGAN';
  const strictVegetarian = strictVegan || pref.dietPattern === 'VEGETARIAN';

  const passed: DishCandidate[] = [];
  const rejected: RejectedDish[] = [];

  for (const dish of dishes) {
    const haystack = dishFeatures(dish).map((x) => x.toLowerCase());
    const hitAllergen = dish.allergens.find((a) => allergens.has(a.toLowerCase()));
    if (hitAllergen) {
      rejected.push({ dishId: dish.id, reason: 'ALLERGEN', detail: `含过敏原「${hitAllergen}」，已硬性排除` });
      continue;
    }
    const dishAllergenHit = [...allergens].find((a) => haystack.some((h) => h.includes(a)));
    if (dishAllergenHit) {
      rejected.push({ dishId: dish.id, reason: 'ALLERGEN', detail: `食材可能含「${dishAllergenHit}」，已硬性排除` });
      continue;
    }
    const hitDislike = [...dislikes, ...explicitIngredientDislikes].find(
      (d) => haystack.some((h) => h.includes(d)),
    );
    if (hitDislike) {
      rejected.push({ dishId: dish.id, reason: 'DISLIKE', detail: `含你标注的忌口「${hitDislike}」` });
      continue;
    }
    if (strictVegetarian && !dish.isVegetarian) {
      rejected.push({ dishId: dish.id, reason: 'DIET_PATTERN', detail: `与你的${strictVegan ? '纯素' : '素食'}饮食模式不符` });
      continue;
    }
    if (!dish.isAvailable || dish.stockRemaining <= 0) {
      rejected.push({ dishId: dish.id, reason: 'SOLD_OUT', detail: '已售罄或下架' });
      continue;
    }
    if (dish.availableMealTypes.length > 0 && !dish.availableMealTypes.includes(ctx.mealType)) {
      rejected.push({ dishId: dish.id, reason: 'MEAL_MISMATCH', detail: '当前餐次不供应' });
      continue;
    }
    passed.push(dish);
  }
  return { passed, rejected };
}

// ─────────────────────── 各维度归一化评分 ───────────────────────

function tasteScore(d: DishCandidate, pref: UserPreference, p: TasteProfile): { score: number; matched: string[] } {
  const features = dishFeatures(d);
  const liked = [
    ...pref.ingredientLikes,
    ...pref.cuisines,
    ...pref.staplePreferences,
    ...pref.specialLikes,
    ...Object.entries(p.tagWeights)
      .filter(([, w]) => w > 0.6)
      .map(([tag]) => tag),
  ];
  const matched = [...new Set(intersection(features, liked))];
  const coverage = liked.length > 0 ? matched.length / Math.min(liked.length, 5) : 0;

  const spicyFit = 1 - Math.abs(d.spiceScore - pref.spiceTolerance) / 5;
  const spicyAdj = clamp01(spicyFit * 0.6 + p.spiceAffinity * 0.4);
  const oilFit = 1 - Math.max(0, d.oilScore / 5 - p.oilToleranceInferred);
  const saltFit = 1 - Math.max(0, d.saltScore / 5 - p.saltSensitivity);
  const sweetFit = 1 - Math.abs(d.sweetnessScore - pref.sweetness) / 5;
  const flavorFit = 1 - Math.abs(d.flavorIntensity - pref.flavorIntensity) / 5;

  const score = clamp01(
    0.34 * coverage +
    0.22 * spicyAdj +
    0.18 * oilFit +
    0.10 * saltFit +
    0.08 * sweetFit +
    0.08 * flavorFit,
  );
  return { score, matched };
}

function dietScore(d: DishCandidate, pref: UserPreference, p: TasteProfile, ctx: RecommendationContext): number {
  const stapleHit = intersection([d.category, ...d.tags], pref.staplePreferences).length > 0 ? 1 : 0.4;
  const vegFit = d.isVegetarian ? p.vegetableAffinity : 1 - p.vegetableAffinity * 0.3;
  const proteinFit = ctx.highProtein
    ? (d.isHighProtein ? 1 : 0.25)
    : (d.isHighProtein ? 0.7 + p.proteinAffinity * 0.3 : 0.6);
  const patternFit = pref.dietPattern === 'VEGAN' || pref.dietPattern === 'VEGETARIAN'
    ? (d.isVegetarian ? 1 : 0) : 0.7;
  return clamp01(0.30 * stapleHit + 0.25 * vegFit + 0.25 * proteinFit + 0.20 * patternFit);
}

interface FeedbackSummary {
  highRatedSimilar: number;
  lowRatedSimilar: number;
  tooOilyCount: number;
  tooSaltyCount: number;
  portionSmallCount: number;
  favoriteCount: number;
  orderCount: number;
  dislikeHits: number;
  directLowRating: number; // 用户直接给「这道菜」打过低分的加权次数
  sampleCount: number;
}

function summarizeFeedback(
  d: DishCandidate,
  feedbacks: FeedbackSignal[],
  behaviors: BehaviorSignal[],
  now: string,
): FeedbackSummary {
  const features = dishFeatures(d);
  const halfLife = RECO_DEFAULTS.decayHalfLifeDays;
  const recency = (iso: string): number => 0.5 ** (daysBetween(iso, now) / halfLife);

  let highRatedSimilar = 0;
  let lowRatedSimilar = 0;
  let tooOilyCount = 0;
  let tooSaltyCount = 0;
  let portionSmallCount = 0;
  let directLowRating = 0;
  let sampleCount = 0;

  for (const f of feedbacks) {
    const w = recency(f.createdAt) * (f.source === 'VERIFIED_ORDER' ? 1 : 0.5);
    const sim = jaccard(features, [...(f.dishTags ?? []), ...(f.dishIngredients ?? [])]);
    sampleCount += w;
    if (f.dishId === d.id && f.rating <= 2) directLowRating += w;
    if (f.rating >= 4 && sim > 0) highRatedSimilar += w * (0.5 + sim);
    if (f.rating <= 2 && sim > 0) lowRatedSimilar += w * (0.5 + sim);
    if (f.feelings.includes('TOO_OILY') || f.feelings.includes('FELT_GREASY')) tooOilyCount += w;
    if (f.feelings.includes('TOO_SALTY') || f.feelings.includes('THIRSTY')) tooSaltyCount += w;
    if (f.feelings.includes('PORTION_SMALL')) portionSmallCount += w;
  }

  let favoriteCount = 0;
  let orderCount = 0;
  let dislikeHits = 0;
  for (const b of behaviors) {
    const w = recency(b.createdAt);
    if (b.type === 'FAVORITE_ADD' && b.dishId === d.id) favoriteCount += w;
    if (b.type === 'ORDER_CREATE' && b.dishId === d.id) orderCount += w;
    if (b.type === 'FAVORITE_REMOVE' && b.dishId === d.id) favoriteCount -= w;
    if (b.type === 'RECO_DISLIKE' && b.dishId === d.id) dislikeHits += w;
    if (b.type === 'RECO_DISLIKE' && b.dishTags && jaccard(features, b.dishTags) > 0.5) dislikeHits += w * 0.5;
  }
  return { highRatedSimilar, lowRatedSimilar, tooOilyCount, tooSaltyCount, portionSmallCount, favoriteCount, orderCount, dislikeHits, directLowRating, sampleCount };
}

function feedbackScore(d: DishCandidate, s: FeedbackSummary, coldStart: boolean): number {
  if (coldStart) return 0.5; // 新用户不臆造历史
  const positive = 0.5 + 0.5 * Math.tanh(s.highRatedSimilar * 0.6 + s.favoriteCount * 0.5 + s.orderCount * 0.35);
  const negative = Math.tanh(s.lowRatedSimilar * 0.7 + s.dislikeHits * 0.8);
  const oilyPenalty = Math.min(0.35, s.tooOilyCount * 0.10) * (d.oilScore / 5);
  const saltyPenalty = Math.min(0.25, s.tooSaltyCount * 0.08) * (d.saltScore / 5);
  const portionBonus = Math.min(0.12, s.portionSmallCount * 0.04) * (d.portionScore / 5);
  return clamp01(positive - negative * 0.45 - oilyPenalty - saltyPenalty + portionBonus);
}

/** 贝叶斯平滑的菜品综合评分，避免 1 条五星就冲到榜首。 */
/**
 * 贝叶斯平滑评分，返回 0–1。
 * 评分口径为 10 分制（1–10），先验取 7.0（略高于中位，避免新菜被高估）。
 */
export function bayesianRating(avgRating: number, ratingCount: number, prior = 7.0, priorWeight = 10): number {
  if (ratingCount <= 0) return prior / 10;
  return clamp01(((avgRating * ratingCount) + prior * priorWeight) / (ratingCount + priorWeight) / 10);
}

function budgetScore(d: DishCandidate, pref: UserPreference, ctx: RecommendationContext): number {
  const lo = Math.min(pref.budgetMinCents, ctx.budgetMinCents);
  const hi = Math.max(pref.budgetMaxCents, ctx.budgetMaxCents);
  if (d.priceCents >= lo && d.priceCents <= hi) return 1;
  const distance = d.priceCents < lo ? lo - d.priceCents : d.priceCents - hi;
  const tolerance = pref.priority === 'PRICE' ? 600 : 1500;
  return clamp01(1 - distance / tolerance);
}

function supplyScore(d: DishCandidate, pref: UserPreference, ctx: RecommendationContext): number {
  const canteenFit = (ctx.preferredCanteenIds?.length ?? pref.preferredCanteenIds.length) > 0
    ? ((ctx.preferredCanteenIds ?? pref.preferredCanteenIds).includes(d.canteenId) ? 1 : 0.55)
    : 0.8;
  const stallFit = pref.preferredStallIds.includes(d.stallId) ? 1 : 0.7;
  const stockFit = d.stockRemaining <= 0 ? 0 : clamp01(0.6 + 0.4 * Math.min(1, d.stockRemaining / 20));
  return clamp01(0.30 * canteenFit + 0.20 * stallFit + 0.50 * stockFit);
}

function diversityBaseScore(d: DishCandidate, pref: UserPreference, p: TasteProfile, ctx: RecommendationContext): number {
  const novelty = d.isNew ? (ctx.wantNew || pref.adventurous || p.noveltyAffinity > 0.6 ? 1 : 0.75) : 0.5;
  const freshness = clamp01(1 - daysBetween(d.createdAt, ctx.now) / 180);
  return clamp01(0.65 * novelty + 0.35 * freshness);
}

// ─────────────────────── 推荐解释生成 ───────────────────────

/** 只引用真实传入的偏好、评价、行为数据；没有数据就直说没有。 */
export function buildReason(
  d: DishCandidate,
  matched: string[],
  s: FeedbackSummary,
  pref: UserPreference,
  ctx: RecommendationContext,
  coldStart: boolean,
): string {
  const parts: string[] = [];

  if (matched.length > 0) {
    const origin = coldStart ? '你刚完成口味问卷，其中' : '你设置的偏好里';
    parts.push(`${origin}包含${matched.slice(0, 3).map((x) => `「${x}」`).join('、')}，这道菜正好命中`);
  } else if (coldStart) {
    parts.push('你刚完成口味问卷，这道菜按你填写的口味与预算匹配');
  }

  if (s.directLowRating > 0) {
    parts.push('你给这道菜打过低分，近期会先避开它');
  }

  if (!coldStart && s.highRatedSimilar >= 1) {
    parts.push(`近期有 ${Math.round(s.highRatedSimilar * 10) / 10} 条高分评价来自相似菜品`);
  }
  if (!coldStart && (s.favoriteCount > 0 || s.orderCount > 0)) {
    const n = Math.round((s.favoriteCount + s.orderCount) * 10) / 10;
    parts.push(`你收藏或点过类似菜品 ${n} 次（含时间衰减）`);
  }
  if (!coldStart && s.tooOilyCount >= 1) {
    parts.push(`你反馈过 ${Math.round(s.tooOilyCount * 10) / 10} 次「偏油」，已对高油腻度菜品降权`);
  }
  if (!coldStart && s.portionSmallCount >= 1) {
    parts.push('你提过份量偏少，已适当优先份量更足的菜品');
  }
  if (d.priceCents >= Math.min(pref.budgetMinCents, ctx.budgetMinCents) &&
      d.priceCents <= Math.max(pref.budgetMaxCents, ctx.budgetMaxCents)) {
    parts.push('价格落在你的常用预算内');
  }
  if (d.avgRating > 0 && d.ratingCount > 0) {
    parts.push(`当前均分 ${round(d.avgRating, 1)} 分（${d.ratingCount} 条评价）`);
  }

  if (parts.length === 0) {
    return '按今日供应、菜品综合评分与预算推荐；暂时还没有足够的个人反馈来生成更具体的理由。';
  }
  return `${parts.join('；')}。`;
}

// ─────────────────────── 多样性重排 (MMR) ───────────────────────

function selectDiverse(scored: ScoredDish[], limit: number, lambda = 0.28): ScoredDish[] {
  const pool = [...scored];
  const selected: ScoredDish[] = [];
  while (pool.length > 0 && selected.length < limit) {
    let bestIdx = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i];
      let maxSim = 0;
      for (const s of selected) {
        maxSim = Math.max(maxSim, jaccard(dishFeatures(candidate.dish), dishFeatures(s.dish)));
      }
      const mmr = candidate.score - lambda * maxSim;
      if (mmr > bestValue) { bestValue = mmr; bestIdx = i; }
    }
    const chosen = pool.splice(bestIdx, 1)[0];
    chosen.rank = selected.length + 1;
    selected.push(chosen);
  }
  // 多样性只决定「选哪些」，最终顺序仍按分数降序，
  // 避免出现 72% → 68% → 70% 这种看起来不单调的展示。
  selected.sort((a, b) => b.score - a.score);
  selected.forEach((s, i) => { s.rank = i + 1; });
  return selected;
}

// ─────────────────────── 主入口 ───────────────────────

export interface RecommendInput {
  dishes: DishCandidate[];
  preference: UserPreference;
  restrictions: DietaryRestriction[];
  tasteProfile: TasteProfile;
  feedbacks: FeedbackSignal[];
  behaviors: BehaviorSignal[];
  context: RecommendationContext;
  weights?: Partial<RecommendationWeights>;
}

/**
 * 冷启动判定：已核验反馈样本不足时，使用问卷偏好 + 菜品内容信息，
 * 并把「历史反馈」权重让渡给口味匹配与饮食偏好。
 */
export function isColdStart(profile: TasteProfile, feedbacks: FeedbackSignal[]): boolean {
  // 任何来源的真实评价都算「已有记录」：线下补评权重较低（0.5），
  // 但不该因为「没有已核验订单」就把一个有十几条评价的用户当作新用户。
  return profile.feedbackCount < RECO_DEFAULTS.coldStartFeedbackThreshold || feedbacks.length === 0;
}

export function recommend(input: RecommendInput): RecommendationResult {
  const { dishes, preference, restrictions, tasteProfile, feedbacks, behaviors, context } = input;
  const coldStart = isColdStart(tasteProfile, feedbacks);
  let weights = normalizeWeights(input.weights ?? {});
  if (coldStart) {
    weights = normalizeWeights({
      taste: weights.taste + 0.15,
      diet: weights.diet + 0.10,
      feedback: 0,
      dishQuality: weights.dishQuality,
      budget: weights.budget,
      mealSupply: weights.mealSupply,
      diversity: weights.diversity,
    });
  }

  const { passed, rejected } = hardFilter(dishes, restrictions, preference, context);
  const recent = new Set(context.recentRecommendedDishIds ?? []);

  const scored: ScoredDish[] = passed.map((d) => {
    const t = tasteScore(d, preference, tasteProfile);
    const s = summarizeFeedback(d, feedbacks, behaviors, context.now);
    const parts: ScoreParts = {
      taste: t.score,
      diet: dietScore(d, preference, tasteProfile, context),
      feedback: feedbackScore(d, s, coldStart),
      dishQuality: bayesianRating(d.avgRating, d.ratingCount),
      budget: budgetScore(d, preference, context),
      mealSupply: supplyScore(d, preference, context),
      diversity: diversityBaseScore(d, preference, tasteProfile, context),
    };
    let score =
      weights.taste * parts.taste +
      weights.diet * parts.diet +
      weights.feedback * parts.feedback +
      weights.dishQuality * parts.dishQuality +
      weights.budget * parts.budget +
      weights.mealSupply * parts.mealSupply +
      weights.diversity * parts.diversity;

    // 明确差评过的同一道菜：排序层做短期抑制，画像本身仍只做平滑微调。
    // 二者分离，既让「下次推荐」有可见变化，又不会因单次反馈颠覆长期偏好。
    if (s.directLowRating > 0) {
      score *= Math.max(0.65, 1 - 0.28 * s.directLowRating);
    }
    // 避免连续多天重复推荐：降权而非硬排除，保证始终有结果
    if (recent.has(d.id)) score *= 0.65;
    // 情境快捷条件
    if (context.wantSpicy && d.spiceScore < 2) score *= 0.88;
    if (context.wantLight && d.oilScore >= 4) score *= 0.82;
    if (context.highProtein && !d.isHighProtein) score *= 0.90;
    // 预算优先：超过 15 元明显降权
    if (context.wantValue && d.priceCents > 1500) score *= 0.85;
    // 想喝汤：非汤品降权
    if (context.wantSoup && d.category !== '汤品') score *= 0.70;
    // 预算优先：超过 15 元明显降权
    if (context.wantValue && d.priceCents > 1500) score *= 0.85;
    // 想喝汤：非汤品降权
    if (context.wantSoup && d.category !== '汤品') score *= 0.70;

    return {
      dish: d,
      rank: 0,
      score: round(clamp01(score)),
      scoreParts: Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [k, round(clamp01(v))]),
      ) as unknown as ScoreParts,
      reason: buildReason(d, t.matched, s, preference, context, coldStart),
      matchedTags: t.matched,
      isColdStart: coldStart,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.dish.id.localeCompare(b.dish.id));
  const items = selectDiverse(scored, context.limit ?? RECO_DEFAULTS.maxResults);

  return {
    items,
    rejected,
    weights,
    algorithm: 'local-hybrid-v1',
    coldStart,
    context,
  };
}

// ─────────────────────── 画像平滑更新 ───────────────────────

export interface TasteUpdateEvent {
  rating: number;
  feelings: string[];
  dishTags: string[];
  dishIngredients: string[];
  source: 'VERIFIED_ORDER' | 'OFFLINE';
  createdAt: string;
}

/** 时间衰减：所有推断值向中性 0.5 收敛，避免旧反馈永久主导。 */
export function applyTimeDecay(profile: TasteProfile, now: string, halfLifeDays = RECO_DEFAULTS.decayHalfLifeDays): TasteProfile {
  const days = daysBetween(profile.lastDecayAt, now);
  if (days <= 0) return profile;
  const factor = 0.5 ** (days / halfLifeDays);
  const decay = (v: number): number => 0.5 + (v - 0.5) * factor;
  const tagWeights: Record<string, number> = {};
  Object.entries(profile.tagWeights).forEach(([k, v]) => { tagWeights[k] = round(decay(v)); });
  return {
    ...profile,
    tagWeights,
    oilToleranceInferred: round(decay(profile.oilToleranceInferred)),
    spiceAffinity: round(decay(profile.spiceAffinity)),
    saltSensitivity: round(decay(profile.saltSensitivity)),
    vegetableAffinity: round(decay(profile.vegetableAffinity)),
    proteinAffinity: round(decay(profile.proteinAffinity)),
    flavorIntensity: round(decay(profile.flavorIntensity)),
    portionPreference: round(decay(profile.portionPreference)),
    noveltyAffinity: round(decay(profile.noveltyAffinity)),
    lastDecayAt: now,
  };
}

/**
 * 单次评价只做小幅平滑更新：
 *   step = learningRate * (1 - 0.5*confidence) * sourceWeight
 * 样本越多置信度越高，单次影响越小；不会推翻用户明确设置的忌口/过敏原。
 */
export function updateTasteProfile(
  profile: TasteProfile,
  event: TasteUpdateEvent,
  learningRate = RECO_DEFAULTS.learningRate,
): TasteProfile {
  let next = applyTimeDecay(profile, event.createdAt);
  const sourceWeight = event.source === 'VERIFIED_ORDER' ? 1 : 0.5;
  const step = learningRate * (1 - 0.5 * next.confidence) * sourceWeight;
  const tags = [...new Set([...event.dishTags, ...event.dishIngredients])];
  const tagWeights = { ...next.tagWeights };

  if (event.rating >= 4) {
    tags.forEach((tag) => { tagWeights[tag] = round(clamp01((tagWeights[tag] ?? 0.5) + step)); });
  } else if (event.rating <= 2) {
    tags.forEach((tag) => { tagWeights[tag] = round(clamp01((tagWeights[tag] ?? 0.5) - step)); });
  }
  // 3 星为中性，不改动标签权重

  const numeric: Record<string, number> = {
    oilToleranceInferred: next.oilToleranceInferred,
    spiceAffinity: next.spiceAffinity,
    saltSensitivity: next.saltSensitivity,
    flavorIntensity: next.flavorIntensity,
    portionPreference: next.portionPreference,
  };
  event.feelings.forEach((code) => {
    const effect = FEELING_BY_CODE[code]?.effect;
    if (!effect || !(effect.key in numeric)) return;
    numeric[effect.key] = round(clamp01(numeric[effect.key] + effect.delta * sourceWeight));
  });

  const feedbackCount = next.feedbackCount + 1;
  const confidence = round(clamp01(feedbackCount / (feedbackCount + 8)));

  next = {
    ...next,
    tagWeights,
    oilToleranceInferred: numeric.oilToleranceInferred,
    spiceAffinity: numeric.spiceAffinity,
    saltSensitivity: numeric.saltSensitivity,
    flavorIntensity: numeric.flavorIntensity,
    portionPreference: numeric.portionPreference,
    feedbackCount,
    confidence,
  };
  return next;
}

/** 重置推断画像（用户主动操作），不影响 UserPreference 与 DietaryRestriction。 */
export function resetTasteProfile(now: string): TasteProfile {
  return emptyTasteProfile(now);
}

// ─────────────────────── 扩展接口预留 ───────────────────────

export interface RecommendationProvider {
  readonly name: string;
  recommend(input: RecommendInput): RecommendationResult | Promise<RecommendationResult>;
}

/** 未来接入大模型做自然语言选餐助手，默认不启用、无密钥也能完整运行。 */
export interface LLMRecommendationProvider extends RecommendationProvider {
  readonly name: 'llm';
  withNaturalLanguageQuery(query: string): Promise<RecommendationContext>;
}

/** 未来接入向量相似度召回，作为本地候选集生成器的可替换实现。 */
export interface EmbeddingRecommendationProvider {
  readonly name: 'embedding';
  candidates(userId: string, limit: number): Promise<DishCandidate[]>;
}

export interface RecommendationExplanationProvider {
  explain(result: RecommendationResult): string | Promise<string>;
}

// ─────────────────────── 一键搭配（套餐组合） ───────────────────────

export const MEAL_STYLES = ['BALANCED', 'LIGHT', 'SPICY', 'HEARTY', 'HIGH_PROTEIN', 'HIGH_FIBER', 'LOW_SODIUM', 'LOW_CALORIE', 'VEGETARIAN'] as const;
export type MealStyle = (typeof MEAL_STYLES)[number];

export const MEAL_STYLE_LABELS: Record<MealStyle, string> = {
  BALANCED: '随便吃点',
  LIGHT: '清淡一点',
  SPICY: '想吃辣',
  HEARTY: '要管饱',
  HIGH_PROTEIN: '高蛋白',
  HIGH_FIBER: '高纤维',
  LOW_SODIUM: '低盐',
  LOW_CALORIE: '低卡',
  VEGETARIAN: '全素',
};

export type MealRole = 'STAPLE' | 'PROTEIN' | 'VEGETABLE' | 'SOUP';

export const MEAL_ROLE_LABELS: Record<MealRole, string> = {
  STAPLE: '主食',
  PROTEIN: '蛋白',
  VEGETABLE: '蔬菜',
  SOUP: '汤饮',
};

const STAPLE_CATEGORIES = new Set(['主食', '套餐', '米饭', '面食', '粉类', '快餐', '早餐']);
const SOUP_CATEGORIES = new Set(['汤品', '饮品', '甜品']);
// 汤饮甜品类不算「蛋白来源」，避免把豆浆、糖水当成主菜
const NO_PROTEIN_CATEGORIES = new Set(['汤品', '饮品', '甜品']);
const PROTEIN_HINTS = ['鸡', '牛', '猪', '鱼', '虾', '蛋', '肉', '排骨', '牛腩', '豆腐', '豆制品'];

/**
 * 一道菜可以同时承担多个角色 —— 中餐盖饭本身就是「主食 + 蛋白」，
 * 不应该被硬塞进单一角色，否则搭配会重复点两份主食。
 */
export function mealRolesOf(dish: DishCandidate): MealRole[] {
  const roles: MealRole[] = [];
  if (STAPLE_CATEGORIES.has(dish.category)) roles.push('STAPLE');
  if (SOUP_CATEGORIES.has(dish.category) && !roles.includes('SOUP')) roles.push('SOUP');

  const text = `${dish.name}${dish.tags.join('')}${dish.ingredients.join('')}`;
  const isProtein = !NO_PROTEIN_CATEGORIES.has(dish.category)
    && (dish.isHighProtein || PROTEIN_HINTS.some((h) => text.includes(h)));
  if (isProtein) roles.push('PROTEIN');

  const isVeg = dish.isVegetarian || dish.tags.some((t) => /蔬菜|时蔬|青菜|菌菇|豆|素/.test(t));
  if (isVeg) roles.push('VEGETABLE');

  return roles;
}

/** 展示用：取该菜最典型的角色。 */
export function classifyMealRole(dish: DishCandidate): MealRole | null {
  return mealRolesOf(dish)[0] ?? null;
}

function styleAllowed(dish: DishCandidate, style: MealStyle): boolean {
  if (style === 'VEGETARIAN') return dish.isVegetarian;
  if (style === 'LIGHT') return dish.oilScore <= 2 && dish.spiceScore <= 3;
  // 想吃辣：辣度至少 2 星，但排除重油（辣而不腻）
  if (style === 'SPICY') return dish.spiceScore >= 2 && dish.oilScore <= 4;
  // 高纤维：素食 / 蔬菜标签 / 轻食
  if (style === 'HIGH_FIBER') return dish.isVegetarian || dish.tags.some((t) => /蔬菜|时蔬|青菜|菌菇|粗粮|豆/.test(t));
  // 低盐：咸度 ≤ 2
  if (style === 'LOW_SODIUM') return dish.saltScore <= 2;
  // 低卡：油脂 ≤ 2 且不是油炸类
  if (style === 'LOW_CALORIE') return dish.oilScore <= 2;
  return true;
}

/** 一餐的搭配结构：几荤几素、要不要汤 —— 对应点单时「一荤一素」「两荤一素」这类说法 */
export interface MealStructure {
  /** 荤菜（蛋白）份数 */
  protein: 1 | 2;
  /** 素菜份数 */
  veg: 0 | 1 | 2;
  /** 是否加一份汤 / 饮品 */
  soup: boolean;
}

export const DEFAULT_STRUCTURE: MealStructure = { protein: 1, veg: 1, soup: true };

export interface SetMealInput extends RecommendInput {
  /** 搭配结构（推荐用法）；不传则按「一荤一素一汤」处理 */
  structure?: MealStructure;
  /** 旧的风格参数，保留向后兼容 */
  style?: MealStyle;
  /** 整餐预算（分） */
  budgetCents?: number;
}

export interface SetMealSlot {
  role: MealRole;
  /** 该菜实际承担的全部角色（盖饭通常同时是主食与蛋白） */
  roles: MealRole[];
  dish: DishCandidate;
  score: number;
  reason: string;
}

export interface SetMealResult {
  structure: MealStructure;
  style: MealStyle;
  slots: SetMealSlot[];
  totalCents: number;
  overBudget: boolean;
  /** 目标份额 */
  quota: Record<MealRole, number>;
  /** 实际配到的份额 */
  filled: Record<MealRole, number>;
  /** 没配满的角色（按缺失数量展开） */
  missingRoles: MealRole[];
  nutrition: { energyKcal: number; proteinG: number; fatG: number; carbG: number; allEstimated: boolean } | null;
  summary: string;
  rejected: RejectedDish[];
  algorithm: string;
}

/**
 * 一键搭配：在主食 / 蛋白 / 蔬菜 / 汤饮四类里各挑一道，
 * 复用单菜推荐分数排序，再按整餐预算做贪心选择（并为后续角色预留最低价格）。
 * 全程只使用真实在售菜品，硬过滤规则与单菜推荐一致。
 */
/**
 * 一键搭配：用尽量少的菜覆盖「主食 + 蛋白 + 蔬菜」，预算有余再补汤饮。
 * 单道菜可同时承担多个角色（盖饭 = 主食 + 蛋白），避免重复点两份主食。
 * 排序复用单菜推荐分数，硬过滤规则与单菜推荐完全一致。
 */
export function composeSetMeal(input: SetMealInput): SetMealResult {
  const structure = input.structure ?? DEFAULT_STRUCTURE;
  const style = input.style ?? 'BALANCED';
  const budget = input.budgetCents ?? 2500;

  const base = recommend({ ...input, context: { ...input.context, limit: 80 } });
  const scoreById = new Map(base.items.map((i) => [i.dish.id, i]));
  const pool = base.items.map((i) => i.dish).filter((d) => styleAllowed(d, style));

  const roleOrder: MealRole[] = ['STAPLE', 'PROTEIN', 'VEGETABLE', 'SOUP'];
  const quota: Record<MealRole, number> = {
    STAPLE: 1,
    PROTEIN: structure.protein,
    VEGETABLE: structure.veg,
    SOUP: structure.soup ? 1 : 0,
  };
  const filled: Record<MealRole, number> = { STAPLE: 0, PROTEIN: 0, VEGETABLE: 0, SOUP: 0 };

  const totalNeed = () => roleOrder.reduce((s, r) => s + Math.max(0, quota[r] - filled[r]), 0);

  const chosen: DishCandidate[] = [];
  let remaining = budget;

  for (let guard = 0; guard < 10; guard += 1) {
    if (totalNeed() === 0) break;

    const scored = pool
      .filter((d) => !chosen.some((c) => c.id === d.id))
      .map((d) => {
        const dishRoles = mealRolesOf(d);
        const gain = dishRoles.filter((r) => filled[r] < quota[r]).length;
        return { dish: d, dishRoles, gain, score: scoreById.get(d.id)?.score ?? 0 };
      })
      .filter((x) => x.gain > 0);

    if (scored.length === 0) break;

    scored.sort((a, b) => {
      const aAfford = a.dish.priceCents <= remaining ? 1 : 0;
      const bAfford = b.dish.priceCents <= remaining ? 1 : 0;
      if (aAfford !== bAfford) return bAfford - aAfford;
      return b.gain - a.gain || b.score - a.score;
    });

    const pick = scored[0];
    chosen.push(pick.dish);
    pick.dishRoles.forEach((r) => {
      if (filled[r] < quota[r]) filled[r] += 1;
    });
    remaining -= pick.dish.priceCents;
  }

  const missingRoles: MealRole[] = [];
  roleOrder.forEach((r) => {
    for (let k = 0; k < quota[r] - filled[r]; k += 1) missingRoles.push(r);
  });

  const slots: SetMealSlot[] = chosen.map((dish) => {
    const dishRoles = mealRolesOf(dish);
    const scored = scoreById.get(dish.id);
    return {
      role: dishRoles[0] ?? 'STAPLE',
      roles: dishRoles,
      dish,
      score: scored?.score ?? 0,
      reason: scored?.reason ?? '按今日供应与价格搭配',
    };
  });

  const totalCents = slots.reduce((s, x) => s + x.dish.priceCents, 0);
  const withNutrition = slots.filter((s) => s.dish.nutrition);
  const nutrition = withNutrition.length > 0
    ? {
        energyKcal: Math.round(withNutrition.reduce((s, x) => s + (x.dish.nutrition?.energyKcal ?? 0), 0)),
        proteinG: Math.round(withNutrition.reduce((s, x) => s + (x.dish.nutrition?.proteinG ?? 0), 0)),
        fatG: Math.round(withNutrition.reduce((s, x) => s + (x.dish.nutrition?.fatG ?? 0), 0)),
        carbG: Math.round(withNutrition.reduce((s, x) => s + (x.dish.nutrition?.carbG ?? 0), 0)),
        allEstimated: withNutrition.every((x) => x.dish.nutrition?.isEstimated ?? true),
      }
    : null;

  const structureLabel = `${structure.protein} 荤 ${structure.veg} 素${structure.soup ? ' + 汤' : ''}`;
  const nameList = slots.map((x) => x.dish.name).join(' + ');
  const summary = slots.length === 0
    ? '当前条件下没有可搭配的菜品，试试放宽预算。'
    : `${structureLabel}：${nameList}，合计 ¥${(totalCents / 100).toFixed(1)}`
      + (missingRoles.length > 0
        ? `（预算内还差${missingRoles.map((r) => MEAL_ROLE_LABELS[r]).join('、')}）`
        : '');

  return {
    structure,
    style,
    slots,
    totalCents,
    overBudget: totalCents > budget,
    quota,
    filled,
    missingRoles,
    nutrition,
    summary,
    rejected: base.rejected,
    algorithm: base.algorithm,
  };
}

/** 系统默认实现：纯本地、确定性、可解释。 */
export class LocalHybridRecommendationProvider implements RecommendationProvider {
  readonly name = 'local-hybrid-v1';
  constructor(private readonly weights?: Partial<RecommendationWeights>) {}
  recommend(input: RecommendInput): RecommendationResult {
    return recommend({ ...input, weights: input.weights ?? this.weights });
  }
}
