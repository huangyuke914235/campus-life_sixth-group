export function validateRuntimeConfig(env: Record<string, unknown>): Record<string, unknown> {
  if (env.NODE_ENV !== 'production') return env;

  const invalid: string[] = [];
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = env[key];
    if (typeof value !== 'string' || value.trim().length < 32 || /change[_ -]?me|replace[_ -]?me|^demo|^example/i.test(value)) {
      invalid.push(key);
    }
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) invalid.push('JWT_ACCESS_SECRET/JWT_REFRESH_SECRET');
  // 评审平台只接受 IP 链接时，站点只能走 HTTP，浏览器不接受 Secure Cookie。
  // 这种情况必须显式声明 ALLOW_INSECURE_HTTP=true 才能豁免，避免"偷偷放宽"变成默认。
  const allowInsecureHttp = env.ALLOW_INSECURE_HTTP === 'true';
  for (const key of ['COOKIE_SECURE', 'CSRF_ENABLED']) {
    if (key === 'COOKIE_SECURE' && allowInsecureHttp) continue;
    if (env[key] !== 'true') invalid.push(key);
  }
  if (allowInsecureHttp) {
    // eslint-disable-next-line no-console
    console.warn('[runtime-config] ALLOW_INSECURE_HTTP=true：已豁免 Secure Cookie 要求，仅适用于纯 HTTP 演示环境，正式上线请改回 HTTPS');
  }
  // 演示期间需要让评委一键登录，所以体验账号开关要允许显式豁免；
  // SEED_DEMO_DATA 没有豁免口子——它会清库，任何环境都不接受。
  const allowDemoAccounts = env.ALLOW_DEMO_ACCOUNTS === 'true';
  if (env.SEED_DEMO_DATA === 'true') invalid.push('SEED_DEMO_DATA');
  if (env.ENABLE_DEMO_ACCOUNTS === 'true' && !allowDemoAccounts) invalid.push('ENABLE_DEMO_ACCOUNTS');
  if (allowDemoAccounts) {
    // eslint-disable-next-line no-console
    console.warn('[runtime-config] ALLOW_DEMO_ACCOUNTS=true：体验账号保持开启，仅用于演示环境');
  }
  if (invalid.length > 0) throw new Error(`Unsafe production configuration: ${invalid.join(', ')}`);
  return env;
}
