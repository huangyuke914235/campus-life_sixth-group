/**
 * CSRF 防护（双提交 Cookie 模式）：
 * 登录时下发可被 JS 读取的 csrf_token Cookie，前端在所有写请求里
 * 通过 X-CSRF-Token 头带回同值，服务端比对。
 *
 * 为什么不用随机 store：本项目前后端同域、Cookie 为 HttpOnly + SameSite，
 * 双提交足以阻断跨站表单提交，且无需额外会话存储。
 * 登录 / 注册 / 刷新令牌三个接口豁免（此时还没有 token）。
 */
import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS: RegExp[] = [/\/auth\/(login|register|refresh)$/];

export function csrfMiddleware(enabled: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled || SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (EXEMPT_PATHS.some((re) => re.test(path))) {
      next();
      return;
    }
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.csrf_token;
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || typeof headerToken !== 'string' || headerToken !== cookieToken) {
      res.status(403).json({
        code: 10003,
        message: 'CSRF 校验失败，请刷新页面后重试',
        data: null,
        timestamp: new Date().toISOString(),
        requestId: '',
      });
      return;
    }
    next();
  };
}
