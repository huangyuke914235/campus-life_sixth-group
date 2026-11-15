'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, patch } from '@/lib/api';

interface MenuItem { id: string; dishId: string; isAvailable: boolean; inventoryId: string | null; stockTotal: number; stockRemaining: number; dish: { name: string; priceCents: number } }
interface Menu { id: string; stallId: string; mealType: string; status: string; items: MenuItem[]; stall: { name: string; canteen: { name: string } } }
interface Stall { id: string; name: string; canteen: { name: string } }
interface Dish { id: string; name: string; priceCents: number; status: string }

const card = 'rounded-card border border-line bg-white p-4 dark:bg-[#262B24]';
const MEALS = [{ k: 'BREAKFAST', t: '早餐' }, { k: 'LUNCH', t: '午餐' }, { k: 'DINNER', t: '晚餐' }];

export default function AdminMenusPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mealType, setMealType] = useState('LUNCH');
  const [stallId, setStallId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState('');

  const stalls = useQuery({ queryKey: ['admin-stalls', ''], queryFn: () => get<Stall[]>('/stalls') });
  const menus = useQuery({
    queryKey: ['admin-menus', date, mealType, stallId],
    queryFn: () => get<Menu[]>(`/menus?date=${date}&mealType=${mealType}${stallId ? `&stallId=${stallId}` : ''}`),
  });
  const dishes = useQuery({
    queryKey: ['admin-dishes-by-stall', stallId],
    enabled: !!stallId,
    queryFn: () => get<{ items: Dish[] }>(`/dishes?stallId=${stallId}&pageSize=50`),
  });

  const current = useMemo(() => menus.data?.find((m) => m.stallId === stallId), [menus.data, stallId]);

  const publish = useMutation({
    mutationFn: () => post('/menus/publish', { stallId, date, mealType, dishIds: picked, defaultStock: 30 }),
    onSuccess: () => { setMsg(`已发布 ${picked.length} 道菜`); setPicked([]); qc.invalidateQueries({ queryKey: ['admin-menus'] }); },
    onError: (e: Error) => setMsg(`发布失败：${e.message}`),
  });
  const copy = useMutation({
    mutationFn: () => post('/menus/copy-yesterday', { stallId, date, mealType }),
    onSuccess: () => { setMsg('已复制昨日菜单'); qc.invalidateQueries({ queryKey: ['admin-menus'] }); },
    onError: (e: Error) => setMsg(`复制失败：${e.message}`),
  });
  const setStock = useMutation({
    mutationFn: ({ inventoryId, remaining }: { inventoryId: string; remaining: number }) => patch(`/menus/inventory/${inventoryId}`, { remaining }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-menus'] }),
    onError: (e: Error) => setMsg(`改库存失败：${e.message}`),
  });
  const toggleItem = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) => patch(`/menus/items/${id}`, { isAvailable }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-menus'] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">每日菜单</h1>
        <p className="mt-1 text-[11px] text-muted">发布后学生端可见；库存按「菜品 + 日期 + 餐次」独立记账</p>
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted">日期
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="sg-input py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">餐次
            <select value={mealType} onChange={(e) => setMealType(e.target.value)} className="sg-input py-1.5 text-xs">
              {MEALS.map((m) => <option key={m.k} value={m.k}>{m.t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">档口
            <select value={stallId} onChange={(e) => { setStallId(e.target.value); setPicked([]); }} className="sg-input min-w-[200px] py-1.5 text-xs">
              <option value="">选择档口</option>
              {stalls.data?.map((s) => <option key={s.id} value={s.id}>{s.canteen.name} · {s.name}</option>)}
            </select>
          </label>
          {stallId && (
            <button type="button" onClick={() => copy.mutate()} disabled={copy.isPending}
              className="rounded-pill border border-line px-3 py-2 text-[11px] disabled:opacity-50">复制昨日</button>
          )}
        </div>
        {msg && <p role="status" className="mt-2 text-[11px] text-sage-deep">{msg}</p>}
      </section>

      {stallId && (
        <section className={card}>
          <h2 className="text-sm font-bold">发布菜单（本档口在架菜品）</h2>
          {dishes.isPending && <div className="sg-skeleton mt-2 h-16" />}
          <div className="mt-3 flex flex-wrap gap-2">
            {dishes.data?.items.filter((d) => d.status === 'ACTIVE').map((d) => {
              const on = picked.includes(d.id);
              return (
                <button key={d.id} type="button" aria-pressed={on}
                  onClick={() => setPicked((p) => (p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]))}
                  className={`sg-chip ${on ? 'sg-chip-active' : ''}`}>{d.name} · ¥{(d.priceCents / 100).toFixed(0)}</button>
              );
            })}
            {dishes.data?.items.length === 0 && <span className="text-xs text-muted">该档口还没有菜品。</span>}
          </div>
          <button type="button" disabled={!picked.length || publish.isPending} onClick={() => { setMsg(''); publish.mutate(); }}
            className="sg-btn-primary mt-3 disabled:opacity-50">发布 {picked.length || ''} 道菜</button>
        </section>
      )}

      {current && (
        <section className={card}>
          <h2 className="text-sm font-bold">当前菜单 · {current.stall.canteen.name} {current.stall.name}</h2>
          <div className="mt-3 flex flex-col gap-2">
            {current.items.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <div>
                  <p className="text-xs font-semibold">{i.dish.name}</p>
                  <p className="text-[11px] text-muted">¥{(i.dish.priceCents / 100).toFixed(0)} · 已售 {i.stockTotal - i.stockRemaining} / {i.stockTotal}</p>
                </div>
                <div className="flex items-center gap-2">
                  {i.inventoryId && (
                    <input type="number" min={0} max={i.stockTotal} defaultValue={i.stockRemaining} aria-label={`${i.dish.name} 可售数量`}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== i.stockRemaining) setStock.mutate({ inventoryId: i.inventoryId!, remaining: v });
                      }}
                      className="w-20 rounded-lg border border-line bg-transparent px-2 py-1 text-xs" />
                  )}
                  <button type="button" onClick={() => toggleItem.mutate({ id: i.id, isAvailable: !i.isAvailable })}
                    className={`rounded-full px-2.5 py-1 text-[11px] ${i.isAvailable ? 'bg-sage-light text-sage-deep' : 'bg-beige text-muted'}`}>
                    {i.isAvailable ? '在售' : '已停售'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {stallId && !current && !menus.isPending && (
        <p className="text-xs text-muted">该档口在 {date} 的该餐次还没有菜单，可在上方选择菜品发布。</p>
      )}
    </div>
  );
}
