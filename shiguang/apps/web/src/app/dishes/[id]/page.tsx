'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Heart, Plus } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { StarRating } from '@/components/StarRating';
import { useCart } from '@/lib/cart';
import { get, post, del, endpoints } from '@/lib/api';
import { resolveDishImage } from '@/lib/dish-image';

interface DishDetail {
  id: string; name: string; description: string | null; priceCents: number; imageUrl: string | null;
  category: string; spiceScore: number; oilScore: number; saltScore: number; portionScore: number;
  allergens: string[]; isVegetarian: boolean; isHighProtein: boolean;
  avgRating: number; ratingCount: number; verifiedRatingCount: number;
  stall: { id: string; name: string; canteenId: string; canteen: { name: string } };
  tags: { name: string }[];
  ingredientRows: { name: string; isMain: boolean }[];
  nutrition: { energyKcal: number; proteinG: number; fatG: number; carbG: number; fiberG: number | null; sodiumMg: number | null; isEstimated: boolean; sourceNote: string | null } | null;
  feelingStats: { code: string; label: string; count: number }[];
  reviews: { id: string; rating: number; comment: string | null; user: { displayName: string } }[];
  nutritionNotice: string;
  matchNotice: string;
}

export default function DishDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const cart = useCart();
  const [toast, setToast] = useState('');
  const dish = useQuery({ queryKey: ['dish', id], queryFn: () => get<DishDetail>(endpoints.dish(id)) });
  const fav = useMutation({
    mutationFn: (on: boolean) => on ? post(endpoints.favorites + `/${id}`) : del(endpoints.favorites + `/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  });

  const addToCart = () => {
    if (!dish.data) return;
    const r = cart.add({
      dishId: dish.data.id, name: dish.data.name, priceCents: dish.data.priceCents,
      stallId: dish.data.stall.id, stallName: dish.data.stall.name,
      canteenId: dish.data.stall.canteenId, imageUrl: dish.data.imageUrl ?? undefined,
    });
    setToast(r.message);
    if (r.ok) setTimeout(() => router.push('/cart'), 600);
  };

  return (
    <main className="mx-auto min-h-screen max-w-md pb-32">
      <div className="h-56 bg-gradient-to-br from-orange-light to-beige">
        <img src={resolveDishImage(dish.data?.name ?? '', dish.data?.imageUrl)} alt={dish.data?.name ?? ''} className="h-full w-full object-cover" />
      </div>
      <div className="px-5 pt-4">
        <Link href="/recommend" className="text-xs text-muted">← 返回</Link>

        {dish.isPending && <div className="sg-skeleton mt-4 h-56" />}
        {dish.isError && <div role="alert" className="sg-card mt-4 p-4 text-xs text-red-700">菜品加载失败。</div>}

        {dish.data && (
          <>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">{dish.data.name}</h1>
                <p className="mt-1 text-[11px] text-muted">{dish.data.stall.canteen.name} · {dish.data.stall.name} · {dish.data.category}</p>
              </div>
              <p className="text-lg font-bold text-orange-deep">¥{(dish.data.priceCents / 100).toFixed(0)}</p>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <StarRating value={Math.round(dish.data.avgRating)} onChange={() => {}} readOnly size={18} />
              <span className="text-[11px] text-muted">{dish.data.avgRating.toFixed(1)} · {dish.data.ratingCount} 条评价（已核验 {dish.data.verifiedRatingCount}）</span>
            </div>

            {dish.data.description && <p className="mt-3 text-xs leading-5 text-muted">{dish.data.description}</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              {dish.data.tags.map((t) => <span key={t.name} className="sg-chip">{t.name}</span>)}
              {dish.data.isVegetarian && <span className="sg-chip bg-sage-light text-sage-deep">素食</span>}
              {dish.data.isHighProtein && <span className="sg-chip bg-sage-light text-sage-deep">高蛋白</span>}
            </div>

            {dish.data.allergens.length > 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-[11px] leading-5 text-red-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>可能含过敏原：{dish.data.allergens.join('、')}。食堂信息可能不完整，存在交叉接触风险。</span>
              </div>
            )}

            <section className="sg-card mt-4 p-4">
              <h2 className="text-sm font-bold">口味指标</h2>
              <p className="mt-1 text-[11px] text-muted">三项独立标注，不互相推断</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { k: '辣度', v: dish.data.spiceScore },
                  { k: '咸度', v: dish.data.saltScore },
                  { k: '油脂', v: dish.data.oilScore },
                ].map(({ k, v }) => (
                  <div key={k} className="rounded-xl bg-beige p-2.5 dark:bg-[#2F362D]">
                    <p className="text-[11px] text-muted">{k}</p>
                    <div className="mt-1.5 flex gap-0.5" aria-hidden>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= v ? 'bg-orange' : 'bg-line'}`} />
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-muted">{['无', '很低', '偏低', '适中', '偏高', '很重'][v] ?? '适中'}</p>
                  </div>
                ))}
              </div>
            </section>

            {dish.data.nutrition && (
              <section className="sg-card mt-4 p-4">
                <h2 className="text-sm font-bold">营养信息（估算）</h2>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">
                  {[
                    ['能量', `${Math.round(dish.data.nutrition.energyKcal)} kcal`],
                    ['蛋白质', `${dish.data.nutrition.proteinG.toFixed(1)} g`],
                    ['脂肪', `${dish.data.nutrition.fatG.toFixed(1)} g`],
                    ['碳水', `${dish.data.nutrition.carbG.toFixed(1)} g`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-beige p-2 dark:bg-[#2F362D]"><p className="text-muted">{k}</p><p className="mt-1 font-semibold">{v}</p></div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-5 text-muted">{dish.data.nutrition.sourceNote ?? dish.data.nutritionNotice}</p>
              </section>
            )}

            {dish.data.feelingStats.length > 0 && (
              <section className="sg-card mt-4 p-4">
                <h2 className="text-sm font-bold">大家吃完的感受</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {dish.data.feelingStats.map((f) => (
                    <span key={f.code} className="sg-chip">{f.label} · {f.count}</span>
                  ))}
                </div>
              </section>
            )}

            <section className="sg-card mt-4 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">学生评价</h2>
                <div className="flex items-center gap-3">
                  <Link href={`/dishes/${id}/reviews`} className="text-[11px] text-orange-deep">
                    查看全部 {dish.data.ratingCount} 条 →
                  </Link>
                  <Link href={`/dishes/${id}/review`} className="rounded-full bg-sage px-2.5 py-1 text-[11px] font-semibold text-white">
                    写评价
                  </Link>
                </div>
              </div>
              {dish.data.reviews.length > 0 ? (
                <div className="mt-3 flex flex-col gap-3">
                  {dish.data.reviews.map((r) => (
                    <div key={r.id} className="border-b border-line pb-2 last:border-0">
                      <p className="text-[11px] text-muted">{r.user.displayName} · {r.rating} 星</p>
                      {r.comment && <p className="mt-1 text-xs leading-5">{r.comment}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted">还没有评价，吃过的话可以写一条。</p>
              )}
            </section>

            <p className="mt-3 text-[11px] text-muted">{dish.data.matchNotice}</p>
          </>
        )}
      </div>

      {toast && <div role="status" className="fixed bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs text-white">{toast}</div>}

      {dish.data && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-5 py-3 backdrop-blur dark:bg-[#262B24]">
          <div className="mx-auto flex max-w-md items-center gap-3">
            <button type="button" onClick={() => fav.mutate(true)} aria-label="收藏" className="rounded-full border border-line p-2.5 text-muted">
              <Heart size={18} />
            </button>
            <button type="button" onClick={addToCart} className="sg-btn-primary flex flex-1 items-center justify-center gap-1">
              <Plus size={14} aria-hidden /> 加入点餐清单 · ¥{(dish.data.priceCents / 100).toFixed(0)}
            </button>
          </div>
        </div>
      )}
      {!dish.data && <BottomNav />}
    </main>
  );
}
