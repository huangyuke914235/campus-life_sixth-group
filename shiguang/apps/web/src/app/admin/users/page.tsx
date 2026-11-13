'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '@/lib/api';

interface UserRow { id: string; email: string; displayName: string; role: string; isActive: boolean; createdAt: string; lastLoginAt: string | null }

const ROLE_LABEL: Record<string, string> = { STUDENT: '学生', MERCHANT: '商户', ADMIN: '管理员' };

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin-users'], queryFn: () => get<{ items: UserRow[]; meta: { total: number } }>('/admin/users?pageSize=50') });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/admin/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">用户与角色</h1>
        <p className="mt-1 text-[11px] text-muted">角色变更与停用均写入操作日志；权限校验始终由后端执行</p>
      </div>

      {list.isPending && <div className="sg-skeleton h-40" />}
      {list.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">加载失败，需要管理员权限。</p>}

      <div className="overflow-x-auto rounded-card border border-line bg-white dark:bg-[#262B24]">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b border-line text-[11px] text-muted">
            <tr><th className="px-4 py-3">用户</th><th className="px-4 py-3">邮箱</th><th className="px-4 py-3">角色</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">最近登录</th></tr>
          </thead>
          <tbody>
            {list.data?.items.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-semibold">{u.displayName}</td>
                <td className="px-4 py-3 text-[11px] text-muted">{u.email}</td>
                <td className="px-4 py-3">
                  <select value={u.role} aria-label={`${u.displayName} 的角色`}
                    onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value } })}
                    className="rounded-lg border border-line bg-transparent px-2 py-1 text-[11px]">
                    {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => update.mutate({ id: u.id, body: { isActive: !u.isActive } })}
                    className={`rounded-full px-2.5 py-1 text-[11px] ${u.isActive ? 'bg-sage-light text-sage-deep' : 'bg-red-50 text-red-700'}`}>
                    {u.isActive ? '正常' : '已停用'}
                  </button>
                </td>
                <td className="px-4 py-3 text-[11px] text-muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">共 {list.data?.meta.total ?? '—'} 名用户。停用账号会立即撤销其刷新令牌。</p>
    </div>
  );
}
