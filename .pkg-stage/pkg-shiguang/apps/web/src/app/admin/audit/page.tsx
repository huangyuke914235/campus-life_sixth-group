'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

interface LogRow {
  id: string; action: string; targetType: string; targetId: string | null;
  actorRole: string | null; metadata: Record<string, unknown> | null; createdAt: string;
}

export default function AdminAuditPage() {
  const logs = useQuery({ queryKey: ['audit-logs'], queryFn: () => get<{ items: LogRow[]; meta: { total: number } }>('/admin/audit-logs?pageSize=50') });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">操作日志</h1>
        <p className="mt-1 text-[11px] text-muted">记录角色变更、内容审核、推荐权重调整等敏感操作；IP 已脱敏</p>
      </div>

      {logs.isPending && <div className="sg-skeleton h-40" />}
      {logs.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">加载失败，需要管理员权限。</p>}
      {logs.data?.items.length === 0 && <p className="text-xs text-muted">暂无操作日志。</p>}

      <div className="flex flex-col gap-2">
        {logs.data?.items.map((l) => (
          <article key={l.id} className="rounded-card border border-line bg-white p-3 dark:bg-[#262B24]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold">{l.action}</p>
              <span className="text-[11px] text-muted">{new Date(l.createdAt).toLocaleString('zh-CN')}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {l.targetType}{l.targetId ? ` · ${l.targetId.slice(-8)}` : ''} · 操作者角色 {l.actorRole ?? '系统'}
            </p>
            {l.metadata && <pre className="mt-1 max-h-20 overflow-auto rounded-lg bg-beige p-2 text-[10px] text-muted dark:bg-[#2F362D]">{JSON.stringify(l.metadata)}</pre>}
          </article>
        ))}
      </div>
    </div>
  );
}
