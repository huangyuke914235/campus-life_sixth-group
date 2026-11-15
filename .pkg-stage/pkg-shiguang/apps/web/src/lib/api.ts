/** 统一 API 客户端：Cookie 登录态、统一响应解包、统一错误格式、网络异常处理。 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  timestamp: string;
  requestId: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly status: number,
    public readonly requestId = '',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 兜底必须是同源相对路径：Next 构建时会把该值内联进 bundle，
// 写成 localhost:3001 会让线上前端去请求用户自己的机器。
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
export const SESSION_EXPIRED_EVENT = 'shiguang:session-expired';
const REFRESH_PATH = '/auth/refresh';
const NO_REFRESH = new Set(['/auth/login', '/auth/register', REFRESH_PATH, '/auth/demo-accounts']);
let refreshInFlight: Promise<unknown> | undefined;
let sessionRevision = 0;

/** 读取登录时下发的 CSRF 令牌（双提交 Cookie 模式） */
function readCsrf(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return m?.[1];
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const needsCsrf = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const csrf = needsCsrf ? readCsrf() : undefined;
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (csrf) headers.set('X-CSRF-Token', csrf);
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include', // HttpOnly Cookie
      headers,
      cache: 'no-store',
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(-1, '网络连接失败，请检查网络后重试', 0);
  }
  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(-2, '服务返回格式异常', response.status);
  }
  if (!response.ok || body?.code !== 0) {
    throw new ApiError(body?.code ?? -3, body?.message ?? '请求失败', response.status, body?.requestId, body?.data);
  }
  return body.data;
}

function refreshSession() {
  refreshInFlight ??= request(REFRESH_PATH, { method: 'POST' })
    .then(() => { sessionRevision += 1; })
    .finally(() => { refreshInFlight = undefined; });
  return refreshInFlight;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const revision = sessionRevision;
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || NO_REFRESH.has(path.split('?')[0]) ||
        typeof window === 'undefined' || init.signal?.aborted) throw error;
    try {
      if (revision === sessionRevision) await refreshSession();
      return await request<T>(path, init);
    } catch (sessionError) {
      if (sessionError instanceof ApiError && sessionError.status === 401) {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
      throw sessionError;
    }
  }
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, data?: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const patch = <T>(path: string, data?: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const put = <T>(path: string, data?: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(data) });
export const upload = <T>(path: string, body: FormData) => api<T>(path, { method: 'POST', body });
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
