'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { useCart } from '@/lib/cart';
import { get, post, del } from '@/lib/api';
import { resolveDishImage } from '@/lib/dish-image';

interface FavoriteRow {
  dishId: string; createdAt: string;
  dish: { id: string; name: string; priceCents: number; imageUrl: string | null; status: string; stallId: string; stall: { name: string; canteenId: string; canteen: { name: string } } };
}

export default function FavoritesPage() {
  const qc = useQueryClient();
  const cart = useCart();
  const [toast, setToast] = useState('');
  const list = useQuery({ queryKey: ['favorites'], queryFn: () => get<FavoriteRow[]>('/favorites') });
  const remove = useMutation({
    mutationFn: (dishId: string) => del(`/favorites/${dishId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  });

  const add = (f: FavoriteRow) => {
    const r = cart.add({
      dishId: f.dish.id, name: f.dish.name, priceCents: f.dish.priceCents,
      stallId: f.dish.stallId, stallName: f.dish.stall.name, canteenId: f.dish.stall.canteenId,
      imageUrl: f.dish.imageUrl ?? undefined,
    });
    setToast(r.message);
  };

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <header>
        <h1 className="text-xl font-bold">我的收藏</h1>
        <p className="mt-1 text-xs text-muted">收藏会参与推荐画像，也会在首页优先展示</p>
      </header>

      {list.isPending && <div className="mt-5 flex flex-col gap-3">{[1, 2].map((i) => <div key={i} className="sg-skeleton h-24" />)}</div>}
      {list.isError && <p role="alert" className="sg-card mt-5 p-4 text-xs text-red-700">收藏加载失败。</p>}
      {list.data?.length === 0 && (
        <div className="sg-card mt-5 p-8 text-center">
          <Heart size={28} className="mx-auto text-muted" aria-hidden />
          <p className="mt-3 text-sm font-semibold">还没有收藏</p>
          <p className="mt-1 text-xs text-muted">在菜品详情页点一下心形即可收藏。</p>
          <Link href="/discover" className="sg-btn-primary mt-5 inline-block text-xs">去逛逛</Link>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3">
        {list.data?.map((f) => (
          <article key={f.dishId} className="sg-card flex items-center gap-3 p-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-beige dark:bg-[#2F362D]">
              <img src={resolveDishImage(f.dish.name, f.dish.imageUrl)} alt={f.dish.name} className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/dishes/${f.dish.id}`} className="block truncate text-sm font-bold">{f.dish.name}</Link>
              <p className="mt-0.5 text-[11px] text-muted">{f.dish.stall.canteen.name} · {f.dish.stall.name} · ¥{(f.dish.priceCents / 100).toFixed(0)}</p>
              <p className="mt-0.5 text-[11px] text-muted">{f.dish.status === 'ACTIVE' ? '当前在架' : '已下架'}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <button type="button" onClick={() => remove.mutate(f.dishId)} aria-label="取消收藏" className="text-muted">
                <Heart size={16} fill="#FF8A4C" className="text-orange" />
              </button>
              <button type="button" onClick={() => add(f)} className="rounded-full bg-orange px-3 py-1 text-[11px] font-semibold text-white">加入</button>
            </div>
          </article>
        ))}
      </div>

      {toast && <div role="status" className="fixed bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs text-white">{toast}</div>}
      <BottomNav />
    </main>
  );
}
