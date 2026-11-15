'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, ReceiptText, ShoppingBag, Store } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { ApiError, endpoints, get } from '@/lib/api';
import { formatOrderMoney, isOpenOrder, orderStatusColor, orderStatusLabel, pickupSchedule } from '@/lib/order-display';
import { shoppingLoginHref } from '@/lib/shopping-return';
import type { MealType } from '@shiguang/shared';

interface OrderRow {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  scheduledDate: string;
  mealType: MealType;
  items: { id: string; dishName: string; quantity: number }[];
  stall: { name: string; canteen?: { name: string } } | null;
  pickupSlot: { startTime: string; endTime: string } | null;
}

interface OrderPage {
  items: OrderRow[];
  meta: { page: number; total: number; totalPages: number };
}

export default function OrdersPage() {
  const [page, setPage] = useState(1);
  const orders = useQuery({
    queryKey: ['orders', page],
    queryFn: ({ signal }) => get<OrderPage>(endpoints.orders + '?page=' + page, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: (query) => query.state.data?.items.some((order) => isOpenOrder(order.status)) ? 15_000 : false,
    retry: (failures, error) => !(error instanceof ApiError && error.status === 401) && failures < 1,
  });

  const waitingForCurrentSession = orders.isFetching && !orders.isFetchedAfterMount;
  const result = orders.isError || waitingForCurrentSession ? undefined : orders.data;
  const loginRequired = orders.error instanceof ApiError && orders.error.status === 401;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 pb-36 pt-6 sm:px-8 sm:pt-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">我的订单</h1>
          {result && <p className="mt-1 text-sm text-muted">共 {result.meta.total} 笔订单</p>}
        </div>
        <Link href="/cart" className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line px-4 text-sm font-semibold hover:border-orange">
          <ShoppingBag size={17} aria-hidden /> 购物车
        </Link>
      </header>

      {(orders.isPending || waitingForCurrentSession) && <div className="grid gap-3 md:grid-cols-2" role="status" aria-label="正在加载订单">
        {[1, 2, 3].map((item) => <div key={item} className="sg-skeleton h-36" />)}
      </div>}
      {orders.isError && <section className="sg-card p-5" role="alert">
        <p className="font-semibold">{loginRequired ? '登录后可查看订单' : '订单加载失败'}</p>
        <p className="mt-1 break-words text-sm text-muted">{orders.error.message}</p>
        {loginRequired ? (
          <Link href={shoppingLoginHref('/orders')} className="sg-btn-primary mt-4 inline-flex">去登录</Link>
        ) : (
          <button type="button" onClick={() => void orders.refetch()} className="sg-btn-primary mt-4">重新加载</button>
        )}
      </section>}
      {result?.items.length === 0 && (
        <section className="sg-card flex flex-col items-center px-6 py-10 text-center">
          <ReceiptText size={28} className="text-orange-deep" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold">{page === 1 ? '还没有订单' : '这一页没有订单'}</h2>
          {page === 1
            ? <Link href="/discover" className="sg-btn-primary mt-4">去选菜</Link>
            : <button type="button" onClick={() => setPage(1)} className="sg-btn-primary mt-4">返回第一页</button>}
        </section>
      )}

      {result && result.items.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 md:gap-4" aria-label="订单列表">
          {result.items.map((order) => (
            <li key={order.id} className="sg-card min-w-0">
              <Link href={'/orders/' + order.id} className="block h-full rounded-card p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="break-all text-xs font-medium tracking-wide text-muted">{order.number}</p>
                  <span className={'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ' + orderStatusColor(order.status)}>{orderStatusLabel(order.status)}</span>
                </div>
                <h2 className="mt-2 break-words text-base font-bold leading-snug">
                  {order.items.map((item) => item.dishName + ' ×' + item.quantity).join('、') || '菜品明细'}
                </h2>
                <p className="mt-2 flex items-start gap-2 text-sm text-muted">
                  <Store size={15} className="mt-0.5 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{[order.stall?.canteen?.name, order.stall?.name].filter(Boolean).join(' · ') || '档口待确认'}</span>
                </p>
                <p className="mt-1 flex items-start gap-2 text-sm text-muted">
                  <CalendarDays size={15} className="mt-0.5 shrink-0" aria-hidden /> <span>{pickupSchedule(order)}</span>
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  <strong className="text-lg tabular-nums">{formatOrderMoney(order.totalCents)}</strong>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-orange-deep">
                    {order.status === 'READY' ? '查看取餐凭证' : '查看详情'} <ChevronRight size={17} aria-hidden />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result && result.meta.totalPages > 1 && (
        <nav aria-label="订单分页" className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:gap-4">
          <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1}
            className="inline-flex min-h-11 items-center gap-1 rounded-pill border border-line px-3 text-sm font-semibold disabled:opacity-40">
            <ChevronLeft size={16} aria-hidden /> 上一页
          </button>
          <span aria-live="polite" className="text-sm tabular-nums text-muted">第 {page} / {result.meta.totalPages} 页</span>
          <button type="button" onClick={() => setPage(page + 1)} disabled={page >= result.meta.totalPages}
            className="inline-flex min-h-11 items-center gap-1 rounded-pill border border-line px-3 text-sm font-semibold disabled:opacity-40">
            下一页 <ChevronRight size={16} aria-hidden />
          </button>
        </nav>
      )}
      <BottomNav />
    </main>
  );
}
