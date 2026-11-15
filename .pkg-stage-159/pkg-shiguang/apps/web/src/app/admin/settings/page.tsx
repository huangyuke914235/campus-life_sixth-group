'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, put } from '@/lib/api';

interface Weights { taste: number; diet: number; feedback: number; dishQuality: number; budget: number; mealSupply: number; diversity: number }
interface ConfigResp { effective: Weights; defaults: Weights; source: string }

const card = 'rounded-card border border-line bg-white p-4 dark:bg-[#262B24]';
const LABELS: Record<keyof Weights, string> = {
  taste: '口味匹配', diet: '饮食偏好', feedback: '历史反馈', dishQuality: '菜品评分',
  budget: '预算价格', mealSupply: '餐次供应', diversity: '新菜与多样性',
};

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['reco-config'], queryFn: () => get<ConfigResp>('/recommendations/config') });
  const [draft, setDraft] = useState<Weights | null>(null);
  const [msg, setMsg] = useState('');
  const [ann, setAnn] = useState({ title: '', body: '', scope: 'ALL' });

  useEffect(() => {
    if (config.data && !draft) setDraft(config.data.effective);
  }, [config.data, draft]);

  const save = useMutation({
    mutationFn: () => put<Weights>('/recommendations/config', draft!),
    onSuccess: (w) => { setDraft(w); setMsg('权重已保存，仅影响后续推荐'); qc.invalidateQueries({ queryKey: ['reco-config'] }); },
    onError: (e: Error) => setMsg(`保存失败：${e.message}`),
  });
  const publish = useMutation({
    mutationFn: () => post('/admin/announcements', ann),
    onSuccess: () => { setMsg('公告已发布'); setAnn({ title: '', body: '', scope: 'ALL' }); },
    onError: (e: Error) => setMsg(`发布失败：${e.message}`),
  });

  const sum = draft ? Object.values(draft).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">系统设置</h1>
        <p className="mt-1 text-[11px] text-muted">推荐权重与平台公告；所有变更写入操作日志</p>
      </div>

      <section className={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">推荐权重</h2>
          <span className="text-[11px] text-muted">来源：{config.data?.source === 'runtime' ? '运行时覆盖' : '环境变量'} · 合计 {sum.toFixed(2)}</span>
        </div>
        {!draft && <div className="sg-skeleton mt-3 h-32" />}
        {draft && (
          <div className="mt-3 flex flex-col gap-3">
            {(Object.keys(LABELS) as (keyof Weights)[]).map((k) => (
              <div key={k}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold">{LABELS[k]}</span>
                  <span className="text-muted">{draft[k].toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={0.6} step={0.01} value={draft[k]} aria-label={LABELS[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })}
                  className="mt-1 w-full accent-orange" />
              </div>
            ))}
            <p className="text-[11px] text-muted">保存时服务端会强制归一化（总和=1），单项不得为负。</p>
            <div className="flex gap-2">
              <button type="button" disabled={save.isPending} onClick={() => { setMsg(''); save.mutate(); }}
                className="sg-btn-primary disabled:opacity-50">保存权重</button>
              <button type="button" onClick={() => config.data && setDraft(config.data.defaults)}
                className="rounded-pill border border-line px-4 text-xs">恢复默认</button>
            </div>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="text-sm font-bold">发布平台公告</h2>
        <div className="mt-3 grid gap-2">
          <input value={ann.title} onChange={(e) => setAnn({ ...ann, title: e.target.value })} placeholder="公告标题" aria-label="公告标题" className="sg-input" />
          <textarea value={ann.body} onChange={(e) => setAnn({ ...ann, body: e.target.value })} rows={3} placeholder="公告内容" aria-label="公告内容" className="sg-input resize-none" />
          <select value={ann.scope} onChange={(e) => setAnn({ ...ann, scope: e.target.value })} aria-label="公告范围" className="sg-input">
            <option value="ALL">全部用户</option>
            <option value="STUDENTS">仅学生</option>
            <option value="MERCHANTS">仅商户</option>
          </select>
        </div>
        <button type="button" disabled={!ann.title || !ann.body || publish.isPending} onClick={() => { setMsg(''); publish.mutate(); }}
          className="sg-btn-primary mt-3 disabled:opacity-50">发布公告</button>
      </section>

      <section className={card}>
        <h2 className="text-sm font-bold">运行环境</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-[11px] text-muted">
          <li>支付：到店付款</li>
          <li>营养数据：估算值，仅供饮食参考</li>
          <li>通知：站内信（邮件 / 短信 / Web Push 为预留接口）</li>
          <li>推荐引擎：local-hybrid-v1（本地算法，无需外部 API Key）</li>
        </ul>
      </section>

      {msg && <p role="status" className="rounded-xl bg-sage-light px-3 py-2 text-xs text-sage-deep">{msg}</p>}
    </div>
  );
}
