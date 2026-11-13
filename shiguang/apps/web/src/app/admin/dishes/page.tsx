'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { get, patch, post, upload } from '@/lib/api';

const VERIFIED_DIETS = [
  { value: 'VEGAN', label: '纯素' },
  { value: 'PESCATARIAN', label: '鱼素' },
  { value: 'HALAL', label: '清真' },
] as const;
type VerifiedDiet = (typeof VERIFIED_DIETS)[number]['value'];

interface DishRow {
  id: string; name: string; priceCents: number; category: string; status: string;
  avgRating: number; ratingCount: number; imageUrl: string | null;
  stall: { name: string; canteen: { name: string } };
  nutrition: { energyKcal: number; proteinG: number; fatG: number; carbG: number; isEstimated: boolean } | null;
  allergens: string[];
  verifiedDietPatterns?: VerifiedDiet[];
}
interface DishDetail extends DishRow {
  stallId: string; description: string | null; spiceScore: number; oilScore: number;
  isVegetarian: boolean; isHighProtein: boolean; isNew: boolean;
  tags: { name: string }[]; ingredients: string[]; ingredientRows: { name: string }[];
}
interface Stall { id: string; name: string; canteen: { name: string } }

const card = 'rounded-card border border-line bg-white p-4 dark:bg-[#262B24]';
const CATEGORIES = ['主食', '面食', '现炒', '汤品', '烧烤', '小吃', '甜品', '套餐'];
const EMPTY_FORM = {
  stallId: '', name: '', category: '主食', priceYuan: '', description: '',
  spiceScore: 0, oilScore: 2, isVegetarian: false, isHighProtein: false, isNew: false,
  ingredients: '', tags: '', allergens: '', verifiedDietPatterns: [] as VerifiedDiet[],
  energyKcal: '', proteinG: '', fatG: '', carbG: '', imageUrl: '',
};

export default function AdminDishesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterStall, setFilterStall] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [msg, setMsg] = useState('');
  const [uploading, setUploading] = useState(false);

  const stalls = useQuery({ queryKey: ['managed-stalls'], queryFn: () => get<Stall[]>('/menus/manage/stalls') });
  const activeStall = filterStall || stalls.data?.[0]?.id || '';
  const list = useQuery({
    queryKey: ['admin-dishes', q, activeStall],
    enabled: !!activeStall,
    queryFn: () => get<{ items: DishRow[]; meta: { total: number } }>(`/dishes?${new URLSearchParams({ pageSize: '50', q, stallId: activeStall })}`),
  });
  const off = useMutation({
    mutationFn: (id: string) => post(`/dishes/${id}/off-shelf`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-dishes'] }),
    onError: (e: Error) => setMsg(`下架失败：${e.message}`),
  });

  const splitList = (v: string) => [...new Set(v.split(/[,，]+/).map((s) => s.trim()).filter(Boolean))];

  const save = useMutation({
    mutationFn: () => {
      const fields = {
        name: form.name.trim(),
        category: form.category,
        priceCents: Math.round(Number(form.priceYuan) * 100),
        description: form.description,
        imageUrl: form.imageUrl || undefined,
        spiceScore: form.spiceScore,
        oilScore: form.oilScore,
        isVegetarian: form.isVegetarian,
        isHighProtein: form.isHighProtein,
        isNew: form.isNew,
        ingredients: splitList(form.ingredients),
        tags: splitList(form.tags),
        allergens: splitList(form.allergens),
        verifiedDietPatterns: form.verifiedDietPatterns,
        ...(form.energyKcal ? {
          energyKcal: Math.round(Number(form.energyKcal)),
          proteinG: Math.round(Number(form.proteinG || 0)),
          fatG: Math.round(Number(form.fatG || 0)),
          carbG: Math.round(Number(form.carbG || 0)),
        } : {}),
      };
      return editingId ? patch(`/dishes/${editingId}`, fields) : post('/dishes', { ...fields, stallId: form.stallId });
    },
    onSuccess: () => {
      setMsg(editingId ? '菜品已更新' : '菜品已创建');
      setForm({ ...EMPTY_FORM, stallId: activeStall });
      setEditingId(null);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['admin-dishes'] });
    },
    onError: (e: Error) => setMsg(`保存失败：${e.message}`),
  });
  const edit = useMutation({
    mutationFn: (id: string) => get<DishDetail>(`/dishes/${id}`),
    onSuccess: (dish) => {
      setMsg('');
      setEditingId(dish.id);
      setOpen(true);
      setForm({
        stallId: dish.stallId, name: dish.name, category: dish.category, priceYuan: String(dish.priceCents / 100),
        description: dish.description ?? '', imageUrl: dish.imageUrl ?? '', spiceScore: dish.spiceScore, oilScore: dish.oilScore,
        isVegetarian: dish.isVegetarian, isHighProtein: dish.isHighProtein, isNew: dish.isNew,
        ingredients: (dish.ingredientRows.length ? dish.ingredientRows.map((ingredient) => ingredient.name) : dish.ingredients).join('，'),
        tags: dish.tags.map((tag) => tag.name).join('，'), allergens: dish.allergens.join('，'),
        verifiedDietPatterns: dish.verifiedDietPatterns ?? [],
        energyKcal: dish.nutrition ? String(dish.nutrition.energyKcal) : '',
        proteinG: dish.nutrition ? String(dish.nutrition.proteinG) : '',
        fatG: dish.nutrition ? String(dish.nutrition.fatG) : '',
        carbG: dish.nutrition ? String(dish.nutrition.carbG) : '',
      });
    },
    onError: (e: Error) => setMsg(`菜品加载失败：${e.message}`),
  });

  const uploadImage = async (file: File) => {
    setUploading(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const image = await upload<{ url: string; size: number }>('/uploads/dishes', fd);
      setForm((f) => ({ ...f, imageUrl: image.url }));
      setMsg(`图片已上传（${Math.round(image.size / 1024)} KB）`);
    } catch (e) {
      setMsg(`上传失败：${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = form.stallId && form.name.trim() && form.priceYuan !== '' && Number(form.priceYuan) >= 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">菜品管理</h1>
          <p className="mt-1 text-[11px] text-muted">共 {list.data?.meta.total ?? '—'} 道菜；下架不做物理删除，历史订单不受影响</p>
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索菜名 / 分类 / 食材" aria-label="搜索菜品" className="sg-input max-w-[220px]" />
          <button type="button" disabled={uploading || save.isPending} onClick={() => {
            setOpen(!open); setEditingId(null); setMsg(''); setForm({ ...EMPTY_FORM, stallId: activeStall });
          }} className="sg-btn-primary whitespace-nowrap">{open ? '收起表单' : '新增菜品'}</button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted">查看档口
        <select className="sg-input w-auto" value={activeStall} onChange={(event) => setFilterStall(event.target.value)}>
          {!stalls.data?.length && <option value="">暂无可管理档口</option>}
          {stalls.data?.map((s) => <option key={s.id} value={s.id}>{s.canteen.name} · {s.name}</option>)}
        </select>
      </label>
      {!open && msg && <p role="status" className="text-xs text-muted">{msg}</p>}
      {open && (
        <section className={card}>
          <h2 className="text-sm font-bold">{editingId ? '编辑菜品' : '新增菜品'}</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[11px] text-muted">所属档口
              <select value={form.stallId} disabled={!!editingId} onChange={(e) => setForm({ ...form, stallId: e.target.value })} className="sg-input py-1.5 text-xs">
                <option value="">选择档口</option>
                {stalls.data?.map((s) => <option key={s.id} value={s.id}>{s.canteen.name} · {s.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">菜名
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="sg-input py-1.5 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">分类
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="sg-input py-1.5 text-xs">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">价格（元）
              <input type="number" min={0} step={0.01} value={form.priceYuan} onChange={(e) => setForm({ ...form, priceYuan: e.target.value })} className="sg-input py-1.5 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">简介
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="sg-input py-1.5 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">图片（PNG/JPEG/WebP ≤5MB）
              <div className="flex items-center gap-2">
                <input type="file" disabled={uploading || save.isPending} accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }}
                  className="block w-full text-[10px]" />
                {form.imageUrl && <img src={form.imageUrl} alt="预览" className="h-8 w-8 rounded object-cover" />}
              </div>
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted">辣度 {form.spiceScore}/5
              <input type="range" min={0} max={5} value={form.spiceScore} onChange={(e) => setForm({ ...form, spiceScore: Number(e.target.value) })} className="accent-orange" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">油腻度 {form.oilScore}/5
              <input type="range" min={0} max={5} value={form.oilScore} onChange={(e) => setForm({ ...form, oilScore: Number(e.target.value) })} className="accent-orange" />
            </label>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[11px] text-muted">食材（逗号分隔）
              <input value={form.ingredients} onChange={(e) => setForm({ ...form, ingredients: e.target.value })} placeholder="鸡肉, 香菇, 米饭" className="sg-input py-1.5 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">标签（逗号分隔）
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="微辣, 家常菜" className="sg-input py-1.5 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">过敏原（逗号分隔）
              <input value={form.allergens} onChange={(e) => setForm({ ...form, allergens: e.target.value })} placeholder="花生, 麸质" className="sg-input py-1.5 text-xs" />
            </label>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {([['energyKcal', '能量 kcal'], ['proteinG', '蛋白 g'], ['fatG', '脂肪 g'], ['carbG', '碳水 g']] as const).map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1 text-[11px] text-muted">{label}
                <input type="number" min={0} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="sg-input py-1.5 text-xs" />
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-4 text-[11px]">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.isVegetarian} onChange={(e) => setForm({ ...form, isVegetarian: e.target.checked })} className="accent-orange" />素食</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.isHighProtein} onChange={(e) => setForm({ ...form, isHighProtein: e.target.checked })} className="accent-orange" />高蛋白</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.isNew} onChange={(e) => setForm({ ...form, isNew: e.target.checked })} className="accent-orange" />新菜</label>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <fieldset className="w-full rounded-xl border border-line p-2 text-[11px]">
              <legend>已核验的饮食类型</legend>
              <div className="flex flex-wrap gap-3">
                {VERIFIED_DIETS.map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={form.verifiedDietPatterns.includes(value)} className="accent-orange"
                      onChange={(event) => setForm((previous) => ({
                        ...previous,
                        verifiedDietPatterns: event.target.checked
                          ? [...previous.verifiedDietPatterns, value]
                          : previous.verifiedDietPatterns.filter((diet) => diet !== value),
                      }))} />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-muted">请核验食材及制作流程后勾选。未勾选的类型按未知处理。</p>
            </fieldset>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" disabled={!canSubmit || save.isPending || uploading} onClick={() => { setMsg(''); save.mutate(); }}
              className="sg-btn-primary disabled:opacity-50">{save.isPending ? '提交中…' : editingId ? '保存修改' : '创建菜品'}</button>
            {uploading && <span className="flex items-center gap-1 text-[11px] text-muted"><ImagePlus size={12} aria-hidden />图片上传中…</span>}
          </div>
          {msg && <p role="status" className="mt-2 text-[11px] text-sage-deep">{msg}</p>}
          <p className="mt-2 text-[11px] leading-5 text-muted">营养数值标注为估算值，非实验室检测结果；图片由服务端校验 MIME + 文件头 + 5MB 上限。</p>
        </section>
      )}

      {(list.isLoading || stalls.isLoading) && <div className="sg-skeleton h-40" />}
      {(list.isError || stalls.isError) && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">加载失败。</p>}

      <div className="overflow-x-auto rounded-card border border-line bg-white dark:bg-[#262B24]">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="border-b border-line text-[11px] text-muted">
            <tr>
              <th className="px-4 py-3">菜品</th><th className="px-4 py-3">档口</th><th className="px-4 py-3">价格</th>
              <th className="px-4 py-3">评分</th><th className="px-4 py-3">营养</th><th className="px-4 py-3">过敏原</th>
              <th className="px-4 py-3">状态</th><th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {d.imageUrl ? <img src={d.imageUrl} alt="" className="h-8 w-8 rounded object-cover" /> : null}
                    <div><p className="font-semibold">{d.name}</p><p className="text-[11px] text-muted">{d.category}</p></div>
                  </div>
                </td>
                <td className="px-4 py-3 text-[11px] text-muted">{d.stall.canteen.name} · {d.stall.name}</td>
                <td className="px-4 py-3">¥{(d.priceCents / 100).toFixed(2)}</td>
                <td className="px-4 py-3">{d.avgRating.toFixed(1)}<span className="text-[11px] text-muted"> ({d.ratingCount})</span></td>
                <td className="px-4 py-3 text-[11px]">{d.nutrition ? `${Math.round(d.nutrition.energyKcal)} kcal${d.nutrition.isEstimated ? ' · 估算' : ''}` : '—'}</td>
                <td className="px-4 py-3 text-[11px]">
                  <p className="text-red-700">{d.allergens.join('、') || '—'}</p>
                  <p className="text-muted">{VERIFIED_DIETS.filter((diet) => d.verifiedDietPatterns?.includes(diet.value)).map((diet) => diet.label).join('、') || '饮食类型未核验'}</p>
                </td>
                <td className="px-4 py-3 text-[11px]">{d.status === 'ACTIVE' ? '在架' : '已下架'}</td>
                <td className="space-x-2 px-4 py-3">
                  <button type="button" disabled={edit.isPending || save.isPending || uploading} onClick={() => edit.mutate(d.id)}
                    className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">编辑</button>
                  {d.status === 'ACTIVE' && (
                    <button type="button" onClick={() => off.mutate(d.id)} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">下架</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data?.items.length === 0 && <p className="text-xs text-muted">没有匹配的菜品。</p>}
    </div>
  );
}
