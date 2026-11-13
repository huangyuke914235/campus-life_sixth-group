'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { campusDate } from '@shiguang/shared';

interface BoardOrder {
  id: string; number: string; status: string; totalCents: number;
  items: { dishName: string; quantity: number }[];
  pickupSlot: { startTime: string; endTime: string } | null;
  user: { displayName: string } | null;
  stallId: string;
}
interface Stall { id: string; name: string; canteen: { name: string } }
const LABEL: Record<string, string> = { PENDING: '待确认', CONFIRMED: '已确认', PREPARING: '备餐中', READY: '待取餐', COMPLETED: '已完成', CANCELLED: '已取消', EXPIRED: '已过期' };
const NEXT: Record<string, { status: string; label: string } | undefined> = {
  PENDING: { status: 'CONFIRMED', label: '接单' },
  CONFIRMED: { status: 'PREPARING', label: '开始备餐' },
  PREPARING: { status: 'READY', label: '备好了' },
};

export default function AdminOrdersPage() {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [stallId, setStallId] = useState('');
  const [date, setDate] = useState(() => campusDate(new Date()));
  const [msg, setMsg] = useState('');
  const board = useQuery({
    queryKey: ['stall-board', date],
    enabled: Boolean(date),
    queryFn: () => get<BoardOrder[]>(`/orders/stall/board?date=${encodeURIComponent(date)}`),
  });
  const stalls = useQuery({ queryKey: ['managed-stalls'], queryFn: () => get<Stall[]>('/menus/manage/stalls') });
  const selectedStall = stallId || (stalls.data?.length === 1 ? stalls.data[0].id : '');
  const orders = board.data?.filter((order) => !selectedStall || order.stallId === selectedStall);

  const change = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => post(`/orders/${id}/status`, { status }),
    onSuccess: () => { setMsg('状态已更新'); qc.invalidateQueries({ queryKey: ['stall-board'] }); },
    onError: (e: Error) => setMsg(e.message),
  });

  const verify = useMutation({
    mutationFn: () => post<{ number: string }>('/pickup/verify', { code, stallId: selectedStall }),
    onSuccess: (d) => { setMsg(`核销成功：订单 ${d.number}`); setCode(''); qc.invalidateQueries({ queryKey: ['stall-board'] }); },
    onError: (e: Error) => setMsg(`核销失败：${e.message}`),
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold">订单操作台</h1>
        <p className="mt-1 text-[11px] text-muted">接单 → 备餐 → 待取餐 → 核销；核销由后端校验状态、档口与有效期，禁止重复核销</p>
      </div>

      <section className="rounded-card border border-line bg-white p-4 dark:bg-[#262B24]">
        <h2 className="text-sm font-bold">取餐码核销</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="输入 6 位取餐码" inputMode="numeric" aria-label="取餐码" className="sg-input max-w-[220px]" />
          <select value={selectedStall} onChange={(e) => setStallId(e.target.value)} aria-label="档口" className="sg-input max-w-[220px]">
            <option value="">选择档口</option>
            {stalls.data?.map((s) => <option key={s.id} value={s.id}>{s.canteen.name} · {s.name}</option>)}
          </select>
          <button type="button" disabled={code.length !== 6 || !selectedStall || verify.isPending} onClick={() => { setMsg(''); verify.mutate(); }}
            className="sg-btn-primary disabled:opacity-50">核销</button>
        </div>
        {msg && <p role="status" className="mt-2 text-xs text-sage-deep">{msg}</p>}
      </section>

      <label className="flex items-center gap-2 text-xs text-muted">订单日期
        <input type="date" aria-label="订单日期" value={date} className="sg-input w-auto"
          onChange={(event) => { if (event.target.value) setDate(event.target.value); }} />
      </label>
      {stalls.isError && <p role="alert" className="text-xs text-red-700">档口列表加载失败。</p>}
      {board.isPending && <div className="sg-skeleton h-40" />}
      {board.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">订单加载失败，可能当前账号不是商户/管理员。</p>}
      {orders?.length === 0 && <p className="text-xs text-muted">所选日期暂无订单。</p>}

      <section className="grid gap-3 lg:grid-cols-2">
        {orders?.map((o) => (
          <article key={o.id} className="rounded-card border border-line bg-white p-4 dark:bg-[#262B24]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold">{o.number}</p>
                <p className="mt-0.5 text-[11px] text-muted">{o.user?.displayName ?? '学生'} · {o.pickupSlot ? `${o.pickupSlot.startTime}–${o.pickupSlot.endTime}` : '未设时段'} · ¥{(o.totalCents / 100).toFixed(0)}</p>
              </div>
              <span className="rounded-full bg-beige px-2 py-1 text-[11px] dark:bg-[#2F362D]">{LABEL[o.status] ?? o.status}</span>
            </div>
            <p className="mt-2 text-xs">{o.items.map((i) => `${i.dishName}×${i.quantity}`).join('、')}</p>
            <div className="mt-3 flex gap-2">
              {NEXT[o.status] && (
                  <button type="button" disabled={change.isPending} onClick={() => change.mutate({ id: o.id, status: NEXT[o.status]!.status })}
                  className="rounded-full bg-orange px-3 py-1.5 text-[11px] font-semibold text-white">{NEXT[o.status]!.label}</button>
              )}
              {['PENDING', 'CONFIRMED'].includes(o.status) && (
                <button type="button" disabled={change.isPending} onClick={() => change.mutate({ id: o.id, status: 'CANCELLED' })}
                  className="rounded-full border border-line px-3 py-1.5 text-[11px] text-muted">取消</button>
              )}
              {o.status === 'READY' && <span className="text-[11px] text-muted">等待学生出示取餐码</span>}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
