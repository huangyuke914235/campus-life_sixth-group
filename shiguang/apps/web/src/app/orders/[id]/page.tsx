'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, MapPin, QrCode, ReceiptText } from 'lucide-react';
import type { MealType } from '@shiguang/shared';
import { BottomNav } from '@/components/BottomNav';
import { ApiError, endpoints, get, post } from '@/lib/api';
import { formatOrderMoney, isOpenOrder, orderStatusLabel, pickupSchedule } from '@/lib/order-display';
import { shoppingLoginHref } from '@/lib/shopping-return';

interface OrderDetail {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  paymentStatus: string;
  scheduledDate: string;
  mealType: MealType;
  createdAt: string;
  cancelledReason?: string | null;
  items: { id: string; dishId: string; dishName: string; quantity: number; unitPriceCents: number; subtotalCents: number }[];
  stall: { name: string; canteen: { name: string } } | null;
  pickupSlot: { startTime: string; endTime: string } | null;
  reviews: { id: string; dishId: string }[];
}

interface PickupToken {
  code: string;
  status: string;
  qrDataUrl: string;
  expiresAt: string;
}

const statusDescription: Record<string, string> = {
  PENDING: '等待档口接单。',
  CONFIRMED: '档口已接单，请等待备餐。',
  PREPARING: '档口正在备餐。',
  READY: '菜品已备好，请向档口出示取餐凭证。',
  COMPLETED: '已完成取餐。',
  CANCELLED: '订单已取消。',
  EXPIRED: '已超过取餐时间。',
};

const formatShanghaiTime = (value: string) => new Date(value).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
});

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [expiredAt, setExpiredAt] = useState<string>();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: ({ signal }) => get<OrderDetail>(endpoints.order(id), signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: (query) => isOpenOrder(query.state.data?.status ?? '') ? 15_000 : false,
    retry: (failures, error) => !(error instanceof ApiError && (error.status === 401 || error.status === 404)) && failures < 1,
  });
  const waitingForCurrentSession = order.isFetching && !order.isFetchedAfterMount;
  const o = waitingForCurrentSession ? undefined : order.data;
  const canShowToken = !order.isError && ['READY', 'CONFIRMED', 'PREPARING'].includes(o?.status ?? '');
  const token = useQuery({
    queryKey: ['token', id],
    enabled: canShowToken,
    queryFn: ({ signal }) => get<PickupToken>(endpoints.pickupToken(id), signal),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const expiresAt = token.data?.expiresAt;

  useEffect(() => {
    if (!canShowToken || !expiresAt) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    if (remaining <= 0) {
      setExpiredAt(expiresAt);
      return;
    }
    if (remaining > 2_147_483_647) return;
    const timeout = window.setTimeout(() => setExpiredAt(expiresAt), remaining);
    return () => window.clearTimeout(timeout);
  }, [canShowToken, expiresAt]);

  const cancel = useMutation({
    mutationFn: () => post('/orders/' + id + '/cancel'),
    onSuccess: () => {
      setConfirmCancel(false);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['token', id] });
      return qc.invalidateQueries({ queryKey: ['order', id] });
    },
  });

  const loginRequired = order.error instanceof ApiError && order.error.status === 401;
  const notFound = order.error instanceof ApiError && order.error.status === 404;
  const expired = !!expiresAt && (expiresAt === expiredAt || Date.parse(expiresAt) <= Date.now());
  const usableToken = token.data?.status === 'ACTIVE' && !expired && !token.isError;
  const canRetryToken = token.isError && !expired && (!(token.error instanceof ApiError) || token.error.code !== 10014);
  const canCancel = o?.status === 'PENDING' || o?.status === 'CONFIRMED';
  const unreviewed = o?.status === 'COMPLETED' ? o.items.filter((item) => !o.reviews.some((review) => review.dishId === item.dishId)) : [];

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 pb-36 pt-6 sm:px-8 sm:pt-10">
      <Link href="/orders" className="inline-flex min-h-10 items-center gap-2 text-sm text-muted hover:text-orange-deep">
        <ArrowLeft size={16} aria-hidden /> 我的订单
      </Link>

      {(order.isPending || waitingForCurrentSession) && <div className="sg-skeleton mt-4 h-40" role="status" aria-label="正在加载订单" />}
      {order.isError && <section className="sg-card mt-4 p-5" role="alert">
        <h1 className="text-lg font-semibold">{loginRequired ? '登录后可查看订单' : notFound ? '找不到这笔订单' : '订单加载失败'}</h1>
        <p className="mt-1 break-words text-sm text-muted">{order.error.message}</p>
        {loginRequired ? <Link href={shoppingLoginHref('/orders/' + id)} className="sg-btn-primary mt-4 inline-flex">去登录</Link>
          : !notFound && <button type="button" onClick={() => void order.refetch()} className="sg-btn-primary mt-4">重新加载</button>}
      </section>}

      {o && !order.isError && (
        <>
          <header className="mb-6 mt-3">
            <p className="break-all text-xs font-medium tracking-wide text-muted">{o.number}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{orderStatusLabel(o.status)}</h1>
            <p className="mt-1 text-sm text-muted">{cancel.isSuccess ? '订单已成功取消。' : statusDescription[o.status]}</p>
          </header>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-4">
              <section className="sg-card p-4 sm:p-5">
                <h2 className="text-base font-bold">取餐信息</h2>
                <p className="mt-3 flex items-start gap-2 text-sm text-muted">
                  <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{[o.stall?.canteen.name, o.stall?.name].filter(Boolean).join(' · ') || '档口待确认'}</span>
                </p>
                <p className="mt-2 flex items-start gap-2 text-sm text-muted">
                  <CalendarDays size={16} className="mt-0.5 shrink-0" aria-hidden /> {pickupSchedule(o)}
                </p>
                <p className="mt-3 border-t border-line pt-3 text-xs text-muted">下单时间 {formatShanghaiTime(o.createdAt)}</p>
                {o.cancelledReason && <p className="mt-2 break-words text-sm text-muted">{o.cancelledReason}</p>}
              </section>

              {canShowToken && (
                <section className="sg-card p-4 sm:p-5">
                  <h2 className="flex items-center gap-2 text-base font-bold"><QrCode size={18} aria-hidden /> 取餐凭证</h2>
                  {token.isPending ? <div className="sg-skeleton mt-3 h-32" role="status" aria-label="正在加载取餐凭证" />
                    : usableToken && token.data ? (
                      <div className="mt-3 text-center">
                        {token.data.qrDataUrl && <img src={token.data.qrDataUrl} alt="取餐二维码" className="mx-auto size-36 rounded-lg bg-white p-2 sm:size-44" />}
                        <p className="mt-2 text-2xl font-bold tracking-widest tabular-nums">{token.data.code}</p>
                        <p className="mt-1 text-xs text-muted">有效至 {formatShanghaiTime(token.data.expiresAt)}（北京时间）</p>
                        {o.status !== 'READY' && <p className="mt-2 text-sm text-muted">待订单显示「待取餐」后出示凭证。</p>}
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-muted" role={token.isError ? 'alert' : 'status'}>
                        <p>{expired ? '取餐凭证已过期。' : token.isError ? token.error.message : '取餐凭证已失效。'}</p>
                        {canRetryToken && <button type="button" onClick={() => void token.refetch()} className="mt-2 min-h-11 font-semibold text-orange-deep">重新获取</button>}
                      </div>
                    )}
                </section>
              )}
            </div>

            <section className="sg-card min-w-0 p-4 sm:p-5 lg:sticky lg:top-8">
              <h2 className="flex items-center gap-2 text-base font-bold"><ReceiptText size={18} aria-hidden /> 菜品明细</h2>
              <ul className="mt-4 space-y-3">
                {o.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{item.dishName}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-muted">{formatOrderMoney(item.unitPriceCents)} × {item.quantity}</p>
                      {unreviewed.some((entry) => entry.id === item.id) && (
                        <Link href={'/review/' + o.id + '?dishId=' + encodeURIComponent(item.dishId)}
                          className="inline-flex min-h-10 items-center break-words text-sm font-semibold text-orange-deep">
                          评价「{item.dishName}」
                        </Link>
                      )}
                    </div>
                    <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{formatOrderMoney(item.subtotalCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-sm font-medium">{['CANCELLED', 'EXPIRED'].includes(o.status) ? '原订单金额' : '订单合计'}</span>
                <strong className="text-lg tabular-nums text-orange-deep">{formatOrderMoney(o.totalCents)}</strong>
              </div>
              {isOpenOrder(o.status) && <p className="mt-2 rounded-xl bg-[var(--surface-soft)] px-3 py-2 text-xs text-muted">到店付款，取餐时在档口结算。</p>}
              {o.status === 'COMPLETED' && o.paymentStatus === 'MOCK_PAID' && (
                <p className="mt-2 text-xs text-muted">到店付款 · 取餐已核销</p>
              )}
              {canCancel && (
                <div className="mt-3 border-t border-line pt-3">
                  {confirmCancel ? (
                    <>
                      <p className="text-sm font-medium">确认取消这笔预约？</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending}
                          className="min-h-11 rounded-pill border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-50 dark:text-red-200">
                          {cancel.isPending ? '正在取消…' : '确认取消'}
                        </button>
                        <button type="button" disabled={cancel.isPending} onClick={() => { setConfirmCancel(false); cancel.reset(); }}
                          className="min-h-11 rounded-pill border border-line px-3 text-sm">保留订单</button>
                      </div>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmCancel(true)} className="min-h-11 rounded-pill border border-line px-4 text-sm font-semibold">取消订单</button>
                  )}
                  {cancel.isError && <p role="alert" className="mt-2 break-words text-sm text-red-700 dark:text-red-200">{cancel.error.message}</p>}
                </div>
              )}
            </section>
          </div>
        </>
      )}
      <BottomNav />
    </main>
  );
}
