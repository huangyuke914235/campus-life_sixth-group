'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';

interface StallRow {
  id: string; name: string; description: string | null; floor: string | null; windowNo: string | null;
  canteenId: string; canteen: { name: string }; _count: { dishes: number };
}
interface Canteen { id: string; name: string }

const card = 'rounded-card border border-line bg-white p-4 dark:bg-[#262B24]';

export default function AdminStallsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ canteenId: '', name: '', description: '', floor: '', windowNo: '' });
  const [msg, setMsg] = useState('');

  const canteens = useQuery({ queryKey: ['admin-canteens'], queryFn: () => get<Canteen[]>('/canteens') });
  const stalls = useQuery({
    queryKey: ['admin-stalls', filter],
    queryFn: () => get<StallRow[]>(`/stalls${filter ? `?canteenId=${filter}` : ''}`),
  });

  const create = useMutation({
    mutationFn: () => post('/stalls', {
      canteenId: form.canteenId || canteens.data?.[0]?.id,
      name: form.name,
      description: form.description || undefined,
      floor: form.floor || undefined,
      windowNo: form.windowNo || undefined,
    }),
    onSuccess: () => { setMsg('档口已创建'); setForm({ ...form, name: '', description: '', floor: '', windowNo: '' }); qc.invalidateQueries({ queryKey: ['admin-stalls'] }); },
    onError: (e: Error) => setMsg(`创建失败：${e.message}`),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">档口管理</h1>
        <p className="mt-1 text-[11px] text-muted">商户账号需在此授权后才能管理对应档口的菜品与订单</p>
      </div>

      <section className={card}>
        <h2 className="text-sm font-bold">新增档口</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <select value={form.canteenId} onChange={(e) => setForm({ ...form, canteenId: e.target.value })} aria-label="所属食堂" className="sg-input">
            <option value="">选择食堂</option>
            {canteens.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="档口名称" aria-label="档口名称" className="sg-input" />
          <input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} placeholder="楼层（选填）" aria-label="楼层" className="sg-input" />
          <input value={form.windowNo} onChange={(e) => setForm({ ...form, windowNo: e.target.value })} placeholder="窗口号（选填）" aria-label="窗口号" className="sg-input" />
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="简介（选填）" aria-label="简介" className="sg-input sm:col-span-2" />
        </div>
        <button type="button" disabled={!form.name || create.isPending} onClick={() => { setMsg(''); create.mutate(); }}
          className="sg-btn-primary mt-3 disabled:opacity-50">创建档口</button>
        {msg && <p role="status" className="mt-2 text-[11px] text-sage-deep">{msg}</p>}
      </section>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted">按食堂筛选</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="筛选食堂" className="rounded-lg border border-line bg-transparent px-2 py-1 text-[11px]">
          <option value="">全部</option>
          {canteens.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {stalls.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">档口加载失败。</p>}

      <div className="overflow-x-auto rounded-card border border-line bg-white dark:bg-[#262B24]">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="border-b border-line text-[11px] text-muted">
            <tr><th className="px-4 py-3">档口</th><th className="px-4 py-3">所属食堂</th><th className="px-4 py-3">位置</th><th className="px-4 py-3">菜品数</th></tr>
          </thead>
          <tbody>
            {stalls.data?.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-semibold">{s.name}</td>
                <td className="px-4 py-3 text-[11px] text-muted">{s.canteen.name}</td>
                <td className="px-4 py-3 text-[11px]">{[s.floor, s.windowNo ? `${s.windowNo} 号窗` : null].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-4 py-3">{s._count.dishes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {stalls.data?.length === 0 && <p className="text-xs text-muted">该食堂下还没有档口。</p>}
    </div>
  );
}
