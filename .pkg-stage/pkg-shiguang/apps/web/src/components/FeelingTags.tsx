'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FEELING_OPTIONS, type FeelingGroup } from '@shiguang/shared';

const GROUPS: { key: FeelingGroup; title: string; multi: boolean; collapsed?: boolean }[] = [
  { key: 'OVERALL', title: '整体感受 · 单选', multi: false },
  { key: 'TASTE', title: '口味感受 · 可多选', multi: true },
  { key: 'PORTION', title: '份量感受 · 可多选', multi: true },
  { key: 'BODY', title: '饭后身体感受 · 可选', multi: true, collapsed: true },
];

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

/** 结构化体感标签：分组、单选/多选、可跳过、更多感受折叠，移动端优先单屏完成。 */
export function FeelingTags({ value, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  const toggle = (code: string, group: FeelingGroup, multi: boolean) => {
    const groupCodes = FEELING_OPTIONS.filter((o) => o.group === group).map((o) => o.code);
    const rest = value.filter((c) => !groupCodes.includes(c));
    if (multi) {
      onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
    } else {
      onChange(value.includes(code) ? rest : [...rest, code]);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((g) => {
        if (g.collapsed && !expanded) return null;
        const options = FEELING_OPTIONS.filter((o) => o.group === g.key);
        return (
          <section key={g.key}>
            <h3 className="mb-2 text-xs font-semibold text-ink dark:text-cream">{g.title}</h3>
            <div className="flex flex-wrap gap-2">
              {options.map((o) => {
                const active = value.includes(o.code);
                return (
                  <button
                    key={o.code}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(o.code, g.key, g.multi)}
                    className={`sg-chip min-h-[36px] ${active ? 'sg-chip-active' : ''}`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {!expanded && (
        <button type="button" onClick={() => setExpanded(true)} className="flex items-center gap-1 self-start text-xs font-medium text-orange-deep">
          更多感受 <ChevronDown size={14} aria-hidden />
        </button>
      )}
      <p className="text-[11px] text-muted">所有体感都可跳过；主观感受不构成医学判断。</p>
    </div>
  );
}
