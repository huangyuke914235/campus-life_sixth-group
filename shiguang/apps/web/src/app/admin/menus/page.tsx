'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { endpoints, get, post, patch } from '@/lib/api';
import { campusDate, campusMealType } from '@shiguang/shared';
import { MEAL_LABELS } from '@/lib/meals';
import { formatOrderMoney } from '@/lib/order-display';

interface MenuItem { id: string; dishId: string; isAvailable: boolean; inventoryId: string | null; stockTotal: number; stockRemaining: number; stockVersion: number | null; dish: { name: string; priceCents: number; status: string } }
interface Menu { id: string; stallId: string; mealType: string; status: string; items: MenuItem[]; stall: { name: string; canteen: { name: string } } }
interface Stall { id: string; name: string; canteen: { name: string } }
interface Dish { id: string; name: string; priceCents: number; status: string }
interface PickupSlot { id: string; startTime: string; endTime: string; capacity: number; booked: number; isClosed: boolean }

const card = 'rounded-card border border-line bg-white p-4 dark:bg-[#262B24]';
export default function AdminMenusPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => campusDate(new Date()));
  const [mealType, setMealType] = useState<string>(() => campusMealType(new Date()));
  const [stallId, setStallId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [slot, setSlot] = useState({ startTime: '11:30', endTime: '11:45', capacity: '20', cutoffMinutes: '15' });

  const stalls = useQuery({ queryKey: ['managed-stalls'], queryFn: () => get<Stall[]>('/menus/manage/stalls') });
  const menus = useQuery({
    queryKey: ['admin-menus', date, mealType, stallId],
    enabled: !!date && !!stallId,
    queryFn: () => get<Menu[]>(`/menus/manage?${new URLSearchParams({ date, mealType, stallId })}`),
  });
  const dishes = useQuery({
    queryKey: ['admin-dishes-by-stall', stallId],
    enabled: !!stallId,
    queryFn: () => get<{ items: Dish[] }>(`/dishes?stallId=${stallId}&pageSize=50`),
  });
  const slots = useQuery({
    queryKey: ['slots', stallId, date, mealType],
    enabled: !!date && !!stallId,
    queryFn: () => get<PickupSlot[]>(endpoints.pickupSlots(stallId, date, mealType)),
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
    mutationFn: ({ inventoryId, remaining, expectedVersion }: { inventoryId: string; remaining: number; expectedVersion: number }) =>
      patch(`/menus/inventory/${inventoryId}`, { remaining, expectedVersion }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-menus'] }),
    onError: (e: Error) => {
      setMsg(`改库存失败：${e.message}`);
      void qc.invalidateQueries({ queryKey: ['admin-menus'] });
    },
  });
  const toggleItem = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) => patch(`/menus/items/${id}`, { isAvailable }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-menus'] }),
    onError: (e: Error) => setMsg(`更新状态失败：${e.message}`),
  });
  const createSlot = useMutation({
    mutationFn: () => post('/pickup/slots', {
      ...slot, stallId, date, mealType, capacity: Number(slot.capacity), cutoffMinutes: Number(slot.cutoffMinutes),
    }),
    onSuccess: () => {
      setMsg('取餐时段已添加');
      void qc.invalidateQueries({ queryKey: ['slots', stallId, date, mealType] });
    },
    onError: (e: Error) => setMsg(`取餐时段添加失败：${e.message}`),
  });
  const canAddSlot = !!slot.startTime && slot.startTime < slot.endTime &&
    !!slot.capacity && Number.isInteger(Number(slot.capacity)) && Number(slot.capacity) > 0 &&
    !!slot.cutoffMinutes && Number.isInteger(Number(slot.cutoffMinutes)) && Number(slot.cutoffMinutes) >= 0;

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
              {Object.entries(MEAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">档口
            <select value={stallId} onChange={(e) => { setStallId(e.target.value); setPicked([]); }} className="sg-input min-w-[200px] py-1.5 text-xs">
              <option value="">选择档口</option>
              {stalls.data?.map((s) => <option key={s.id} value={s.id}>{s.canteen.name} · {s.name}</option>)}
            </select>
          </label>
          {stallId && date && (
            <button type="button" onClick={() => copy.mutate()} disabled={copy.isPending}
              className="rounded-pill border border-line px-3 py-2 text-[11px] disabled:opacity-50">复制昨日</button>
          )}
        </div>
        {(stalls.isError || menus.isError) && <p role="alert" className="mt-2 text-xs text-red-700">菜单或档口加载失败，请刷新后重试。</p>}
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
                  className={`sg-chip ${on ? 'sg-chip-active' : ''}`}>{d.name} · {formatOrderMoney(d.priceCents)}</button>
              );
            })}
            {dishes.data?.items.length === 0 && <span className="text-xs text-muted">该档口还没有菜品。</span>}
          </div>
          <button type="button" disabled={!date || !picked.length || publish.isPending} onClick={() => { setMsg(''); publish.mutate(); }}
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
                  <p className="text-[11px] text-muted">
                    {formatOrderMoney(i.dish.priceCents)} · {i.inventoryId ? `可售 ${i.stockRemaining} / 总量 ${i.stockTotal}` : '未配置库存'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {i.inventoryId && i.stockVersion !== null && (
                    <input key={i.stockVersion} type="number" min={0} max={i.stockTotal} defaultValue={i.stockRemaining} aria-label={`${i.dish.name} 可售数量`}
                      disabled={setStock.isPending}
                      onBlur={(e) => {
                        const v = e.target.valueAsNumber;
                        if (Number.isInteger(v) && v !== i.stockRemaining) {
                          setStock.mutate({ inventoryId: i.inventoryId!, remaining: v, expectedVersion: i.stockVersion! });
                        }
                      }}
                      className="w-20 rounded-lg border border-line bg-transparent px-2 py-1 text-xs" />
                  )}
                  <button type="button" disabled={toggleItem.isPending || i.dish.status !== 'ACTIVE'}
                    onClick={() => toggleItem.mutate({ id: i.id, isAvailable: !i.isAvailable })}
                    className={`rounded-full px-2.5 py-1 text-[11px] ${i.isAvailable ? 'bg-sage-light text-sage-deep' : 'bg-beige text-muted'}`}>
                    {i.dish.status !== 'ACTIVE' ? '已下架' : i.isAvailable ? '在售' : '已停售'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {stallId && !current && menus.isSuccess && (
        <p className="text-xs text-muted">该档口在 {date} 的该餐次还没有菜单，可在上方选择菜品发布。</p>
      )}
      {stallId && date && (
        <section className={card}>
          <h2 className="text-sm font-bold">取餐时段与容量</h2>
          {slots.isError && <p role="alert" className="mt-2 text-xs text-red-700">取餐时段加载失败。</p>}
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {slots.data?.map((item) => (
              <li key={item.id}>{item.startTime}–{item.endTime} · 已预约 {item.booked} / {item.capacity}{item.isClosed ? ' · 已关闭' : ''}</li>
            ))}
          </ul>
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
            event.preventDefault();
            if (canAddSlot) createSlot.mutate();
          }}>
            <label className="flex flex-col gap-1 text-[11px] text-muted">开始时间
              <input type="time" value={slot.startTime} required className="sg-input" onChange={(event) => setSlot({ ...slot, startTime: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">结束时间
              <input type="time" value={slot.endTime} required className="sg-input" onChange={(event) => setSlot({ ...slot, endTime: event.target.value })} />
            </label>
            <label className="flex w-24 flex-col gap-1 text-[11px] text-muted">预约容量
              <input type="number" min={1} value={slot.capacity} required className="sg-input" onChange={(event) => setSlot({ ...slot, capacity: event.target.value })} />
            </label>
            <label className="flex w-32 flex-col gap-1 text-[11px] text-muted">提前截止（分钟）
              <input type="number" min={0} value={slot.cutoffMinutes} required className="sg-input" onChange={(event) => setSlot({ ...slot, cutoffMinutes: event.target.value })} />
            </label>
            <button type="submit" disabled={!canAddSlot || createSlot.isPending} className="sg-btn-primary disabled:opacity-50">添加时段</button>
          </form>
        </section>
      )}
    </div>
  );
}
