'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { DishCard } from '@/components/DishCard';
import { useCart } from '@/lib/cart';
import { get } from '@/lib/api';

const CATEGORIES = ['主食', '面食', '现炒', '汤品', '烧烤', '小吃', '甜品', '套餐'];
const TAGS = ['微辣', '重辣', '清淡', '高蛋白', '素食', '低脂'];
const PRICE_BANDS = [
  { label: '10 元以下', min: 0, max: 1000 },
  { label: '10–15 元', min: 1000, max: 1500 },
  { label: '15–20 元', min: 1500, max: 2000 },
  { label: '20 元以上', min: 2000, max: 100000 },
];

interface DishRow {
  id: string; name: string; priceCents: number; category: string; stallId: string;
  imageUrl: string | null; avgRating: number; ratingCount: number;
  allergens: string[]; stall: { name: string; canteenId: string; canteen: { name: string } };
}
interface DishPage { items: DishRow[]; meta: { total: number } }

export default function DiscoverPage() {
  const cart = useCart();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [band, setBand] = useState<{ min: number; max: number } | null>(null);
  const [toast, setToast] = useState('');

  const query = useMemo(() => {
    const p = new URLSearchParams({ pageSize: '24' });
    if (q.trim()) p.set('q', q.trim());
    if (category) p.set('category', category);
    if (tags.length) p.set('tags', tags.join(','));
    if (band) { p.set('minPrice', String(band.min)); p.set('maxPrice', String(band.max)); }
    return p.toString();
  }, [q, category, tags, band]);

  const list = useQuery({ queryKey: ['discover', query], queryFn: () => get<DishPage>(`/dishes?${query}`) });

  const toggleTag = (t: string) => setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const add = (d: DishRow) => {
    const r = cart.add({
      dishId: d.id, name: d.name, priceCents: d.priceCents,
      stallId: d.stallId, stallName: d.stall?.name ?? '',
      canteenId: d.stall?.canteenId ?? '',
      imageUrl: d.imageUrl ?? undefined,
    });
    setToast(r.message);
  };

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <header>
        <h1 className="text-xl font-bold">探索菜品</h1>
        <p className="mt-1 text-xs text-muted">按菜名、食材、分类、价格与口味组合筛选</p>
      </header>

      <div className="mt-4 flex items-center gap-2 rounded-pill border border-line bg-white px-4 py-2.5">
        <Search size={16} className="text-muted" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索菜名 / 食材 / 档口"
          aria-label="搜索菜品" className="w-full bg-transparent text-sm outline-none" />
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sg-scroll">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory(category === c ? '' : c)}
            aria-pressed={category === c} className={`sg-chip whitespace-nowrap ${category === c ? 'sg-chip-active' : ''}`}>{c}</button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {TAGS.map((t) => (
          <button key={t} type="button" onClick={() => toggleTag(t)} aria-pressed={tags.includes(t)}
            className={`sg-chip ${tags.includes(t) ? 'sg-chip-active' : ''}`}>{t}</button>
        ))}
        {PRICE_BANDS.map((b) => (
          <button key={b.label} type="button" onClick={() => setBand(band?.min === b.min ? null : b)}
            aria-pressed={band?.min === b.min} className={`sg-chip ${band?.min === b.min ? 'sg-chip-active' : ''}`}>{b.label}</button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted">共 {list.data?.meta.total ?? '—'} 道菜</p>
        {(q || category || tags.length || band) && (
          <button type="button" onClick={() => { setQ(''); setCategory(''); setTags([]); setBand(null); }} className="text-[11px] text-orange-deep">清除筛选</button>
        )}
      </div>

      {list.isPending && <div className="mt-3 flex flex-col gap-3">{[1, 2, 3].map((i) => <div key={i} className="sg-skeleton h-24" />)}</div>}
      {list.isError && <p role="alert" className="sg-card mt-3 p-4 text-xs text-red-700">菜品加载失败，请稍后重试。</p>}
      {list.data?.items.length === 0 && (
        <div className="sg-card mt-3 p-6 text-center text-xs text-muted">没有匹配的菜品，换个条件试试。</div>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {list.data?.items.map((d) => (
          <div key={d.id}>
            <DishCard
              dish={{ dishId: d.id, name: d.name, priceCents: d.priceCents, imageUrl: d.imageUrl ?? undefined, stallName: d.stall?.name }}
              onAdd={() => add(d)}
            />
            <div className="mt-1 flex items-center justify-between px-1 text-[11px] text-muted">
              <span>{d.stall?.canteen?.name} · {d.stall?.name} · {d.avgRating.toFixed(1)} 分（{d.ratingCount}）</span>
              <Link href={`/dishes/${d.id}`} className="text-orange-deep">详情 →</Link>
            </div>
          </div>
        ))}
      </div>

      {toast && <div role="status" className="fixed bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs text-white">{toast}</div>}
      <BottomNav />
    </main>
  );
}
