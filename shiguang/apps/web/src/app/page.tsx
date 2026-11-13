import Link from 'next/link';
import { ArrowRight, Sparkles, Star, TrendingUp } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen bg-cream dark:bg-[#1C201B]">
      <section className="bg-gradient-to-r from-[#FF9A5C] to-orange-deep px-6 pb-16 pt-10 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-xl font-bold">食</div>
            <div>
              <p className="text-2xl font-bold">食光有数</p>
              <p className="text-xs opacity-90">荔园智慧膳食服务平台</p>
            </div>
          </div>
          <h1 className="mt-14 max-w-xl text-4xl font-bold leading-tight sm:text-5xl">每一餐，都更懂你的口味。</h1>
          <p className="mt-4 max-w-lg text-sm opacity-95">
            菜单公示 · 提前点餐 · 预约取餐 · 评分反馈 · 营养分析 · 个性化菜品推荐。
            不依赖付费 AI API，用真实数据跑通「偏好—推荐—消费—反馈—画像更新」闭环。
          </p>
          <div className="mt-7 flex flex-wrap items-baseline gap-x-7 gap-y-2 text-xs opacity-95">
            <span><strong className="text-lg font-bold">13</strong> 个食堂</span>
            <span><strong className="text-lg font-bold">59</strong> 道菜</span>
            <span><strong className="text-lg font-bold">10</strong> 星评价</span>
            <span><strong className="text-lg font-bold">7</strong> 维推荐</span>
            <span className="opacity-80">数据来自深大粤海 / 丽湖两校区真实菜单</span>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-pill bg-white px-6 py-3 text-sm font-bold text-orange-deep">
              进入平台 <ArrowRight size={16} aria-hidden />
            </Link>
            <Link href="/login" className="rounded-pill border border-white/60 px-6 py-3 text-sm font-semibold">登录 / 注册</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="text-xl font-bold">三件它真的能帮你做的事</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { icon: Sparkles, title: '今天吃什么', desc: '按个人口味画像给出 3 道菜，附匹配理由、价格与食堂，而不是热门榜。' },
            { icon: Star, title: '饭后 10 秒反馈', desc: '10 星打分（一星一档推荐度）+ 体感标签 + 可选短评，每次反馈都真实改变下一次推荐。' },
            { icon: TrendingUp, title: '越来越懂你', desc: '标签与图表呈现偏好变化，明确区分「我设置的」与「系统推断」。' },
          ].map(({ icon: Icon, title, desc }) => (
            <article key={title} className="sg-card p-5">
              <Icon size={22} className="text-orange" aria-hidden />
              <h3 className="mt-3 font-bold">{title}</h3>
              <p className="mt-2 text-xs leading-5 text-muted">{desc}</p>
            </article>
          ))}
        </div>
        <p className="mt-8 text-[11px] leading-5 text-muted">
          营养数值为估算值，仅供饮食参考，不作为营养学依据。
        </p>
      </section>
    </main>
  );
}
