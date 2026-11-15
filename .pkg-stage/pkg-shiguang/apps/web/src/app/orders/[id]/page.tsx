'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, MapPin } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { get, post } from '@/lib/api';

interface OrderDetail {
  id: string; number: string; status: string; totalCents: number; paymentStatus: string; scheduledDate: string;
  createdAt: string; completedAt: string | null; cancelledAt: string | null;
  items: { id: string; dishId: string; dishName: string; quantity: number; unitPriceCents: number; subtotalCents: number }[];
  stall: { name: string; canteen: { name: string } };
  pickupSlot: { startTime: string; endTime: string } | null;
  pickupToken: { code: string; status: string; qrPayload: string } | null;
  reviews: { id: string; dishId: string }[];
}
const LABEL: Record<string, string> = {
  PENDING: '待确认', CONFIRMED: '已确认', PREPARING: '备餐中', READY: '待取餐',
  COMPLETED: '已完成', CANCELLED: '已取消', EXPIRED: '已过期',
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const order = useQuery({
    queryKey: ['order', id], queryFn: () => get<OrderDetail>(`/orders/${id}`),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'].includes(query.state.data?.status ?? '') ? 15_000 : false,
  });
  const canShowToken = ['READY', 'CONFIRMED', 'PREPARING'].includes(order.data?.status ?? '');
  const token = useQuery({
    queryKey: ['token', id],
    enabled: canShowToken,
    queryFn: () => get<{ code: string; qrDataUrl: string; slot: string; expiresAt: string }>(`/pickup/orders/${id}/token`),
  });
  const cancel = useMutation({
    mutationFn: () => post(`/orders/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['order', id] }),
  });

  const o = order.data;
  const unreviewed = o?.status === 'COMPLETED' ? o.items.filter((i) => !o.reviews.some((r) => r.dishId === i.dishId)) : [];

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <Link href="/orders" className="text-xs text-muted">← 我的订单</Link>

      {order.isPending && <div className="sg-skeleton mt-4 h-40" />}
      {order.isError && <p role="alert" className="sg-card mt-4 p-4 text-xs text-red-700">订单加载失败。</p>}

      {o && (
        <>
          <header className="mt-3 flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold">{LABEL[o.status] ?? o.status}</h1>
              <p className="mt-1 text-[11px] text-muted">{o.number} · {new Date(o.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
            </div>
            <p className="text-lg font-bold text-orange-deep">¥{(o.totalCents / 100).toFixed(2)}</p>
          </header>

          <section className="sg-card mt-4 p-4">
            <div className="flex items-center gap-3 text-[11px] text-muted">
              <MapPin size={12} aria-hidden />{o.stall.canteen.name} · {o.stall.name}
            </div>
            {o.pickupSlot && (
              <div className="mt-1 flex items-center gap-3 text-[11px] text-muted">
                <Clock size={12} aria-hidden />取餐时段 {o.scheduledDate.slice(0, 10)} · {o.pickupSlot.startTime}–{o.pickupSlot.endTime}
              </div>
            )}
            <p className="mt-2 rounded-lg bg-beige px-2 py-1.5 text-[11px] text-muted dark:bg-[#2F362D]">
              支付：{o.paymentStatus === 'MOCK_PAID' ? '到店付款 · 已结算' : '到店付款 · 待结算'}
            </p>
          </section>

          <section className="sg-card mt-4 p-4">
            <h2 className="text-sm font-bold">菜品明细</h2>
            <ul className="mt-3 flex flex-col gap-2 text-xs">
              {o.items.map((i) => (
                <li key={i.id} className="flex justify-between">
                  <span>{i.dishName} × {i.quantity}</span>
                  <span className="text-muted">¥{(i.subtotalCents / 100).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </section>

          {canShowToken && token.isError && <p role="alert" className="sg-card mt-4 p-4 text-xs text-red-700">{token.error.message}</p>}
          {canShowToken && token.data && (
            <section className="sg-card mt-4 p-4 text-center">
              <h2 className="text-sm font-bold">取餐凭证</h2>
              {token.data.qrDataUrl && <img src={token.data.qrDataUrl} alt="取餐二维码" className="mx-auto mt-2 h-44 w-44" />}
              <p className="mt-1 text-2xl font-bold tracking-widest">{token.data.code}</p>
              <p className="mt-1 text-[11px] text-muted">{token.data.slot} · 由档口扫码或输入码核销</p>
            </section>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {unreviewed.map((i) => (
              <Link key={i.id} href={`/review/${o.id}`} className="rounded-full bg-sage px-4 py-2 text-xs font-semibold text-white">
                评价「{i.dishName}」
              </Link>
            ))}
            {['PENDING', 'CONFIRMED'].includes(o.status) && (
              <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending}
                className="rounded-full border border-line px-4 py-2 text-xs text-muted disabled:opacity-50">取消订单</button>
            )}
            <Link href="/discover" className="rounded-full border border-line px-4 py-2 text-xs text-muted">继续逛</Link>
          </div>
          {cancel.isError && <p role="alert" className="mt-3 text-xs text-red-700">{cancel.error.message}</p>}

          <p className="mt-4 text-[11px] leading-5 text-muted">
            订单状态由后端状态机控制，前端不可跳转；取餐码核销后不可重复使用。
          </p>
        </>
      )}
      <BottomNav />
    </main>
  );
}
