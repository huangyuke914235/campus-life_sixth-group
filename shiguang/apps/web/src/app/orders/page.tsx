'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QrCode, X } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { get, post, endpoints } from '@/lib/api';

interface OrderRow {
  id: string; number: string; status: string; totalCents: number; createdAt: string;
  items: { dishName: string; quantity: number }[];
  stall: { name: string } | null;
  reviews?: { id: string; dishId: string }[];
}
interface Token { code: string; qrDataUrl: string; slot: string; expiresAt: string }
const STATUS_LABEL: Record<string, string> = {
  PENDING: '待确认', CONFIRMED: '已确认', PREPARING: '备餐中', READY: '待取餐',
  COMPLETED: '已完成', CANCELLED: '已取消', EXPIRED: '已过期',
};

export default function OrdersPage() {
  const qc = useQueryClient();
  const [tokenOrder, setTokenOrder] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => get<{ items: OrderRow[] }>(endpoints.orders) });
  const token = useQuery({
    queryKey: ['token', tokenOrder], enabled: !!tokenOrder,
    queryFn: () => get<Token>(endpoints.pickupToken(tokenOrder!)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => post(`/orders/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <h1 className="text-xl font-bold">我的订单</h1>
      <p className="mt-1 text-xs text-muted">当前订单与历史订单 · 取餐凭证由后端核销</p>

      {orders.isPending && <div className="mt-5 flex flex-col gap-3">{[1, 2, 3].map((i) => <div key={i} className="sg-skeleton h-24" />)}</div>}
      {orders.isError && <div role="alert" className="sg-card mt-5 p-4 text-xs text-red-700">订单加载失败，请稍后重试。</div>}
      {orders.data?.items.length === 0 && <div className="sg-card mt-5 p-6 text-center text-xs text-muted">还没有订单，先去选一道菜吧。</div>}

      <div className="mt-5 flex flex-col gap-3">
        {orders.data?.items.map((o) => (
          <article key={o.id} className="sg-card p-4">
            <div className="flex items-start justify-between">
              <div><p className="text-sm font-bold">{o.items.map((i) => i.dishName).join('、')}</p>
                <p className="mt-1 text-[11px] text-muted">{o.number} · {o.stall?.name ?? '档口'} · ¥{(o.totalCents / 100).toFixed(0)}</p></div>
              <span className="rounded-full bg-beige px-2 py-1 text-[11px] font-medium dark:bg-[#2F362D]">{STATUS_LABEL[o.status] ?? o.status}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {['READY', 'CONFIRMED', 'PREPARING'].includes(o.status) && (
                <button type="button" onClick={() => setTokenOrder(o.id)} className="flex items-center gap-1 rounded-full bg-orange px-3 py-1.5 text-[11px] font-semibold text-white">
                  <QrCode size={12} aria-hidden /> 取餐码
                </button>
              )}
              {o.status === 'COMPLETED' && (o.reviews?.length ?? 0) < o.items.length && (
                <Link href={`/review/${o.id}`} className="rounded-full bg-sage px-3 py-1.5 text-[11px] font-semibold text-white">评价这一餐</Link>
              )}
              {['PENDING', 'CONFIRMED'].includes(o.status) && (
                <button type="button" onClick={() => cancel.mutate(o.id)} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[11px] text-muted">
                  <X size={12} aria-hidden /> 取消
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {tokenOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4" onClick={() => setTokenOrder(null)}>
          <div className="w-full max-w-sm rounded-card bg-white p-5 dark:bg-[#262B24]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold">取餐凭证</h2>
            {token.isPending && <div className="sg-skeleton mt-4 h-40" />}
            {token.data && (
              <div className="mt-4 text-center">
                {token.data.qrDataUrl && <img src={token.data.qrDataUrl} alt="取餐二维码" className="mx-auto h-40 w-40" />}
                <p className="mt-2 text-2xl font-bold tracking-widest">{token.data.code}</p>
                <p className="mt-1 text-[11px] text-muted">{token.data.slot} · 请向档口出示核销</p>
              </div>
            )}
            <button type="button" onClick={() => setTokenOrder(null)} className="sg-btn-primary mt-5 w-full text-xs">关闭</button>
          </div>
        </div>
      )}
      <BottomNav />
    </main>
  );
}
