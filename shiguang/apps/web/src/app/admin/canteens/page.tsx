'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, put } from '@/lib/api';

interface Canteen {
  id: string; name: string; location: string; description: string | null;
  openTime: string; closeTime: string; isOpen: boolean; notice: string | null;
  stallCount: number; currentlyOpen: boolean;
}

const card = 'rounded-card border border-line bg-white p-4 dark:bg-[#262B24]';
const EMPTY = { name: '', location: '', description: '', openTime: '07:00', closeTime: '20:30', notice: '' };

export default function AdminCanteensPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const list = useQuery({ queryKey: ['admin-canteens'], queryFn: () => get<Canteen[]>('/canteens') });

  const save = useMutation({
    mutationFn: () => (editingId
      ? put(`/canteens/${editingId}`, form)
      : post('/canteens', form)),
    onSuccess: () => { setMsg(editingId ? '已更新' : '已创建'); setForm({ ...EMPTY }); setEditingId(null); qc.invalidateQueries({ queryKey: ['admin-canteens'] }); },
    onError: (e: Error) => setMsg(`保存失败：${e.message}`),
  });

  const toggleOpen = useMutation({
    mutationFn: ({ id, isOpen }: { id: string; isOpen: boolean }) => put(`/canteens/${id}`, { isOpen }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-canteens'] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">食堂管理</h1>
        <p className="mt-1 text-[11px] text-muted">营业状态影响学生端展示；公告会出现在食堂详情页</p>
      </div>

      <section className={card}>
        <h2 className="text-sm font-bold">{editingId ? '编辑食堂' : '新增食堂'}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="食堂名称" aria-label="名称" className="sg-input" />
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="位置" aria-label="位置" className="sg-input" />
          <input value={form.openTime} onChange={(e) => setForm({ ...form, openTime: e.target.value })} placeholder="07:00" aria-label="开始营业" className="sg-input" />
          <input value={form.closeTime} onChange={(e) => setForm({ ...form, closeTime: e.target.value })} placeholder="20:30" aria-label="结束营业" className="sg-input" />
          <input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="简介（选填）" aria-label="简介" className="sg-input sm:col-span-2" />
          <input value={form.notice ?? ''} onChange={(e) => setForm({ ...form, notice: e.target.value })} placeholder="公告（选填）" aria-label="公告" className="sg-input sm:col-span-2" />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={!form.name || !form.location || save.isPending} onClick={() => { setMsg(''); save.mutate(); }}
            className="sg-btn-primary disabled:opacity-50">{editingId ? '保存修改' : '创建'}</button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm({ ...EMPTY }); }}
              className="rounded-pill border border-line px-4 text-xs">取消</button>
          )}
        </div>
        {msg && <p role="status" className="mt-2 text-[11px] text-sage-deep">{msg}</p>}
      </section>

      {list.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">食堂加载失败，需要管理员权限。</p>}

      <div className="overflow-x-auto rounded-card border border-line bg-white dark:bg-[#262B24]">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="border-b border-line text-[11px] text-muted">
            <tr><th className="px-4 py-3">食堂</th><th className="px-4 py-3">位置</th><th className="px-4 py-3">营业</th><th className="px-4 py-3">档口</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">操作</th></tr>
          </thead>
          <tbody>
            {list.data?.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-semibold">{c.name}</td>
                <td className="px-4 py-3 text-[11px] text-muted">{c.location}</td>
                <td className="px-4 py-3 text-[11px]">{c.openTime}–{c.closeTime}</td>
                <td className="px-4 py-3">{c.stallCount}</td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => toggleOpen.mutate({ id: c.id, isOpen: !c.isOpen })}
                    className={`rounded-full px-2 py-1 text-[11px] ${c.isOpen ? 'bg-sage-light text-sage-deep' : 'bg-beige text-muted'}`}>
                    {c.isOpen ? '营业中' : '已关闭'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button type="button" className="text-[11px] text-orange-deep"
                    onClick={() => {
                      setEditingId(c.id);
                      setForm({ name: c.name, location: c.location, description: c.description ?? '', openTime: c.openTime, closeTime: c.closeTime, notice: c.notice ?? '' });
                    }}>编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data?.length === 0 && <p className="text-xs text-muted">还没有食堂，先在上方创建。</p>}
    </div>
  );
}
