'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { get, post, endpoints } from '@/lib/api';

interface ProfileData {
  explicit: { spiceTolerance: number; cuisines: string[]; staplePreferences: string[]; ingredientLikes: string[]; budget: string; priority: string } | null;
  inferred: { topTags: string[]; oilTolerance: number; spiceAffinity: number; vegetableAffinity: number; confidence: number; feedbackCount: number } | null;
  restrictions: { kind: string; value: string; source: string }[];
  reviewCount: number;
  summary: string;
  disclaimers: string[];
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-beige dark:bg-[#2F362D]">
        <div className="h-full rounded-full bg-sage" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
      </div>
      <span className="w-10 text-right font-medium">{Math.round(value * 100)}</span>
    </div>
  );
}

export default function PreferencesPage() {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ['taste-profile'], queryFn: () => get<ProfileData>(endpoints.tasteProfile) });
  const reset = useMutation({
    mutationFn: () => post(endpoints.resetProfile),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taste-profile'] }),
  });

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <header><h1 className="text-xl font-bold">越来越懂你</h1><p className="mt-1 text-xs text-muted">我的口味画像</p></header>

      {profile.isPending && <div className="sg-skeleton mt-6 h-64" />}
      {profile.isError && <div role="alert" className="sg-card mt-6 p-4 text-xs text-red-700">画像加载失败，请稍后重试。</div>}

      {profile.data && (
        <div className="mt-5 flex flex-col gap-4">
          <section className="sg-card bg-orange-light p-4">
            <p className="text-xs font-semibold text-orange-deep">一句话画像</p>
            <p className="mt-1 text-sm leading-6">{profile.data.summary}</p>
            <p className="mt-2 text-[11px] text-muted">基于 {profile.data.reviewCount} 条真实评价 · 置信度 {Math.round((profile.data.inferred?.confidence ?? 0) * 100)}%</p>
          </section>

          <section className="sg-card p-4">
            <h2 className="text-sm font-bold">我设置的 · 系统不会覆盖</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                `辣度 ${profile.data.explicit?.spiceTolerance ?? 0}/5`,
                ...(profile.data.explicit?.staplePreferences ?? []),
                ...(profile.data.explicit?.ingredientLikes ?? []),
                profile.data.explicit?.budget ?? '',
              ].filter(Boolean).map((t) => <span key={t} className="sg-chip sg-chip-active">{t}</span>)}
              {profile.data.restrictions.map((r) => (
                <span key={`${r.kind}-${r.value}`} className="sg-chip bg-red-50 text-red-700">
                  {r.value}{r.kind === 'ALLERGEN' ? ' · 过敏原' : ' · 忌口'}
                </span>
              ))}
            </div>
          </section>

          <section className="sg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">系统推断 · 可查看与重置</h2>
              <button type="button" disabled={reset.isPending} onClick={() => reset.mutate()}
                className="flex items-center gap-1 text-[11px] text-orange-deep"><RotateCcw size={12} aria-hidden /> 重置</button>
            </div>
            {profile.data.inferred && profile.data.inferred.topTags.length > 0 ? (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.data.inferred.topTags.map((t) => <span key={t} className="sg-chip bg-sage-light text-sage-deep">{t}</span>)}
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <Bar label="油腻容忍度" value={profile.data.inferred!.oilTolerance} />
                  <Bar label="辣味偏好" value={profile.data.inferred!.spiceAffinity} />
                  <Bar label="蔬菜偏好" value={profile.data.inferred!.vegetableAffinity} />
                  <Bar label="画像置信度" value={profile.data.inferred!.confidence} />
                </div>
              </>
            ) : <p className="mt-3 text-xs text-muted">还没有足够的反馈生成推断偏好，推荐目前主要依据你填写的问卷。</p>}
          </section>

          <section className="sg-card p-4">
            <h2 className="text-sm font-bold">偏好怎么影响推荐</h2>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              高分评价增强相似菜品权重，低分与「有点油腻」等体感标签会适度降权；
              单次反馈只做平滑微调并带时间衰减，不会推翻长期偏好。
            </p>
            <Link href="/recommend" className="mt-3 inline-block text-xs font-semibold text-orange-deep">查看推荐依据 →</Link>
          </section>

          <div className="rounded-xl bg-beige p-3 text-[11px] leading-5 text-muted dark:bg-[#2F362D]">
            {profile.data.disclaimers.map((d) => <p key={d}>{d}</p>)}
            <p>过敏原信息以食堂公示为准，存在交叉接触风险；主观体感不构成医学判断。</p>
          </div>
        </div>
      )}
      <BottomNav />
    </main>
  );
}
