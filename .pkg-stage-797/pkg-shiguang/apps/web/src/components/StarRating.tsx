'use client';

import { useState } from 'react';

/** 10 星制：一星一个等级，直接对应「推荐程度」 */
const LABELS = [
  '很不推荐', '不推荐', '不太推荐', '比较一般', '一般',
  '还不错', '推荐', '很推荐', '强烈推荐', '必吃',
];
const STARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const STAR_PATH = 'M18 3l4.4 9.1 10 1.4-7.2 7 1.7 10-8.9-4.7-8.9 4.7 1.7-10-7.2-7 10-1.4L18 3z';

interface Props {
  value: number;
  onChange: (value: number) => void;
  size?: number;
  readOnly?: boolean;
}

/**
 * 十分制星级。
 * 可交互模式下渲染 10 颗星（悬停 / 点击 / 触摸都有反馈）；
 * 只读模式下压缩成「★ 8.4」，避免列表里塞 10 颗星。
 */
export function StarRating({ value, onChange, size = 26, readOnly = false }: Props) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  if (readOnly) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted" aria-label={`${value.toFixed(1)} 分`}>
        <svg width={12} height={12} viewBox="0 0 36 36" aria-hidden>
          <path d={STAR_PATH} fill="#FFB648" />
        </svg>
        {value.toFixed(1)}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="十分制推荐评分">
        {STARS.map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} 分 · ${LABELS[i - 1]}`}
            disabled={readOnly}
            onMouseEnter={() => !readOnly && setHover(i)}
            onMouseLeave={() => !readOnly && setHover(0)}
            onTouchStart={() => !readOnly && setHover(i)}
            onClick={() => { if (!readOnly) { onChange(i); setHover(0); } }}
            className="rounded-md p-0.5 transition-transform active:scale-90 disabled:cursor-default"
          >
            <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
              <path
                d={STAR_PATH}
                fill={i <= shown ? '#FFB648' : '#EDE6DA'}
                stroke={i <= shown ? '#F0A93A' : 'none'}
                strokeWidth="1"
              />
            </svg>
          </button>
        ))}
      </div>
      <p className="text-xs font-semibold text-orange-deep" aria-live="polite">
        {shown > 0 ? `${shown} 分 · ${LABELS[shown - 1]}` : '点亮星星，表示你的推荐程度（1–10）'}
      </p>
    </div>
  );
}
