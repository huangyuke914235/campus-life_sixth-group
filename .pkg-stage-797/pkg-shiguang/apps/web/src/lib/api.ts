/** 统一 API 客户端：Cookie 登录态、统一响应解包、统一错误格式、网络异常处理。 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  timestamp: string;
  requestId: string;
}

export class ApiError extends Error {
  constructor(public readonly code: number, message: string, public readonly status: number, public readonly requestId = '') {
    super(message);
    this.name = 'ApiError';
  }
}

// 兜底必须是同源相对路径：Next 构建时会把该值内联进 bundle，
// 写成 localhost:3001 会让线上前端去请求用户自己的机器。
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

/** 读取登录时下发的 CSRF 令牌（双提交 Cookie 模式） */
function readCsrf(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const needsCsrf = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const csrf = needsCsrf ? readCsrf() : undefined;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include', // HttpOnly Cookie
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(-1, '网络连接失败，请检查网络后重试', 0);
  }
  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(-2, '服务返回格式异常', response.status);
  }
  if (!response.ok || body.code !== 0) {
    throw new ApiError(body.code ?? -3, body.message ?? '请求失败', response.status, body.requestId);
  }
  return body.data;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, data?: unknown) => api<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined });
export const patch = <T>(path: string, data?: unknown) => api<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined });
export const put = <T>(path: string, data?: unknown) => api<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export const endpoints = {
  me: '/users/me',
  login: '/auth/login',
  register: '/auth/register',
  logout: '/auth/logout',
  demoAccounts: '/auth/demo-accounts',
  todayRecommendation: '/recommendations/today',
  queryRecommendation: '/recommendations/query',
  explain: (dishId: string) => `/recommendations/explain/${dishId}`,
  dislike: (dishId: string) => `/recommendations/dislike/${dishId}`,
  preferences: '/preferences',
  tasteProfile: '/preferences/profile',
  resetProfile: '/preferences/profile/reset',
  restrictions: '/preferences/restrictions',
  menus: (date: string, mealType?: string) => `/menus?date=${date}${mealType ? `&mealType=${mealType}` : ''}`,
  dish: (id: string) => `/dishes/${id}`,
  orders: '/orders',
  order: (id: string) => `/orders/${id}`,
  pickupToken: (orderId: string) => `/pickup/orders/${orderId}/token`,
  pickupSlots: (stallId: string, date: string, mealType: string) => `/pickup/slots?stallId=${stallId}&date=${date}&mealType=${mealType}`,
  createReview: '/reviews',
  myReviews: '/reviews/mine',
  feelings: '/reviews/feelings',
  favorites: '/favorites',
  notifications: '/notifications',
  myReport: '/analytics/my-report',
  nutritionHistory: '/nutrition/history',
};
