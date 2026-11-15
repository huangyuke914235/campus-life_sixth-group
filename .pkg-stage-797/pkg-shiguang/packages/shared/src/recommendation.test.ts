import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  type DishCandidate,
  type FeedbackSignal,
  type RecommendationContext,
  type TasteProfile,
  type UserPreference,
} from './domain';
import {
  applyTimeDecay,
  bayesianRating,
  classifyMealRole,
  composeSetMeal,
  emptyTasteProfile,
  hardFilter,
  isColdStart,
  normalizeWeights,
  recommend,
  updateTasteProfile,
  type RecommendInput,
} from './recommendation';
import {
  assertTransition,
  calculateOrderTotal,
  canTransition,
  checkSlotBookable,
  generatePickupCode,
  validatePickup,
} from './order';

const NOW = '2026-11-07T12:00:00+08:00';

function makeDish(overrides: Partial<DishCandidate> = {}): DishCandidate {
  return {
    id: 'd_base',
    name: '基础菜品',
    priceCents: 1800,
    category: '米饭',
    cuisine: '粤菜',
    tags: ['家常菜'],
    ingredients: ['米饭'],
    spiceScore: 0,
    oilScore: 2,
    saltScore: 2,
    sweetnessScore: 0,
    flavorIntensity: 2,
    portionScore: 3,
    allergens: [],
    isVegetarian: false,
    isHighProtein: false,
    isNew: false,
    avgRating: 8.0,
    ratingCount: 20,
    isAvailable: true,
    stockRemaining: 30,
    availableMealTypes: ['LUNCH'],
    canteenId: 'c1',
    stallId: 's1',
    createdAt: '2026-10-01T00:00:00+08:00',
    ...overrides,
  };
}

const pref: UserPreference = {
  cuisines: ['粤菜', '川菜'],
  staplePreferences: ['米饭'],
  ingredientLikes: ['鸡肉', '香菇'],
  ingredientDislikes: [],
  spiceTolerance: 2,
  sweetness: 1,
  saltiness: 2,
  oilTolerance: 3,
  flavorIntensity: 3,
  specialLikes: [],
  budgetMinCents: 1500,
  budgetMaxCents: 2500,
  preferredCanteenIds: ['c1'],
  preferredStallIds: ['s1'],
  usualMealTimes: ['11:45'],
  priority: 'TASTE',
  adventurous: false,
  dietPattern: 'OMNIVORE',
};

const ctx: RecommendationContext = {
  mealType: 'LUNCH',
  date: '2026-11-07',
  budgetMinCents: 1500,
  budgetMaxCents: 2500,
  now: NOW,
  limit: 3,
};

const chickenOily = makeDish({
  id: 'd_chicken_oily', name: '香菇滑鸡饭', priceCents: 1800,
  tags: ['微辣', '鸡肉', '米饭', '家常菜'], ingredients: ['鸡肉', '香菇', '米饭'],
  spiceScore: 2, oilScore: 5, saltScore: 3, flavorIntensity: 3,
  allergens: [], isHighProtein: true, avgRating: 9.2, ratingCount: 120,
});
const lightVeg = makeDish({
  id: 'd_light_veg', name: '蒜蓉时蔬鸡胸', priceCents: 1600,
  category: '轻食', tags: ['清淡', '蔬菜', '低脂'], ingredients: ['西兰花', '鸡胸肉', '胡萝卜'],
  spiceScore: 0, oilScore: 1, saltScore: 1, flavorIntensity: 1,
  isVegetarian: false, isHighProtein: true, avgRating: 8.6, ratingCount: 80,
});
const pepperChicken = makeDish({
  id: 'd_pepper', name: '藤椒鸡丁盖饭', priceCents: 2000,
  tags: ['微辣', '鸡肉', '米饭'], ingredients: ['鸡肉', '青花椒', '米饭'],
  spiceScore: 3, oilScore: 3, saltScore: 3, flavorIntensity: 3,
  isHighProtein: true, avgRating: 8.4, ratingCount: 60,
});

const historyHigh: FeedbackSignal[] = [
  { dishId: 'd_history', rating: 5, feelings: [], source: 'VERIFIED_ORDER', createdAt: '2026-11-01T12:00:00+08:00', dishTags: ['微辣', '鸡肉', '米饭'], dishIngredients: ['鸡肉', '米饭'] },
  { dishId: 'd_history2', rating: 5, feelings: [], source: 'VERIFIED_ORDER', createdAt: '2026-10-28T12:00:00+08:00', dishTags: ['微辣', '鸡肉'], dishIngredients: ['鸡肉'] },
  { dishId: 'd_history3', rating: 4, feelings: [], source: 'VERIFIED_ORDER', createdAt: '2026-10-20T12:00:00+08:00', dishTags: ['鸡肉', '米饭'], dishIngredients: ['鸡肉', '米饭'] },
];

function experiencedProfile(): TasteProfile {
  const p = emptyTasteProfile(NOW);
  return { ...p, feedbackCount: 6, confidence: 0.43, oilToleranceInferred: 0.6, tagWeights: { 鸡肉: 0.8, 微辣: 0.75, 米饭: 0.7 } };
}

function baseInput(overrides: Partial<RecommendInput> = {}): RecommendInput {
  return {
    dishes: [chickenOily, lightVeg, pepperChicken],
    preference: pref,
    restrictions: [],
    tasteProfile: experiencedProfile(),
    feedbacks: historyHigh,
    behaviors: [],
    context: ctx,
    ...overrides,
  };
}

// ─────────────────────── 权重与评分基础 ───────────────────────

describe('权重与基础评分', () => {
  it('默认权重之和为 1', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('任意配置都会被归一化，单项不得为负', () => {
    const w = normalizeWeights({ taste: 3, diet: 3, feedback: -2 });
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 3);
    expect(w.feedback).toBe(0);
    expect(w.taste).toBeGreaterThan(w.diet - 0.001);
  });

  it('贝叶斯平滑：1 条五星不会冲到满分，大量好评才接近真实高分', () => {
    const oneReview = bayesianRating(10, 1);
    const manyReviews = bayesianRating(9.6, 500);
    expect(oneReview).toBeLessThan(0.9);
    expect(manyReviews).toBeGreaterThan(oneReview);
    expect(bayesianRating(0, 0)).toBeCloseTo(7.0 / 10, 4);
  });
});

// ─────────────────────── 硬性过滤 ───────────────────────

describe('忌口 / 过敏原 / 供应状态硬过滤', () => {
  it('用户明确设置的过敏原菜品被硬性排除，且不进入任何加权', () => {
    const peanut = makeDish({ id: 'd_peanut', name: '宫保鸡丁', allergens: ['花生'], tags: ['鸡肉'] });
    const r = hardFilter(
      [peanut, chickenOily],
      [{ kind: 'ALLERGEN', value: '花生', source: 'USER_EXPLICIT' }],
      pref, ctx,
    );
    expect(r.passed.map((d) => d.id)).toEqual(['d_chicken_oily']);
    expect(r.rejected[0].reason).toBe('ALLERGEN');
  });

  it('食材文本里出现的过敏原同样排除（食堂信息可能不完整时保守处理）', () => {
    const shrimp = makeDish({ id: 'd_shrimp', ingredients: ['虾仁', '米饭'], tags: ['海鲜'] });
    const r = hardFilter(
      [shrimp],
      [{ kind: 'ALLERGEN', value: '虾', source: 'USER_EXPLICIT' }],
      pref, ctx,
    );
    expect(r.passed).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('ALLERGEN');
  });

  it('系统推断的忌口不能覆盖用户设置，也不会被当作硬过滤', () => {
    const r = hardFilter(
      [chickenOily],
      [{ kind: 'DISLIKE', value: '鸡肉', source: 'SYSTEM_INFERRED' }],
      pref, ctx,
    );
    expect(r.passed).toHaveLength(1);
  });

  it('售罄、下架、非当前餐次一律不进入推荐', () => {
    const soldOut = makeDish({ id: 'd_sold', stockRemaining: 0 });
    const offShelf = makeDish({ id: 'd_off', isAvailable: false });
    const breakfastOnly = makeDish({ id: 'd_bf', availableMealTypes: ['BREAKFAST'] });
    const r = hardFilter([soldOut, offShelf, breakfastOnly, chickenOily], [], pref, ctx);
    expect(r.passed.map((d) => d.id)).toEqual(['d_chicken_oily']);
    expect(r.rejected.map((x) => x.reason)).toEqual(['SOLD_OUT', 'SOLD_OUT', 'MEAL_MISMATCH']);
  });

  it('素食 / 纯素饮食模式为硬性条件', () => {
    const veganPref = { ...pref, dietPattern: 'VEGAN' };
    const vegDish = makeDish({ id: 'd_veg_ok', isVegetarian: true, tags: ['蔬菜'] });
    const r = hardFilter([chickenOily, vegDish], [], veganPref, ctx);
    expect(r.passed.map((d) => d.id)).toEqual(['d_veg_ok']);
    expect(r.rejected[0].reason).toBe('DIET_PATTERN');
  });
});

// ─────────────────────── 冷启动 ───────────────────────

describe('新用户冷启动', () => {
  it('无已核验反馈时判定冷启动，历史反馈权重让渡给口味与饮食偏好', () => {
    const fresh = emptyTasteProfile(NOW);
    expect(isColdStart(fresh, [])).toBe(true);
    const result = recommend(baseInput({ tasteProfile: fresh, feedbacks: [], context: { ...ctx, limit: 2 } }));
    expect(result.coldStart).toBe(true);
    expect(result.weights.feedback).toBe(0);
    expect(result.weights.taste).toBeGreaterThan(DEFAULT_WEIGHTS.taste);
    expect(result.items.every((i) => i.isColdStart)).toBe(true);
    expect(result.items[0].reason).toContain('口味问卷');
  });

  it('解释文案只引用真实存在的偏好，不编造用户历史', () => {
    const result = recommend(baseInput({ tasteProfile: emptyTasteProfile(NOW), feedbacks: [] }));
    expect(result.items[0].reason).not.toContain('近期有');
    expect(result.items[0].reason).not.toContain('打过');
  });
});

// ─────────────────────── 闭环验收场景 C ───────────────────────

describe('验收场景 C：评价 → 画像更新 → 推荐降权', () => {
  it('初始偏好微辣鸡肉，系统优先推荐合适的鸡肉菜品', () => {
    const result = recommend(baseInput());
    expect(result.items.length).toBe(3);
    expect(result.items[0].dish.id).toBe('d_chicken_oily');
    expect(result.items[0].reason).toContain('鸡肉');
    expect(result.items[0].score).toBeGreaterThan(result.items[result.items.length - 1].score);
  });

  it('2 星 +「有点油腻」保存后，画像平滑下调且置信度提升', () => {
    const before = experiencedProfile();
    const after = updateTasteProfile(before, {
      rating: 2,
      feelings: ['TOO_OILY'],
      dishTags: chickenOily.tags,
      dishIngredients: chickenOily.ingredients,
      source: 'VERIFIED_ORDER',
      createdAt: '2026-11-07T13:00:00+08:00',
    });
    expect(after.oilToleranceInferred).toBeLessThan(before.oilToleranceInferred);
    expect(after.tagWeights['鸡肉']).toBeLessThan(before.tagWeights['鸡肉'] ?? 0.5);
    expect(after.feedbackCount).toBe(before.feedbackCount + 1);
    expect(after.confidence).toBeGreaterThan(before.confidence);
    // 单次反馈不能剧烈改变画像
    expect(before.oilToleranceInferred - after.oilToleranceInferred).toBeLessThan(0.2);
  });

  it('再次推荐时，高油腻度相似菜品得分下降幅度明显大于清淡菜', () => {
    const beforeResult = recommend(baseInput());
    const scoreOf = (r: typeof beforeResult, id: string): number =>
      r.items.find((i) => i.dish.id === id)!.score;

    const badFeedback: FeedbackSignal = {
      dishId: chickenOily.id,
      rating: 2,
      feelings: ['TOO_OILY'],
      source: 'VERIFIED_ORDER',
      createdAt: '2026-11-07T13:00:00+08:00',
      dishTags: chickenOily.tags,
      dishIngredients: chickenOily.ingredients,
    };
    const updatedProfile = updateTasteProfile(experiencedProfile(), {
      rating: 2,
      feelings: ['TOO_OILY'],
      dishTags: chickenOily.tags,
      dishIngredients: chickenOily.ingredients,
      source: 'VERIFIED_ORDER',
      createdAt: '2026-11-07T13:00:00+08:00',
    });
    const afterResult = recommend(baseInput({
      tasteProfile: updatedProfile,
      feedbacks: [...historyHigh, badFeedback],
    }));

    const chickenDrop = scoreOf(beforeResult, chickenOily.id) - scoreOf(afterResult, chickenOily.id);
    const lightDrop = scoreOf(beforeResult, lightVeg.id) - scoreOf(afterResult, lightVeg.id);
    expect(chickenDrop).toBeGreaterThan(0);
    expect(chickenDrop).toBeGreaterThan(lightDrop);
    expect(afterResult.items.find((i) => i.dish.id === chickenOily.id)!.reason).toContain('偏油');
    // 清淡菜成为更优选择
    expect(scoreOf(afterResult, lightVeg.id)).toBeGreaterThan(scoreOf(afterResult, chickenOily.id));
  });

  it('离线补评的影响小于已核验订单评价', () => {
    const base = experiencedProfile();
    const verified = updateTasteProfile(base, {
      rating: 2, feelings: ['TOO_OILY'], dishTags: ['鸡肉'], dishIngredients: [],
      source: 'VERIFIED_ORDER', createdAt: '2026-11-07T13:00:00+08:00',
    });
    const offline = updateTasteProfile(base, {
      rating: 2, feelings: ['TOO_OILY'], dishTags: ['鸡肉'], dishIngredients: [],
      source: 'OFFLINE', createdAt: '2026-11-07T13:00:00+08:00',
    });
    expect(verified.oilToleranceInferred).toBeLessThan(offline.oilToleranceInferred);
  });

  it('时间衰减让旧推断回归中性，重置只清推断不动显式偏好', () => {
    const p = { ...experiencedProfile(), lastDecayAt: '2026-09-01T12:00:00+08:00' };
    const decayed = applyTimeDecay(p, NOW);
    expect(Math.abs(decayed.tagWeights['鸡肉'] - 0.5)).toBeLessThan(Math.abs(p.tagWeights['鸡肉'] - 0.5));
    expect(decayed.confidence).toBe(p.confidence);
  });

  it('高分评价会增强相似菜品标签权重', () => {
    const base = experiencedProfile();
    const after = updateTasteProfile(base, {
      rating: 5, feelings: [], dishTags: ['鸡肉', '微辣'], dishIngredients: [],
      source: 'VERIFIED_ORDER', createdAt: '2026-11-07T13:00:00+08:00',
    });
    expect(after.tagWeights['鸡肉']).toBeGreaterThan(base.tagWeights['鸡肉'] ?? 0.5);
  });

  it('3 星为中性，不改动标签权重', () => {
    const base = experiencedProfile();
    const after = updateTasteProfile(base, {
      rating: 3, feelings: [], dishTags: ['鸡肉'], dishIngredients: [],
      source: 'VERIFIED_ORDER', createdAt: '2026-11-07T13:00:00+08:00',
    });
    expect(after.tagWeights['鸡肉']).toBeCloseTo(applyTimeDecay(base, '2026-11-07T13:00:00+08:00').tagWeights['鸡肉'] ?? 0.5, 4);
  });
});

// ─────────────────────── 多样性与场景 ───────────────────────

describe('多样性与场景条件', () => {
  it('避免连续多天重复推荐：近期推荐过的菜被降权', () => {
    const base = recommend(baseInput());
    const repeated = recommend(baseInput({ context: { ...ctx, recentRecommendedDishIds: [chickenOily.id] } }));
    const a = base.items.find((i) => i.dish.id === chickenOily.id)!.score;
    const b = repeated.items.find((i) => i.dish.id === chickenOily.id)!.score;
    expect(b).toBeLessThan(a);
  });

  it('「清淡一点」情境压低高油菜，不产生空结果', () => {
    const r = recommend(baseInput({ context: { ...ctx, wantLight: true } }));
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.find((i) => i.dish.id === lightVeg.id)!.score)
      .toBeGreaterThan(r.items.find((i) => i.dish.id === chickenOily.id)!.score * 0.8);
  });

  it('全部菜品被硬过滤时返回空结果与明确原因，而不是随机兜底', () => {
    const r = recommend(baseInput({ dishes: [makeDish({ id: 'd_x', stockRemaining: 0 })] }));
    expect(r.items).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it('每个维度得分都在 0–1 且总分有界', () => {
    const r = recommend(baseInput());
    r.items.forEach((i) => {
      expect(i.score).toBeGreaterThanOrEqual(0);
      expect(i.score).toBeLessThanOrEqual(1);
      Object.values(i.scoreParts).forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      });
    });
  });
});

// ─────────────────────── 订单领域 ───────────────────────

describe('订单金额、状态、时段与核销', () => {
  it('按分为单位计算金额并生成价格快照明细', () => {
    const r = calculateOrderTotal([
      { dishId: 'a', dishName: '香菇滑鸡饭', unitPriceCents: 1800, quantity: 1 },
      { dishId: 'b', dishName: '蒜蓉时蔬鸡胸', unitPriceCents: 1600, quantity: 2 },
    ]);
    expect(r.totalCents).toBe(5000);
    expect(r.items[1].subtotalCents).toBe(3200);
  });

  it('非法数量 / 价格 / 重复行直接抛错', () => {
    expect(() => calculateOrderTotal([{ dishId: 'a', dishName: 'x', unitPriceCents: 100, quantity: 0 }])).toThrow('INVALID_QUANTITY');
    expect(() => calculateOrderTotal([{ dishId: 'a', dishName: 'x', unitPriceCents: -1, quantity: 1 }])).toThrow('INVALID_UNIT_PRICE');
    expect(() => calculateOrderTotal([])).toThrow('EMPTY_CART');
    expect(() => calculateOrderTotal([
      { dishId: 'a', dishName: 'x', unitPriceCents: 100, quantity: 1 },
      { dishId: 'a', dishName: 'y', unitPriceCents: 100, quantity: 1 },
    ])).toThrow('DUPLICATE_DISH_LINE');
  });

  it('订单状态只允许合法流转，禁止从 COMPLETED 回退', () => {
    expect(canTransition('PENDING', 'CONFIRMED')).toBe(true);
    expect(canTransition('READY', 'COMPLETED')).toBe(true);
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'READY')).toBe(false);
    expect(() => assertTransition('COMPLETED', 'PREPARING')).toThrow('ILLEGAL_ORDER_TRANSITION');
  });

  it('时段满员 / 过截止时间 / 关闭均拒绝预约', () => {
    const slot = { date: '2026-11-07', startTime: '11:45', endTime: '12:00', capacity: 10, booked: 3, cutoffMinutes: 15, isClosed: false };
    expect(checkSlotBookable(slot, '2026-11-07T11:20:00+08:00').ok).toBe(true);
    expect(checkSlotBookable({ ...slot, booked: 10 }, '2026-11-07T11:20:00+08:00').reason).toBe('FULL');
    expect(checkSlotBookable({ ...slot, isClosed: true }, '2026-11-07T11:20:00+08:00').reason).toBe('CLOSED');
    expect(checkSlotBookable(slot, '2026-11-07T11:40:00+08:00').reason).toBe('PAST_CUTOFF');
  });

  it('取餐码核销校验状态、有效期、档口并防重放', () => {
    const base = {
      tokenStatus: 'ACTIVE' as const,
      orderStatus: 'READY' as const,
      expiresAt: '2026-11-07T12:30:00+08:00',
      orderStallId: 's1', requestStallId: 's1', now: '2026-11-07T11:50:00+08:00',
    };
    expect(validatePickup(base).ok).toBe(true);
    expect(validatePickup({ ...base, tokenStatus: 'USED' }).reason).toBe('TOKEN_NOT_ACTIVE');
    expect(validatePickup({ ...base, now: '2026-11-07T12:40:00+08:00' }).reason).toBe('TOKEN_EXPIRED');
    expect(validatePickup({ ...base, requestStallId: 's2' }).reason).toBe('STALL_MISMATCH');
    expect(validatePickup({ ...base, orderStatus: 'PENDING' }).reason).toBe('ORDER_NOT_READY');
  });

  it('取餐码固定 6 位数字', () => {
    expect(generatePickupCode(() => 0.42)).toBe('444444');
  });
});

// ─────────────────────── 一键搭配（套餐） ───────────────────────

describe('一键搭配：按角色组合 + 预算控制', () => {
  const staple = makeDish({ id: 'm_rice', name: '香菇滑鸡饭', category: '米饭', priceCents: 1800, tags: ['鸡肉', '米饭'], ingredients: ['鸡肉', '米饭'], isHighProtein: true, oilScore: 4, spiceScore: 2 });
  const stapleCheap = makeDish({ id: 'm_rice_cheap', name: '番茄鸡蛋盖饭', category: '米饭', priceCents: 1200, tags: ['鸡蛋', '米饭'], ingredients: ['鸡蛋', '米饭'], isVegetarian: true, oilScore: 2, spiceScore: 0 });
  const protein = makeDish({ id: 'm_chicken', name: '香煎鸡胸', category: '轻食', priceCents: 2000, tags: ['鸡肉', '高蛋白'], ingredients: ['鸡胸肉'], isHighProtein: true, oilScore: 1, spiceScore: 0 });
  const veg = makeDish({ id: 'm_veg', name: '白灼菜心', category: '轻食', priceCents: 900, tags: ['蔬菜', '纯素'], ingredients: ['菜心'], isVegetarian: true, oilScore: 1, spiceScore: 0 });
  const soup = makeDish({ id: 'm_soup', name: '紫菜蛋花汤', category: '汤品', priceCents: 500, tags: ['汤类'], ingredients: ['紫菜', '鸡蛋'], isVegetarian: true, oilScore: 1, spiceScore: 0 });
  const oily = makeDish({ id: 'm_oily', name: '红烧狮子头', category: '热炒', priceCents: 2200, tags: ['猪肉'], ingredients: ['猪肉'], oilScore: 5, spiceScore: 0 });

  const setInput = (overrides: Partial<Parameters<typeof composeSetMeal>[0]> = {}) => ({
    dishes: [staple, stapleCheap, protein, veg, soup, oily],
    preference: pref,
    restrictions: [],
    tasteProfile: experiencedProfile(),
    feedbacks: historyHigh,
    behaviors: [],
    context: { ...ctx, limit: 20 },
    ...overrides,
  });

  it('能识别主食 / 蛋白 / 蔬菜 / 汤饮四类角色', () => {
    expect(classifyMealRole(staple)).toBe('STAPLE');
    expect(classifyMealRole(protein)).toBe('PROTEIN');
    expect(classifyMealRole(veg)).toBe('VEGETABLE');
    expect(classifyMealRole(soup)).toBe('SOUP');
  });

  it('均衡风格覆盖主食 / 蛋白 / 蔬菜三类角色，并汇总营养', () => {
    const r = composeSetMeal(setInput({ budgetCents: 6000 }));
    const coveredRoles = new Set(r.slots.flatMap((s) => s.roles));
    expect(coveredRoles.has('STAPLE')).toBe(true);
    expect(coveredRoles.has('PROTEIN')).toBe(true);
    expect(coveredRoles.has('VEGETABLE')).toBe(true);
    expect(r.missingRoles).toEqual([]);
    expect(r.totalCents).toBe(r.slots.reduce((s, x) => s + x.dish.priceCents, 0));
    expect(r.summary).toContain('合计');
  });

  it('盖饭同时承担主食与蛋白，不会重复点两份主食', () => {
    const r = composeSetMeal(setInput({ budgetCents: 6000 }));
    const staples = r.slots.filter((s) => s.roles.includes('STAPLE'));
    expect(staples.length).toBe(1);
    expect(staples[0].roles).toContain('PROTEIN');
  });

  it('全素风格只选素食菜品', () => {
    const r = composeSetMeal(setInput({ style: 'VEGETARIAN' }));
    expect(r.slots.length).toBeGreaterThan(0);
    r.slots.forEach((s) => expect(s.dish.isVegetarian).toBe(true));
  });

  it('清淡风格排除高油腻菜品', () => {
    const r = composeSetMeal(setInput({ style: 'LIGHT' }));
    r.slots.forEach((s) => expect(s.dish.oilScore).toBeLessThanOrEqual(2));
    expect(r.slots.some((s) => s.dish.id === 'm_oily')).toBe(false);
  });

  it('预算收紧时优先保证不超支（在可行范围内）', () => {
    const r = composeSetMeal(setInput({ budgetCents: 3200 }));
    expect(r.totalCents).toBeLessThanOrEqual(3200);
    expect(r.overBudget).toBe(false);
  });

  it('预算紧张时仍给出可吃的组合', () => {
    const r = composeSetMeal(setInput({ budgetCents: 1500 }));
    expect(r.slots.length).toBeGreaterThan(0);
    expect(r.totalCents).toBe(r.slots.reduce((s, x) => s + x.dish.priceCents, 0));
  });

  it('按份额搭配：两荤一素会配到 2 个荤菜名额', () => {
    const r = composeSetMeal(setInput({ budgetCents: 9000, structure: { protein: 2, veg: 1, soup: true } }));
    expect(r.filled.PROTEIN).toBe(2);
    expect(r.filled.STAPLE).toBe(1);
    expect(r.filled.SOUP).toBe(1);
  });

  it('硬过滤同样生效：过敏原菜品不会进入套餐', () => {
    const r = composeSetMeal(setInput({
      restrictions: [{ kind: 'ALLERGEN', value: '鸡蛋', source: 'USER_EXPLICIT' }],
    }));
    r.slots.forEach((s) => expect(s.dish.allergens).not.toContain('鸡蛋'));
    expect(r.slots.some((s) => s.dish.id === 'm_soup')).toBe(false);
  });
});
