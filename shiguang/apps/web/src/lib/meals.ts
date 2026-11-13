import type { MealType } from '@shiguang/shared';

export const MEAL_LABELS: Record<MealType, string> = {
  BREAKFAST: '早餐',
  LUNCH: '午餐',
  DINNER: '晚餐',
};

export interface SupplyContext {
  date: string;
  mealType: MealType;
}
