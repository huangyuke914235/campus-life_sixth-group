'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { put, post, endpoints, ApiError } from '@/lib/api';

const CUISINES = ['粤菜', '潮汕菜', '川菜', '湘菜', '面食', '烧烤小吃'];
const STAPLES = ['米饭', '面食', '粉类', '汤类', '小吃'];
const INGREDIENTS = ['鸡肉', '牛肉', '猪肉', '鱼肉', '鸡蛋', '豆制品', '菌菇', '绿叶菜', '番茄'];
const SPECIAL = ['香菜', '葱', '蒜', '辣椒'];
const COMMON_ALLERGENS = ['花生', '乳糖', '甲壳类', '鸡蛋', '麸质', '大豆', '坚果'];
const DIET = ['OMNIVORE', 'VEGETARIAN', 'VEGAN', 'PESCATARIAN', 'HALAL'];

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    cuisines: [] as string[], staplePreferences: [] as string[], ingredientLikes: [] as string[],
    specialLikes: [] as string[], spiceTolerance: 2, sweetness: 2, saltiness: 2, oilTolerance: 3,
    budgetMinCents: 1200, budgetMaxCents: 2500, adventurous: false, dietPattern: 'OMNIVORE',
  });
  const [allergens, setAllergens] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: async () => {
      await put(endpoints.preferences, { ...form, flavorIntensity: form.spiceTolerance });
      for (const value of allergens) await post(endpoints.restrictions, { kind: 'ALLERGEN', value });
      for (const value of dislikes) await post(endpoints.restrictions, { kind: 'DISLIKE', value });
    },
    onSuccess: () => router.push('/dashboard'),
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '保存失败，请稍后重试'),
  });

  const steps = ['基础口味', '辣度与油盐', '预算与忌口'];
  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-16 pt-8">
      <h1 className="text-xl font-bold">告诉我你的口味</h1>
      <p className="mt-1 text-xs text-muted">约 1 分钟，之后可以随时修改。忌口与过敏原会硬性过滤，系统不会覆盖。</p>
      <div className="mt-4 flex gap-2">
        {steps.map((s, i) => (
          <div key={s} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-orange' : 'bg-line'}`} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">第 {step + 1} / 3 步 · {steps[step]}</p>

      {step === 0 && (
        <div className="mt-5 flex flex-col gap-5">
          <Group title="喜欢的菜系"><Chips options={CUISINES} value={form.cuisines} onChange={(v) => setForm({ ...form, cuisines: toggle(form.cuisines, v) })} /></Group>
          <Group title="主食偏好"><Chips options={STAPLES} value={form.staplePreferences} onChange={(v) => setForm({ ...form, staplePreferences: toggle(form.staplePreferences, v) })} /></Group>
          <Group title="喜欢的食材"><Chips options={INGREDIENTS} value={form.ingredientLikes} onChange={(v) => setForm({ ...form, ingredientLikes: toggle(form.ingredientLikes, v) })} /></Group>
          <Group title="喜欢的配料"><Chips options={SPECIAL} value={form.specialLikes} onChange={(v) => setForm({ ...form, specialLikes: toggle(form.specialLikes, v) })} /></Group>
        </div>
      )}

      {step === 1 && (
        <div className="mt-5 flex flex-col gap-5">
          <Slider label="能接受的辣度" value={form.spiceTolerance} onChange={(v) => setForm({ ...form, spiceTolerance: v })} hint="0 不吃辣 · 5 重辣" />
          <Slider label="油腻接受度" value={form.oilTolerance} onChange={(v) => setForm({ ...form, oilTolerance: v })} hint="越低越偏好清淡" />
          <Slider label="咸度偏好" value={form.saltiness} onChange={(v) => setForm({ ...form, saltiness: v })} />
          <Slider label="甜度偏好" value={form.sweetness} onChange={(v) => setForm({ ...form, sweetness: v })} />
          <Group title="饮食模式">
            <div className="flex flex-wrap gap-2">
              {DIET.map((d) => (
                <button key={d} type="button" onClick={() => setForm({ ...form, dietPattern: d })}
                  className={`sg-chip ${form.dietPattern === d ? 'sg-chip-active' : ''}`}>
                  {{ OMNIVORE: '荤素都吃', VEGETARIAN: '素食', VEGAN: '纯素', PESCATARIAN: '鱼素', HALAL: '清真' }[d]}
                </button>
              ))}
            </div>
          </Group>
        </div>
      )}

      {step === 2 && (
        <div className="mt-5 flex flex-col gap-5">
          <Group title="单餐预算">
            <div className="flex items-center gap-3 text-xs">
              <input type="range" min={500} max={5000} step={100} value={form.budgetMinCents}
                onChange={(e) => setForm({ ...form, budgetMinCents: Number(e.target.value), budgetMaxCents: Math.max(Number(e.target.value), form.budgetMaxCents) })}
                className="flex-1 accent-orange" aria-label="预算下限" />
              <span className="w-24 text-right">¥{form.budgetMinCents / 100}–{form.budgetMaxCents / 100}</span>
            </div>
            <input type="range" min={500} max={6000} step={100} value={form.budgetMaxCents}
              onChange={(e) => setForm({ ...form, budgetMaxCents: Math.max(form.budgetMinCents, Number(e.target.value)) })}
              className="mt-2 w-full accent-orange" aria-label="预算上限" />
          </Group>
          <Group title="过敏原（硬性过滤）"><Chips options={COMMON_ALLERGENS} value={allergens} onChange={(v) => setAllergens(toggle(allergens, v))} danger /></Group>
          <Group title="不吃的食材（忌口）"><Chips options={['香菜', '葱', '蒜', '肥肉', '动物内脏', '折耳根']} value={dislikes} onChange={(v) => setDislikes(toggle(dislikes, v))} /></Group>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.adventurous} onChange={(e) => setForm({ ...form, adventurous: e.target.checked })} className="accent-orange" />
            我喜欢尝试新菜
          </label>
          <p className="rounded-xl bg-beige p-3 text-[11px] leading-5 text-muted dark:bg-[#2F362D]">
            食堂信息可能不完整，过敏原存在交叉接触风险；主观体感不构成医学判断。
          </p>
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-6 flex gap-2">
        {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="rounded-pill border border-line px-5 py-3 text-xs">上一步</button>}
        {step < 2
          ? <button type="button" onClick={() => setStep(step + 1)} className="sg-btn-primary flex-1">下一步</button>
          : <button type="button" disabled={save.isPending} onClick={() => { setError(''); save.mutate(); }} className="sg-btn-primary flex-1 disabled:opacity-60">{save.isPending ? '保存中…' : '完成，开始推荐'}</button>}
      </div>
    </main>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="mb-2 text-xs font-semibold">{title}</h2>{children}</section>;
}

function Chips({ options, value, onChange, danger }: { options: string[]; value: string[]; onChange: (v: string) => void; danger?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value.includes(o)}
          className={`sg-chip ${value.includes(o) ? (danger ? 'border border-red-300 bg-red-50 text-red-700' : 'sg-chip-active') : ''}`}>{o}</button>
      ))}
    </div>
  );
}

function Slider({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-semibold"><span>{label}</span><span className="text-orange-deep">{value} / 5</span></div>
      <input type="range" min={0} max={5} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-orange" aria-label={label} />
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
