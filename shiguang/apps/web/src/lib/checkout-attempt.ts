import type { MealType } from '@shiguang/shared';

export interface CheckoutAttempt {
  ownerId: string;
  cartSnapshot: string;
  slotLabel: string;
  body: {
    stallId: string;
    pickupSlotId: string;
    scheduledDate: string;
    mealType: MealType;
    items: { dishId: string; quantity: number; expectedUnitPriceCents: number }[];
    idempotencyKey: string;
    expectedUserId: string;
  };
}

const storageKey = (ownerId: string) => 'shiguang-checkout:' + ownerId;

export function readCheckoutAttempt(ownerId: string): CheckoutAttempt | null {
  try {
    const attempt: CheckoutAttempt | null = JSON.parse(sessionStorage.getItem(storageKey(ownerId)) ?? 'null');
    return attempt?.ownerId === ownerId && attempt.body?.expectedUserId === ownerId
      && typeof attempt.body.idempotencyKey === 'string' && Array.isArray(attempt.body.items) ? attempt : null;
  } catch {
    return null;
  }
}

export function saveCheckoutAttempt(attempt: CheckoutAttempt) {
  try {
    sessionStorage.setItem(storageKey(attempt.ownerId), JSON.stringify(attempt));
  } catch {
    // The current page also retains the request when browser storage is unavailable.
  }
}

export function removeCheckoutAttempt(attempt: CheckoutAttempt) {
  try {
    if (readCheckoutAttempt(attempt.ownerId)?.body.idempotencyKey === attempt.body.idempotencyKey) {
      sessionStorage.removeItem(storageKey(attempt.ownerId));
    }
  } catch {
    // Storage may be unavailable in a restricted browser.
  }
}
