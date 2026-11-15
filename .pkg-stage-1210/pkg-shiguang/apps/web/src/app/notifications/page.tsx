'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BottomNav } from '@/components/BottomNav';
import { get, post, patch, endpoints } from '@/lib/api';

interface Note { id: string; title: string; body: string; type: string; readAt: string | null; createdAt: string }

export default function NotificationsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ items: Note[]; unreadCount: number }>(endpoints.notifications) });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readOne = useMutation({
    mutationFn: (id: string) => patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold">消息通知</h1><p className="mt-1 text-xs text-muted">站内通知，无需第三方凭证即可体验</p></div>
        <button type="button" onClick={() => readAll.mutate()} className="text-xs font-semibold text-orange-deep">全部已读</button>
      </div>
      <Link href="/dashboard" className="mt-3 inline-block text-xs text-muted">← 返回首页</Link>

      {list.isPending && <div className="mt-5 flex flex-col gap-3">{[1, 2, 3].map((i) => <div key={i} className="sg-skeleton h-16" />)}</div>}
      {list.isError && <div role="alert" className="sg-card mt-5 p-4 text-xs text-red-700">通知加载失败。</div>}
      {list.data?.items.length === 0 && <div className="sg-card mt-5 p-6 text-center text-xs text-muted">暂时没有新消息。</div>}

      <div className="mt-5 flex flex-col gap-2">
        {list.data?.items.map((n) => (
          <button key={n.id} type="button" onClick={() => !n.readAt && readOne.mutate(n.id)}
            className={`sg-card p-4 text-left ${n.readAt ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">{n.title}</p>
              {!n.readAt && <span className="h-2 w-2 rounded-full bg-orange" />}
            </div>
            <p className="mt-1 text-xs text-muted">{n.body}</p>
            <p className="mt-2 text-[11px] text-muted">{new Date(n.createdAt).toLocaleString('zh-CN')}</p>
          </button>
        ))}
      </div>
      <BottomNav />
    </main>
  );
}
