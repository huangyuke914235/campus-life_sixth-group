'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bell, MessageSquare, Moon, Sun, Utensils } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { DishCard } from '@/components/DishCard';
import { useTheme } from '@/components/Providers';
import { get, endpoints } from '@/lib/api';

interface Me { displayName: string; role: string }
interface RecoItem { dishId: string; name: string; priceCents: number; score: number; reason: string }
interface RecoData { items: RecoItem[]; mealType: string; date: string; coldStart: boolean }
interface Notification { unreadCount: number }

export default function DashboardPage() {
  const { dark, toggle } = useTheme();
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<Me>(endpoints.me) });
  const reco = useQuery({ queryKey: ['today-reco'], queryFn: () => get<RecoData>(endpoints.todayRecommendation) });
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => get<Notification>(endpoints.notifications) });

  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <main className="mx-auto min-h-screen max-w-md pb-28">
      <header className="bg-gradient-to-r from-[#FF9A5C] to-orange-deep px-5 pb-6 pt-8 text-white">
        <div className="flex items-center justify-between">
          <div><p className="text-xl font-bold">下午好，{me.data?.displayName ?? '同学'}</p><p className="mt-1 text-xs opacity-90">{today} · 午餐时段</p></div>
          <div className="flex gap-2">
            <button type="button" onClick={toggle} aria-label="切换深浅色" className="rounded-full bg-white/20 p-2">
              {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
            </button>
            <Link href="/notifications" aria-label="消息通知" className="relative rounded-full bg-white/20 p-2">
              <Bell size={16} aria-hidden />
              {(notifications.data?.unreadCount ?? 0) > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sage" />}
            </Link>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-pill bg-white px-4 py-3 text-xs text-muted">
          搜索菜品、档口、食材（可在探索页使用组合筛选）
        </div>
      </header>

      <div className="px-5 pt-5">
        <Link href="/recommend" className="relative block overflow-hidden rounded-card p-5 text-white">
          <img src="/images/dishes/rice.jpg" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#8A3A0C]/95 via-[#C25A17]/85 to-[#F2732B]/60" />
          <div className="relative">
            <p className="text-xs opacity-90">今天吃什么？</p>
            <p className="mt-1 text-2xl font-bold">帮我选这一餐</p>
            <p className="mt-1 text-[11px] opacity-90">基于你的口味画像，3 秒选出今天这餐</p>
            <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-orange-deep">
              帮我选 <ArrowRight size={12} aria-hidden />
            </span>
          </div>
        </Link>

        <Link href="/set-meal" className="sg-card mt-3 flex items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange/12 text-orange-deep">
              <Utensils size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold">懒人一键搭配</p>
              <p className="mt-0.5 text-[11px] text-muted">选口味和预算，主食 + 蛋白 + 蔬菜 + 汤饮直接配好</p>
            </div>
          </div>
          <ArrowRight size={16} className="shrink-0 text-orange" aria-hidden />
        </Link>

        <Link href="/reviews" className="sg-card mt-3 flex items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sage/15 text-sage-deep">
              <MessageSquare size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold">看看大家怎么说</p>
              <p className="mt-0.5 text-[11px] text-muted">全站真实评价，可看最新 / 最高分 / 差评</p>
            </div>
          </div>
          <ArrowRight size={16} className="shrink-0 text-orange" aria-hidden />
        </Link>

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">猜你喜欢</h2>
            <Link href="/recommend" className="text-[11px] text-orange-deep">查看推荐依据</Link>
          </div>
          {reco.data && reco.data.coldStart && reco.data.items.length > 0 && (
            <Link href="/onboarding" className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-orange/10 px-3 py-2.5 text-[11px] text-orange-deep">
              <span>还没设口味偏好，现在按大众口味推荐</span>
              <span className="shrink-0 font-semibold">去设置 →</span>
            </Link>
          )}
          {reco.isPending && <div className="mt-3 flex flex-col gap-3">{[1, 2].map((i) => <div key={i} className="sg-skeleton h-24" />)}</div>}
          {reco.isError && <div role="alert" className="sg-card mt-3 p-4 text-xs text-red-700">推荐加载失败，请检查网络或稍后重试。</div>}
          {reco.data && reco.data.items.length === 0 && (
            <div className="sg-card mt-3 p-5 text-center text-xs text-muted">今日暂无可推荐菜品，看看菜单吧。</div>
          )}
          {reco.data && reco.data.items.length > 0 && (
            <div className="mt-3 flex flex-col gap-3">
              {reco.data.items.slice(0, 2).map((d) => <DishCard key={d.dishId} dish={d} />)}
            </div>
          )}
        </section>

        <section className="sg-card mt-5 p-4">
          <h2 className="text-sm font-bold">今日菜单与食堂</h2>
          <p className="mt-2 text-xs leading-5 text-muted">
            粤海、丽湖两校区共 13 个食堂在供应，菜单每天按窗口实际出品更新。
          </p>
          <Link href="/discover" className="mt-2 inline-block text-xs font-semibold text-orange-deep">浏览菜品 →</Link>
        </section>

        <p className="mt-5 text-[11px] leading-5 text-muted">
          营养数值为估算值，仅供饮食参考。
        </p>
      </div>
      <BottomNav />
    </main>
  );
}
