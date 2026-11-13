/**
 * 把最近一天的已发布菜单复制到「今天」（北京时间）。
 *
 * 为什么需要：seed 只在执行当天生成菜单，隔天推荐就没有候选了——
 * `loadCandidates` 按当天日期查 Menu，查不到直接返回空，
 * 表现为「推荐 0 道」。这个脚本把菜单、菜单项、库存、取餐时段
 * 一并复制，库存按 total 重置（新的一天重新开卖）。
 *
 * 幂等：目标日已存在同档口同餐次的菜单则跳过。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const toUtcDate = (s: string) => new Date(`${s}T00:00:00Z`);
const dayOf = (d: Date) => new Date(d).toISOString().slice(0, 10);

async function main() {
  // 北京时间的今天（UTC+8）
  const target = dayOf(new Date(Date.now() + 8 * 60 * 60 * 1000));
  const targetDate = toUtcDate(target);

  const latest = await prisma.menu.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
  if (!latest) {
    console.error('[refresh] 数据库里没有任何菜单，请先跑 seed');
    process.exitCode = 1;
    return;
  }
  const srcDay = dayOf(latest.date);
  console.log(`[refresh] 源菜单：${srcDay} → 目标：${target}`);

  if (srcDay === target) {
    console.log('[refresh] 今天已有菜单，无需处理');
    return;
  }

  const srcMenus = await prisma.menu.findMany({
    where: { date: toUtcDate(srcDay), status: 'PUBLISHED' },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  let menus = 0;
  let items = 0;
  let slots = 0;

  for (const m of srcMenus) {
    const exists = await prisma.menu.findFirst({
      where: { stallId: m.stallId, date: targetDate, mealType: m.mealType },
    });
    if (exists) continue;

    const menu = await prisma.menu.create({
      data: {
        stallId: m.stallId,
        date: targetDate,
        mealType: m.mealType,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    menus += 1;

    for (const item of m.items) {
      await prisma.menuItem.create({
        data: { menuId: menu.id, dishId: item.dishId, isAvailable: item.isAvailable, sortOrder: item.sortOrder },
      });
      items += 1;

      const inv = await prisma.inventory.findFirst({
        where: { dishId: item.dishId, date: toUtcDate(srcDay), mealType: m.mealType },
      });
      if (inv) {
        await prisma.inventory.upsert({
          where: { dishId_date_mealType: { dishId: item.dishId, date: targetDate, mealType: m.mealType } },
          create: { dishId: item.dishId, date: targetDate, mealType: m.mealType, total: inv.total, remaining: inv.total },
          update: { total: inv.total, remaining: inv.total },
        });
      }
    }

    const srcSlots = await prisma.pickupSlot.findMany({
      where: { stallId: m.stallId, date: toUtcDate(srcDay), mealType: m.mealType },
    });
    for (const s of srcSlots) {
      await prisma.pickupSlot.create({
        data: {
          stallId: s.stallId, date: targetDate, mealType: s.mealType,
          startTime: s.startTime, endTime: s.endTime,
          capacity: s.capacity, booked: 0, cutoffMinutes: s.cutoffMinutes,
        },
      }).then(() => { slots += 1; }).catch(() => { /* 唯一键冲突即已存在，忽略 */ });
    }
  }

  console.log(`[refresh] 完成：新增菜单 ${menus} 个 / 菜单项 ${items} 条 / 取餐时段 ${slots} 个`);
}

main()
  .catch((e) => { console.error('[refresh] 失败：', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
