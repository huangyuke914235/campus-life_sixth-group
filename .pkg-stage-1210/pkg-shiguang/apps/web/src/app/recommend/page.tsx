'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, RefreshCw } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { DishCard, type DishView } from '@/components/DishCard';
import { post, endpoints, ApiError } from '@/lib/api';

interface RecoItem extends DishView { rank: number; score: number; reason: string; scoreParts: Record<string, number> }
interface RecoResult {
  items: RecoItem[]; coldStart: boolean; algorithm: string;
  weights: Record<string, number>; rejectedCount: number;
}

const SCENARIOS = [
  { key: 'wantSpicy', label: '想吃辣' },
  { key: 'wantLight', label: '清淡一点' },
  { key: 'highProtein', label: '高蛋白' },
  { key: 'wantSoup', label: '来点汤' },
  { key: 'wantValue', label: '便宜点' },
  { key: 'wantNew', label: '尝点新菜' },
] as const;

export default function RecommendPage() {
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [explainFor, setExplainFor] = useState<string | null>(null);

  const reco = useMutation({
    mutationFn: (conditions: Record<string, unknown>) => post<RecoResult>(endpoints.queryRecommendation, { mealType: 'LUNCH', limit: 3, ...conditions }),
  });

  // 进入页面就自动给一次结果，避免用户看到空白需要再点一次
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    reco.mutate({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (key: string) => setScenarios((s) => s.includes(key) ? s.filter((x) => x !== key) : [...s, key]);
  const run = () => {
    const conditions: Record<string, unknown> = {};
    scenarios.forEach((k) => { conditions[k] = true; });
    reco.mutate(conditions);
  };

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <header className="flex items-center justify-between">
        <Link href="/dashboard" className="text-sm text-muted">← 首页</Link>
        <h1 className="text-base font-bold">今天吃什么</h1>
        <span className="w-10" />
      </header>

      <section className="mt-6 rounded-card bg-gradient-to-r from-[#FF9A5C] to-orange-deep p-5 text-white">
        <div className="flex items-center gap-2 text-xs opacity-90"><Sparkles size={14} aria-hidden /> 智能选菜</div>
        <h2 className="mt-2 text-xl font-bold">帮我选这一餐</h2>
        <p className="mt-1 text-[11px] opacity-90">基于你的口味画像与真实评价，给出 3 道菜和可解释理由</p>
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        {SCENARIOS.map((s) => (
          <button key={s.key} type="button" aria-pressed={scenarios.includes(s.key)} onClick={() => toggle(s.key)}
            className={`sg-chip ${scenarios.includes(s.key) ? 'sg-chip-active' : ''}`}>{s.label}</button>
        ))}
      </div>
      <button type="button" onClick={run} disabled={reco.isPending} className="sg-btn-primary mt-4 w-full">
        {reco.isPending ? '正在为你挑菜…' : '帮我选'}
      </button>

      {reco.isPending && <div className="mt-5 flex flex-col gap-3">{[1, 2, 3].map((i) => <div key={i} className="sg-skeleton h-24" />)}</div>}
      {reco.isError && (
        <div role="alert" className="sg-card mt-5 p-4 text-xs text-red-700">
          {reco.error instanceof ApiError ? reco.error.message : '推荐服务暂时不可用'}
          <button type="button" onClick={run} className="mt-2 block font-semibold text-orange-deep">重试</button>
        </div>
      )}
      {reco.data && reco.data.items.length === 0 && (
        <div className="sg-card mt-5 p-6 text-center text-xs text-muted">
          当前条件下没有可推荐的菜品（{reco.data.rejectedCount} 道因售罄 / 忌口 / 非餐次被排除）。换个条件试试。
        </div>
      )}
      {reco.data && reco.data.items.length > 0 && (
        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold">为你挑了 {reco.data.items.length} 道</h2>
            <span className="text-[11px] text-muted">{reco.data.coldStart ? '问卷偏好优先（冷启动）' : '含真实反馈学习'}</span>
          </div>
          <div className="flex flex-col gap-3">
            {reco.data.items.map((item) => (
              <div key={item.dishId}>
                <DishCard dish={item} onExplain={() => setExplainFor(explainFor === item.dishId ? null : item.dishId)} />
                {explainFor === item.dishId && (
                  <div className="mt-2 rounded-xl bg-sage-light p-3 text-[11px] leading-5 text-sage-deep">
                    <p className="font-semibold">为什么推荐给我</p>
                    <p className="mt-1">{item.reason}</p>
                    <p className="mt-1">匹配度为算法估算排序结果，非精确概率；权重：口味 {Math.round((reco.data!.weights.taste ?? 0) * 100)}% · 饮食 {Math.round((reco.data!.weights.diet ?? 0) * 100)}% · 反馈 {Math.round((reco.data!.weights.feedback ?? 0) * 100)}%。</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={run} className="mt-4 flex w-full items-center justify-center gap-2 rounded-pill border border-line py-2.5 text-xs font-semibold text-muted">
            <RefreshCw size={14} aria-hidden /> 换一批
          </button>
          <p className="mt-3 text-[11px] leading-5 text-muted">
            推荐由后端本地混合模型生成（{reco.data.algorithm}），无需付费 AI API；售罄、下架、非当前餐次与过敏原一律硬过滤。
          </p>
        </section>
      )}
      <BottomNav />
    </main>
  );
}
