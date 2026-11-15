const SHOPPING_ORIGIN = 'https://shiguang.invalid';

/** Only student shopping routes and their expected parameters may survive a login. */
export function shoppingReturnPath(value: string | null): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20\x7f]/.test(value)) return;

  const target = new URL(value, SHOPPING_ORIGIN);
  if (target.origin !== SHOPPING_ORIGIN) return;

  const path = target.pathname;
  if (path === '/checkout' || /^\/orders\/[a-z0-9_-]+$/i.test(path)) return path;
  if (path === '/orders') {
    const page = target.searchParams.get('page');
    return page && /^[1-9]\d{0,8}$/.test(page) ? `${path}?page=${page}` : path;
  }
  if (/^\/review\/[a-z0-9_-]+$/i.test(path)) {
    const dishId = target.searchParams.get('dishId');
    return dishId && /^[a-z0-9_-]+$/i.test(dishId) ? `${path}?dishId=${dishId}` : path;
  }
}

export function shoppingLoginHref(returnPath: string): string {
  const target = shoppingReturnPath(returnPath);
  return target ? `/login?returnTo=${encodeURIComponent(target)}` : '/login';
}
