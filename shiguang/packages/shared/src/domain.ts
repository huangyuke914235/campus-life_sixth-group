/**
 * 食光有数 · 前后端共享领域模型与常量
 * 本文件零外部依赖，可被 web / api / 测试直接引用。
 */

// ─────────────────────────── 枚举常量 ───────────────────────────

export const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_LABELS: Record<MealType, string> = {
  BREAKFAST: '早餐',
  LUNCH: '午餐',
  DINNER: '晚餐',
};

export const ORDER_STATUSES = [
  'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'EXPIRED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: '待确认',
  CONFIRMED: '已确认',
  PREPARING: '备餐中',
  READY: '待取餐',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
};

/** 允许的状态流转。任何非法跳转由后端拒绝。 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['PREPARING', 'CANCELLED', 'EXPIRED'],
  PREPARING: ['READY', 'CANCELLED', 'EXPIRED'],
  READY: ['COMPLETED', 'CANCELLED', 'EXPIRED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export const USER_ROLES = ['STUDENT', 'MERCHANT', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const REVIEW_SOURCES = ['VERIFIED_ORDER', 'OFFLINE'] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const RESTRICTION_KINDS = ['DISLIKE', 'ALLERGEN', 'RELIGIOUS', 'MEDICAL'] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];

// ─────────────────────── 饭后体感标签字典 ───────────────────────

export const FEELING_GROUPS = ['OVERALL', 'TASTE', 'PORTION', 'BODY'] as const;
export type FeelingGroup = (typeof FEELING_GROUPS)[number];

export interface FeelingOption {
  code: string;
  label: string;
  group: FeelingGroup;
  /** 对画像的影响方向与强度，供推荐引擎消费 */
  effect?: { key: string; delta: number };
}

/** 整体感受：单选；其余组可多选；全部可跳过。 */
export const FEELING_OPTIONS: FeelingOption[] = [
  { code: 'VERY_SATISFIED', label: '吃得很满足', group: 'OVERALL' },
  { code: 'QUITE_GOOD', label: '还不错', group: 'OVERALL' },
  { code: 'SO_SO', label: '一般般', group: 'OVERALL' },
  { code: 'DISSATISFIED', label: '不太满意', group: 'OVERALL' },

  { code: 'TOO_SPICY', label: '有点太辣', group: 'TASTE', effect: { key: 'spiceAffinity', delta: -0.10 } },
  { code: 'TOO_SALTY', label: '有点太咸', group: 'TASTE', effect: { key: 'saltSensitivity', delta: -0.10 } },
  { code: 'TOO_BLAND', label: '口味偏淡', group: 'TASTE', effect: { key: 'flavorIntensity', delta: 0.08 } },
  { code: 'TOO_OILY', label: '有点油腻', group: 'TASTE', effect: { key: 'oilToleranceInferred', delta: -0.14 } },
  { code: 'JUST_RIGHT', label: '味道刚好', group: 'TASTE', effect: { key: 'flavorIntensity', delta: 0.03 } },

  { code: 'PORTION_RIGHT', label: '份量刚好', group: 'PORTION' },
  { code: 'PORTION_SMALL', label: '没吃饱', group: 'PORTION', effect: { key: 'portionPreference', delta: 0.12 } },
  { code: 'PORTION_LARGE', label: '份量偏多', group: 'PORTION', effect: { key: 'portionPreference', delta: -0.10 } },

  { code: 'FELT_COMFORTABLE', label: '感觉舒适', group: 'BODY' },
  { code: 'THIRSTY', label: '有点口渴', group: 'BODY', effect: { key: 'saltSensitivity', delta: -0.05 } },
  { code: 'FELT_GREASY', label: '感觉比较腻', group: 'BODY', effect: { key: 'oilToleranceInferred', delta: -0.08 } },
  { code: 'UNCOMFORTABLE', label: '有些不舒服', group: 'BODY' },
];

export const FEELING_BY_CODE: Record<string, FeelingOption> = Object.fromEntries(
  FEELING_OPTIONS.map((o) => [o.code, o]),
);

/** 明确声明：主观体感不是医学诊断，过敏原以食堂公示为准。 */
export const FEELING_DISCLAIMER =
  '饭后体感为主观记录，不构成医学判断；过敏原信息可能不完整，存在交叉接触风险。';

// ─────────────────────── 推荐引擎默认配置 ───────────────────────

export interface RecommendationWeights {
  taste: number;       // 口味匹配 30%
  diet: number;        // 饮食偏好 20%
  feedback: number;    // 历史评价反馈 15%
  dishQuality: number; // 菜品综合评分 10%
  budget: number;      // 预算与价格 10%
  mealSupply: number;  // 当前餐次与供应 10%
  diversity: number;   // 新菜探索及多样性 5%
}

export const DEFAULT_WEIGHTS: RecommendationWeights = {
  taste: 0.30,
  diet: 0.20,
  feedback: 0.15,
  dishQuality: 0.10,
  budget: 0.10,
  mealSupply: 0.10,
  diversity: 0.05,
};

export const RECO_DEFAULTS = {
  learningRate: 0.12,          // 单次反馈的最大影响幅度
  decayHalfLifeDays: 30,       // 长期偏好时间衰减半衰期
  maxRepeatDays: 3,            // 避免连续多天重复推荐同一道菜
  coldStartFeedbackThreshold: 3,
  maxCommentLength: 120,
  maxResults: 3,
  minConfidenceForPersonalization: 0.1,
} as const;

export const NUTRITION_DISCLAIMER = '营养数值为示例或估算值，非实验室检测结果，不用于个体化医疗指导。';
export const PAYMENT_DISCLAIMER = '演示模式 · 到店付款；未接入真实支付、校园一卡通或第三方支付平台。';

// ─────────────────────── 领域输入类型 ───────────────────────

export interface DishCandidate {
  id: string;
  name: string;
  priceCents: number;
  category: string;
  cuisine?: string;
  tags: string[];
  ingredients: string[];
  spiceScore: number;      // 0–5
  oilScore: number;        // 0–5
  saltScore: number;       // 0–5
  sweetnessScore: number;  // 0–5
  flavorIntensity: number; // 0–5
  portionScore: number;    // 1–5
  allergens: string[];
  isVegetarian: boolean;
  verifiedDietPatterns?: readonly string[];
  isHighProtein: boolean;
  isNew: boolean;
  avgRating: number;       // 0–5
  ratingCount: number;
  isAvailable: boolean;
  stockRemaining: number;
  availableMealTypes: MealType[];
  canteenId: string;
  stallId: string;
  /** 展示用：档口名（可选） */
  stallName?: string;
  createdAt: string;       // ISO
  /** 可选：用于套餐营养合计；缺失时合计里不参与计算 */
  nutrition?: {
    energyKcal: number;
    proteinG: number;
    fatG: number;
    carbG: number;
    isEstimated: boolean;
  } | null;
}

export interface UserPreference {
  cuisines: string[];
  staplePreferences: string[];
  ingredientLikes: string[];
  ingredientDislikes: string[];
  spiceTolerance: number;  // 0–5
  sweetness: number;
  saltiness: number;
  oilTolerance: number;
  flavorIntensity: number;
  specialLikes: string[];
  budgetMinCents: number;
  budgetMaxCents: number;
  preferredCanteenIds: string[];
  preferredStallIds: string[];
  usualMealTimes: string[];
  priority: 'PRICE' | 'TASTE' | 'NUTRITION' | 'CONVENIENCE';
  adventurous: boolean;
  dietPattern: string;
}

export interface DietaryRestriction {
  kind: RestrictionKind;
  value: string;
  source: 'USER_EXPLICIT' | 'SYSTEM_INFERRED';
}

export interface TasteProfile {
  tagWeights: Record<string, number>; // 0–1，0.5 为中性
  oilToleranceInferred: number;       // 0–1
  spiceAffinity: number;
  saltSensitivity: number;
  vegetableAffinity: number;
  proteinAffinity: number;
  flavorIntensity: number;
  portionPreference: number;
  noveltyAffinity: number;
  confidence: number;
  feedbackCount: number;
  lastDecayAt: string;
}

export interface FeedbackSignal {
  dishId: string;
  rating: number;             // 1–5
  feelings: string[];
  source: ReviewSource;
  createdAt: string;
  dishTags?: string[];
  dishIngredients?: string[];
}

export interface BehaviorSignal {
  dishId?: string;
  type: 'FAVORITE_ADD' | 'FAVORITE_REMOVE' | 'ORDER_CREATE' | 'ORDER_CANCEL' | 'VIEW_DISH' | 'RECO_DISLIKE';
  createdAt: string;
  dishTags?: string[];
}

export interface RecommendationContext {
  mealType: MealType;
  date: string;              // YYYY-MM-DD
  budgetMinCents: number;
  budgetMaxCents: number;
  priceFilter?: { minCents?: number; maxCents?: number };
  preferredCanteenIds?: string[];
  wantSpicy?: boolean;
  wantLight?: boolean;
  wantValue?: boolean;
  wantSoup?: boolean;
  wantNew?: boolean;
  highProtein?: boolean;
  limit?: number;
  now: string;               // ISO，便于确定性测试
  recentRecommendedDishIds?: string[]; // 近 N 天已推荐过的菜，避免连推
}

export interface ScoreParts {
  taste: number;
  diet: number;
  feedback: number;
  dishQuality: number;
  budget: number;
  mealSupply: number;
  diversity: number;
}

export interface ScoredDish {
  dish: DishCandidate;
  rank: number;
  score: number;             // 0–1 归一化加权总分
  scoreParts: ScoreParts;
  reason: string;            // 可解释推荐理由，只引用真实数据
  matchedTags: string[];
  isColdStart: boolean;
}

export interface RejectedDish {
  dishId: string;
  reason: 'ALLERGEN' | 'DISLIKE' | 'DIET_PATTERN' | 'SOLD_OUT' | 'OFF_SHELF' | 'MEAL_MISMATCH' | 'OUT_OF_CANTEEN' | 'OUT_OF_BUDGET';
  detail: string;
}

export interface RecommendationResult {
  items: ScoredDish[];
  rejected: RejectedDish[];
  weights: RecommendationWeights;
  algorithm: string;
  coldStart: boolean;
  context: RecommendationContext;
}
