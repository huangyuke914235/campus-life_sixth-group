'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post } from '@/lib/api';
import { formatOrderMoney, orderStatusLabel } from '@/lib/order-display';
import { campusDate } from '@shiguang/shared';

interface BoardOrder {
  id: string; number: string; status: string; totalCents: number;
  items: { dishName: string; quantity: number }[];
  pickupSlot: { startTime: string; endTime: string } | null;
  user: { displayName: string } | null;
  stallId: string;
  stall: { name: string };
}
interface BoardPage {
  items: BoardOrder[];
  meta: { page: number; total: number; totalPages: number };
}
interface Stall { id: string; name: string; canteen: { name: string } }
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
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState('');
  const stalls = useQuery({ queryKey: ['managed-stalls'], queryFn: () => get<Stall[]>('/menus/manage/stalls') });
  const selectedStall = stallId || (stalls.data?.length === 1 ? stalls.data[0].id : '');
  const board = useQuery({
    queryKey: ['stall-board', date, selectedStall, activeOnly, page],
    enabled: Boolean(date),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ date, activeOnly: String(activeOnly), page: String(page) });
      if (selectedStall) params.set('stallId', selectedStall);
      return get<BoardPage>('/orders/stall/board?' + params, signal);
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const forbidden = board.error instanceof ApiError && board.error.status === 403;
  const orders = forbidden ? undefined : board.data?.items;
  const meta = forbidden ? undefined : board.data?.meta;

  function refreshBoard() {
    return qc.invalidateQueries({ queryKey: ['stall-board'] });
  }

  const change = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => post(`/orders/${id}/status`, { status }),
    onSuccess: () => { setMsg('状态已更新'); return refreshBoard(); },
    onError: (e: Error) => {
      setMsg(e.message);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) void refreshBoard();
    },
  });

  const verify = useMutation({
    mutationFn: () => post<{ number: string }>('/pickup/verify', { code, stallId: selectedStall }),
    onSuccess: (d) => { setMsg(`核销成功：订单 ${d.number}`); setCode(''); return refreshBoard(); },
    onError: (e: Error) => {
      setMsg(`核销失败：${e.message}`);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) void refreshBoard();
    },
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
          <input value={code} disabled={verify.isPending} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="输入 6 位取餐码" inputMode="numeric" aria-label="取餐码" className="sg-input max-w-[220px]" />
          <select value={selectedStall} disabled={verify.isPending || stalls.isPending}
            onChange={(e) => { setStallId(e.target.value); setPage(1); }} aria-label="档口" className="sg-input max-w-[220px]">
            <option value="" disabled={stalls.data?.length === 1}>全部授权档口</option>
            {stalls.data?.map((s) => <option key={s.id} value={s.id}>{s.canteen.name} · {s.name}</option>)}
          </select>
          <button type="button" disabled={code.length !== 6 || !selectedStall || verify.isPending} onClick={() => { setMsg(''); verify.mutate(); }}
            className="sg-btn-primary disabled:opacity-50">核销</button>
        </div>
        {msg && <p role="status" className="mt-2 text-xs text-sage-deep">{msg}</p>}
      </section>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">订单日期
          <input type="date" aria-label="订单日期" value={date} className="sg-input w-auto"
            onChange={(event) => { if (event.target.value) { setDate(event.target.value); setPage(1); } }} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">订单范围
          <select value={activeOnly ? 'active' : 'all'} className="sg-input w-auto"
            onChange={(event) => { setActiveOnly(event.target.value === 'active'); setPage(1); }}>
            <option value="active">待处理订单</option>
            <option value="all">全部订单</option>
          </select>
        </label>
        <button type="button" onClick={() => void board.refetch()} disabled={board.isFetching}
          className="min-h-11 rounded-pill border border-line px-4 text-xs font-semibold disabled:opacity-50">刷新订单</button>
      </div>
      {stalls.isError && <p role="alert" className="text-xs text-red-700">档口列表加载失败。</p>}
      {board.isPending && <div className="sg-skeleton h-40" />}
      {board.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">订单加载失败：{board.error.message}</p>}
      {orders?.length === 0 && <p className="text-xs text-muted">{activeOnly ? '所选日期和档口暂无待处理订单。' : '所选日期和档口暂无订单。'}</p>}
      {!!meta?.total && <p className="text-xs text-muted">共 {meta.total} 笔订单</p>}

      <section className="grid gap-3 lg:grid-cols-2">
        {orders?.map((o) => (
          <article key={o.id} className="rounded-card border border-line bg-white p-4 dark:bg-[#262B24]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-all text-sm font-bold">{o.number}</p>
                <p className="mt-0.5 break-words text-[11px] text-muted">{o.stall.name} · {o.user?.displayName ?? '学生'} · {o.pickupSlot ? `${o.pickupSlot.startTime}–${o.pickupSlot.endTime}` : '未设时段'} · {formatOrderMoney(o.totalCents)}</p>
              </div>
              <span className="shrink-0 rounded-full bg-beige px-2 py-1 text-[11px] dark:bg-[#2F362D]">{orderStatusLabel(o.status)}</span>
            </div>
            <p className="mt-2 break-words text-xs">{o.items.map((i) => `${i.dishName}×${i.quantity}`).join('、')}</p>
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
      {meta && meta.totalPages > 1 && (
        <nav aria-label="商户订单分页" className="flex flex-wrap items-center justify-center gap-3 text-xs">
          <button type="button" onClick={() => setPage(meta.page - 1)} disabled={meta.page <= 1}
            className="min-h-11 rounded-pill border border-line px-4 font-semibold disabled:opacity-40">上一页</button>
          <span>第 {meta.page} / {meta.totalPages} 页</span>
          <button type="button" onClick={() => setPage(meta.page + 1)} disabled={meta.page >= meta.totalPages}
            className="min-h-11 rounded-pill border border-line px-4 font-semibold disabled:opacity-40">下一页</button>
        </nav>
      )}
    </div>
  );
}
