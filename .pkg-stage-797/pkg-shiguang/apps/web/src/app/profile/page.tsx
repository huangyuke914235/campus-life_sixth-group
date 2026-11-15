'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Heart, History, LineChart, LogOut, Moon, SlidersHorizontal, Sun, Bell, ShieldAlert } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { useTheme } from '@/components/Providers';
import { get, patch, post, endpoints } from '@/lib/api';

interface Me { id: string; email: string; displayName: string; role: string; studentNo: string | null; onboardedAt: string | null }
const ROLE: Record<string, string> = { STUDENT: '学生', MERCHANT: '商户', ADMIN: '管理员' };

export default function ProfilePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { dark, toggle } = useTheme();
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<Me>(endpoints.me) });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');

  const save = useMutation({
    mutationFn: () => patch('/users/me', { displayName: name.trim() }),
    onSuccess: () => { setEditing(false); setMsg('昵称已更新'); qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: () => setMsg('保存失败，请稍后重试'),
  });
  const logout = useMutation({
    mutationFn: () => post(endpoints.logout),
    onSuccess: () => { qc.clear(); router.push('/login'); },
  });
  const removeAccount = useMutation({
    mutationFn: () => fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1'}/users/me`, { method: 'DELETE', credentials: 'include' }),
    onSuccess: () => { qc.clear(); router.push('/login'); },
  });

  const links = [
    { href: '/profile/preferences', label: '口味偏好与画像', desc: '我设置的 / 系统推断', Icon: SlidersHorizontal },
    { href: '/favorites', label: '我的收藏', desc: '常吃的几道菜', Icon: Heart },
    { href: '/history', label: '饮食记录', desc: '近 30 天用餐与花费', Icon: History },
    { href: '/insights', label: '饮食报告', desc: '常点菜品与偏好分类', Icon: LineChart },
    { href: '/notifications', label: '消息通知', desc: '订单状态与公告', Icon: Bell },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">我的</h1>
        <button type="button" onClick={toggle} aria-label="切换深浅色" className="rounded-full border border-line p-2 text-muted">
          {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
        </button>
      </header>

      {me.isPending && <div className="sg-skeleton mt-5 h-24" />}
      {me.isError && <p role="alert" className="sg-card mt-5 p-4 text-xs text-red-700">用户信息加载失败。</p>}

      {me.data && (
        <section className="sg-card mt-5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange text-lg font-bold text-white">
              {me.data.displayName.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              {editing ? (
                <div className="flex gap-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} aria-label="昵称" className="sg-input py-1.5 text-sm" />
                  <button type="button" onClick={() => save.mutate()} disabled={!name.trim() || save.isPending} className="rounded-pill bg-orange px-3 text-xs font-semibold text-white disabled:opacity-50">保存</button>
                </div>
              ) : (
                <p className="truncate text-sm font-bold">{me.data.displayName}</p>
              )}
              <p className="mt-0.5 truncate text-[11px] text-muted">{me.data.email} · {ROLE[me.data.role] ?? me.data.role}</p>
            </div>
            {!editing && (
              <button type="button" onClick={() => { setName(me.data!.displayName); setEditing(true); }} className="text-[11px] text-orange-deep">修改</button>
            )}
          </div>
          {msg && <p role="status" className="mt-2 text-[11px] text-sage-deep">{msg}</p>}
        </section>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {links.map(({ href, label, desc, Icon }) => (
          <Link key={href} href={href} className="sg-card flex items-center gap-3 p-3">
            <Icon size={18} className="text-orange" aria-hidden />
            <div className="flex-1">
              <p className="text-xs font-semibold">{label}</p>
              <p className="mt-0.5 text-[11px] text-muted">{desc}</p>
            </div>
            <ChevronRight size={16} className="text-muted" aria-hidden />
          </Link>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <button type="button" onClick={() => logout.mutate()} className="sg-card flex items-center gap-3 p-3 text-left">
          <LogOut size={18} className="text-muted" aria-hidden />
          <span className="text-xs font-semibold">退出登录</span>
        </button>
        <button type="button" onClick={() => { if (window.confirm('申请停用账号？会立即撤销登录态，业务记录按审计要求保留。')) removeAccount.mutate(); }}
          className="sg-card flex items-center gap-3 p-3 text-left">
          <ShieldAlert size={18} className="text-red-600" aria-hidden />
          <div>
            <p className="text-xs font-semibold text-red-700">申请停用账号</p>
            <p className="mt-0.5 text-[11px] text-muted">停用后不可登录，历史订单与评价保留</p>
          </div>
        </button>
      </div>

      <p className="mt-4 text-[11px] leading-5 text-muted">
        营养数值为估算值，仅供饮食参考。
      </p>
      <BottomNav />
    </main>
  );
}
