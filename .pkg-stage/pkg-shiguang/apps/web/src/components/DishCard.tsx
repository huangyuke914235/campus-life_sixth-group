'use client';

import { Heart, Plus, Info } from 'lucide-react';
import { resolveDishImage, fallbackDishImage } from '@/lib/dish-image';

export interface DishView {
  dishId: string;
  name: string;
  priceCents: number;
  imageUrl?: string;
  score?: number;
  reason?: string;
  matchedTags?: string[];
  stallName?: string;
}

interface Props {
  dish: DishView;
  favorited?: boolean;
  onAdd?: () => void;
  onFavorite?: () => void;
  onExplain?: () => void;
}

export function DishCard({ dish, favorited, onAdd, onFavorite, onExplain }: Props) {
  const cover = resolveDishImage(dish.name, dish.imageUrl);
  return (
    <article className="sg-card flex gap-3 p-3">
      <div className="h-[78px] w-[78px] shrink-0 overflow-hidden rounded-xl bg-beige dark:bg-[#2F362D]">
        <img
          src={cover}
          alt={dish.name}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => { e.currentTarget.src = fallbackDishImage(dish.name); }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-bold">{dish.name}</h3>
          {dish.score !== undefined && (
            <span className="shrink-0 text-xs font-semibold text-orange-deep">{Math.round(dish.score * 100)}% 匹配</span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          ¥{(dish.priceCents / 100).toFixed(2)}{dish.stallName ? ` · ${dish.stallName}` : ''}
        </p>
        {dish.reason && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-sage-deep">{dish.reason}</p>}
        <div className="mt-2 flex items-center gap-2">
          {onAdd && (
            <button type="button" onClick={onAdd} className="flex items-center gap-1 rounded-full bg-orange px-3 py-1 text-[11px] font-semibold text-white">
              <Plus size={12} aria-hidden /> 加入清单
            </button>
          )}
          {onFavorite && (
            <button type="button" onClick={onFavorite} aria-label="收藏菜品" className="rounded-full p-1.5 text-muted hover:text-orange-deep">
              <Heart size={16} fill={favorited ? '#FF8A4C' : 'none'} />
            </button>
          )}
          {onExplain && (
            <button type="button" onClick={onExplain} className="ml-auto flex items-center gap-1 text-[11px] text-orange-deep">
              <Info size={12} aria-hidden /> 推荐依据
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
