'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { get, post, endpoints, ApiError } from '@/lib/api';
import { shoppingReturnPath } from '@/lib/shopping-return';

const schema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少 8 位'),
});
type FormValues = z.infer<typeof schema>;

interface DemoAccount { email: string; label: string; role: string }

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema), defaultValues: { email: '', password: '' },
  });

  const demo = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: () => get<{ enabled: boolean; notice: string; accounts: DemoAccount[] }>(endpoints.demoAccounts),
  });

  const submit = useMutation({
    mutationFn: (values: FormValues & { displayName?: string }) =>
      mode === 'login'
        ? post<{ role: string }>(endpoints.login, values)
        : post<{ role: string }>(endpoints.register, { ...values, displayName: values.email.split('@')[0] }),
    // 注册后先去设置口味，否则进去就是冷启动，推荐没有依据
    onSuccess: ({ role }) => {
      qc.clear();
      const returnTo = shoppingReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
      router.replace(mode === 'register' ? '/onboarding' : role === 'STUDENT' ? returnTo ?? '/dashboard' : '/admin');
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '登录失败，请稍后重试'),
  });

  return (
    <main className="mx-auto min-h-screen max-w-md px-6 pb-16 pt-12">
      <Link href="/" className="text-xs text-muted">← 返回首页</Link>
      <div className="mt-8 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange text-lg font-bold text-white">食</div>
        <div><p className="text-xl font-bold">食光有数</p><p className="text-xs text-muted">荔园智慧膳食服务平台</p></div>
      </div>
      <h1 className="mt-8 text-2xl font-bold">{mode === 'login' ? '欢迎回来' : '创建账号'}</h1>
      <p className="mt-1 text-xs text-muted">每一餐，都更懂你的口味。</p>

      <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit((v) => { setError(''); submit.mutate(v); })}>
        <label className="flex flex-col gap-1 text-xs font-medium">
          邮箱
          <input className="sg-input" type="email" autoComplete="email" {...register('email')} placeholder="you@campus.edu.cn" />
          {errors.email && <span className="text-[11px] text-red-600">{errors.email.message}</span>}
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          密码
          <input className="sg-input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} {...register('password')} placeholder="至少 8 位，含字母与数字" />
          {errors.password && <span className="text-[11px] text-red-600">{errors.password.message}</span>}
        </label>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <button type="submit" disabled={submit.isPending} className="sg-btn-primary disabled:opacity-60">
          {submit.isPending ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </form>

      <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="mt-4 w-full text-center text-xs text-orange-deep">
        {mode === 'login' ? '还没有账号？去注册' : '已有账号？去登录'}
      </button>

      {demo.data?.enabled && (
        <section className="sg-card mt-8 p-4">
          <h2 className="text-xs font-bold">体验账号（点击填入）</h2>
          <div className="mt-3 flex flex-col gap-2">
            {demo.data.accounts.map((a) => (
              <button key={a.email} type="button" onClick={() => { setValue('email', a.email); setMode('login'); }}
                className="flex items-center justify-between rounded-xl bg-beige px-3 py-2 text-left text-[11px] dark:bg-[#2F362D]">
                <span className="font-medium">{a.label}</span><span className="text-muted">{a.email}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted">{demo.data.notice}</p>
        </section>
      )}
    </main>
  );
}
