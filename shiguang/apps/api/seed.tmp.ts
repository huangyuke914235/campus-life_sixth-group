/**
 * 演示数据初始化：3 个食堂 / 12 个档口 / 54 道菜 / 营养 / 每日菜单 /
 * 库存 / 取餐时段 / 历史评价 / 订单 / 两名偏好截然不同的学生。
 *
 * 运行：pnpm db:seed
 * 演示密码来自 DEMO_PASSWORD 环境变量；未设置时生成一次性随机值并打印，
 * 绝不把固定密码写进生产默认配置。
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const prisma = new PrismaClient();
const env = (key: string, fallback: string) => process.env[key] ?? fallback;

function loadEnvFile(): void {
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    });
    break;
  }
}

const CANTEENS = [
  { name: '荔园一食堂', location: '校园东区 · 靠近图书馆', description: '家常粤式与轻食窗口，午餐人流最多', openTime: '07:00', closeTime: '20:30' },
  { name: '荔园二食堂', location: '校园西区 · 教学楼 B 栋旁', description: '川湘风味与面食为主', openTime: '06:45', closeTime: '21:00' },
  { name: '荔园三食堂', location: '南门生活区 · 宿舍楼下', description: '夜宵与小吃窗口，营业到最晚', openTime: '07:30', closeTime: '22:00' },
];

const STALLS = [
  ['二楼粤式档口', '蒸饭、煲仔与家常小炒'], ['轻食窗口', '低脂高蛋白套餐'],
  ['汤粉面档', '汤面、米粉与馄饨'], ['早餐点心铺', '包点、粥品与豆浆'],
  ['川湘小炒档口', '麻辣香锅与盖饭'], ['面食工坊', '手工面与拌面'],
  ['瓦罐汤档', '炖汤与蒸菜'], ['素食专区', '全素与纯素菜品'],
  ['烧烤夜宵档', '烤串与铁板'], ['锅贴煎饼档', '煎饼、锅贴与小吃'],
  ['自选快餐档', '两荤两素自由搭配'], ['甜品饮品站', '糖水与豆花'],
];

/** [菜名, 分类, 价格(分), 标签, 辣度, 油腻度, 素食, 高蛋白] */
type DishSeed = [string, string, number, string[], number, number, boolean, boolean];
const DISHES: DishSeed[] = [
  ['香菇滑鸡饭', '米饭', 1800, ['微辣', '鸡肉', '米饭', '家常菜'], 2, 5, false, true],
  ['藤椒鸡丁盖饭', '米饭', 2000, ['微辣', '鸡肉', '米饭', '川湘'], 3, 3, false, true],
  ['蒜蓉时蔬鸡胸', '轻食', 1600, ['清淡', '蔬菜', '低脂', '高蛋白'], 0, 1, false, true],
  ['番茄牛腩面', '面食', 2200, ['汤类', '牛肉', '面食', '酸甜'], 0, 2, false, true],
  ['皮蛋瘦肉粥', '早餐', 800, ['清淡', '粥品', '猪肉'], 0, 1, false, false],
  ['豉汁排骨煲仔饭', '米饭', 2400, ['粤菜', '猪肉', '米饭'], 0, 3, false, true],
  ['麻辣香锅', '热炒', 2800, ['重辣', '川湘', '可定制'], 5, 5, false, false],
  ['清炒西兰花', '轻食', 1000, ['清淡', '蔬菜', '低脂', '纯素'], 0, 1, true, false],
  ['酸辣粉', '粉类', 1400, ['微辣', '粉类', '酸辣'], 3, 3, true, false],
  ['鸡丝汤面', '面食', 1500, ['清淡', '鸡肉', '汤类', '面食'], 0, 2, false, true],
  ['宫保鸡丁饭', '米饭', 1900, ['微辣', '鸡肉', '花生'], 3, 4, false, true],
  ['麻婆豆腐', '热炒', 1200, ['重辣', '川湘', '豆制品'], 4, 4, true, false],
  ['蒜香排骨', '热炒', 2600, ['蒜香', '猪肉', '浓郁'], 0, 4, false, true],
  ['白灼菜心', '轻食', 900, ['清淡', '蔬菜', '粤菜', '纯素'], 0, 1, true, false],
  ['香菇青菜包', '早餐', 400, ['清淡', '包点', '纯素'], 0, 1, true, false],
  ['豆浆油条套餐', '早餐', 700, ['早餐', '豆制品', '现炸'], 0, 4, true, false],
  ['虾仁滑蛋饭', '米饭', 2300, ['海鲜', '鸡蛋', '米饭'], 0, 3, false, true],
  ['黑椒牛柳饭', '米饭', 2500, ['微辣', '牛肉', '米饭'], 2, 3, false, true],
  ['酸菜鱼片饭', '米饭', 2600, ['微辣', '鱼肉', '酸辣'], 3, 3, false, true],
  ['三杯鸡饭', '米饭', 2100, ['浓郁', '鸡肉', '台式'], 1, 4, false, true],
  ['清蒸鲈鱼套餐', '轻食', 2900, ['清淡', '鱼肉', '高蛋白'], 0, 1, false, true],
  ['杂粮鸡胸沙拉', '轻食', 1800, ['清淡', '蔬菜', '低脂', '高蛋白'], 0, 1, false, true],
  ['燕麦南瓜粥', '早餐', 600, ['清淡', '粥品', '粗粮', '纯素'], 0, 1, true, false],
  ['牛肉拉面', '面食', 2000, ['汤类', '牛肉', '面食'], 1, 2, false, true],
  ['担担面', '面食', 1600, ['微辣', '面食', '川湘', '芝麻'], 3, 4, false, false],
  ['鸡汤馄饨', '面食', 1500, ['清淡', '鸡肉', '汤类'], 0, 2, false, true],
  ['螺蛳粉', '粉类', 1900, ['重辣', '粉类', '浓郁'], 4, 4, false, false],
  ['桂林米粉', '粉类', 1500, ['清淡', '粉类', '汤类'], 1, 2, false, false],
  ['铁板牛肉', '热炒', 2700, ['浓郁', '牛肉', '铁板'], 1, 4, false, true],
  ['干锅花菜', '热炒', 1300, ['微辣', '蔬菜', '川湘'], 2, 4, true, false],
  ['红烧狮子头', '热炒', 2200, ['浓郁', '猪肉', '家常菜'], 0, 5, false, true],
  ['糖醋里脊', '热炒', 2100, ['酸甜', '猪肉', '现炸'], 0, 5, false, true],
  ['照烧鸡腿饭', '米饭', 2000, ['偏甜', '鸡肉', '米饭'], 0, 3, false, true],
  ['韩式拌饭', '米饭', 2200, ['微辣', '蔬菜', '米饭'], 2, 3, false, false],
  ['咖喱鸡饭', '米饭', 2100, ['微辣', '鸡肉', '米饭', '浓郁'], 2, 4, false, true],
  ['番茄鸡蛋盖饭', '米饭', 1400, ['清淡', '鸡蛋', '米饭', '酸甜'], 0, 2, true, true],
  ['土豆炖牛腩', '热炒', 2600, ['浓郁', '牛肉', '家常菜'], 0, 3, false, true],
  ['上汤娃娃菜', '轻食', 1100, ['清淡', '蔬菜', '汤类'], 0, 1, true, false],
  ['玉米排骨汤', '汤品', 1200, ['清淡', '猪肉', '汤类'], 0, 1, false, false],
  ['紫菜蛋花汤', '汤品', 500, ['清淡', '鸡蛋', '汤类'], 0, 1, true, false],
  ['酸梅汤', '饮品', 400, ['酸甜', '饮品', '解腻'], 0, 0, true, false],
  ['红豆双皮奶', '甜品', 900, ['偏甜', '乳制品', '甜品'], 0, 2, true, false],
  ['杨枝甘露', '甜品', 1400, ['偏甜', '乳制品', '芒果', '甜品'], 0, 2, true, false],
  ['烤鸡翅串', '夜宵', 800, ['微辣', '鸡肉', '烧烤'], 2, 4, false, true],
  ['铁板韭菜', '夜宵', 900, ['清淡', '蔬菜', '烧烤'], 0, 3, true, false],
  ['韭菜猪肉锅贴', '小吃', 1000, ['猪肉', '现煎', '小吃'], 0, 4, false, false],
  ['杂粮煎饼', '小吃', 900, ['微辣', '鸡蛋', '粗粮', '现煎'], 1, 3, true, true],
  ['双拼自选快餐', '快餐', 1600, ['家常菜', '自选', '米饭'], 1, 3, false, false],
  ['三素一荤套餐', '快餐', 1800, ['蔬菜', '米饭', '均衡'], 0, 2, false, true],
  ['低脂荞麦冷面', '轻食', 1700, ['清淡', '面食', '低脂', '粗粮'], 0, 1, true, false],
  ['番茄炒蛋盖饭', '米饭', 1400, ['清淡', '鸡蛋', '米饭', '酸甜'], 0, 2, true, true],
  ['卤肉饭', '米饭', 1900, ['浓郁', '猪肉', '米饭'], 0, 4, false, true],
  ['清汤牛腩粉', '粉类', 2100, ['清淡', '牛肉', '粉类', '汤类'], 0, 2, false, true],
  ['香菇鸡肉粥', '早餐', 900, ['清淡', '鸡肉', '粥品'], 0, 1, false, true],
  ['凉拌黄瓜', '轻食', 700, ['清淡', '蔬菜', '纯素', '解腻'], 0, 1, true, false],
  ['香煎鸡胸沙拉', '轻食', 2000, ['清淡', '鸡肉', '蔬菜', '高蛋白'], 0, 2, false, true],
];

const ALLERGEN_RULES: [RegExp, string][] = [
  [/花生|宫保/, '花生'], [/虾/, '甲壳类'], [/奶|双皮|甘露/, '乳糖'],
  [/鸡蛋|蛋|滑蛋|煎饼/, '鸡蛋'], [/芝麻|担担/, '芝麻'], [/豆|腐|豆浆/, '大豆'],
  [/面|拉面|馄饨|包|锅贴/, '麸质'],
];

function allergensFor(d: DishSeed): string[] {
  const text = d[0] + d[3].join('');
  return [...new Set(ALLERGEN_RULES.filter(([re]) => re.test(text)).map(([, a]) => a))];
}

const today = (): Date => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

async function main(): Promise<void> {
  loadEnvFile();
  const demoPassword = process.env.DEMO_PASSWORD || randomBytes(9).toString('base64url');
  if (!process.env.DEMO_PASSWORD) {
    console.log('[seed] 未设置 DEMO_PASSWORD，本次生成的一次性演示密码：' + demoPassword);
    console.log('[seed] 请记录该密码；重新 seed 会变化。生产环境请显式设置并关闭演示账号。');
  }
  const passwordHash = await argon2.hash(demoPassword, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  console.log('[seed] 清理旧演示数据…');
  await prisma.reviewFeeling.deleteMany();
  await prisma.review.deleteMany();
  await prisma.recommendationItem.deleteMany();
  await prisma.recommendationLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.userBehavior.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.pickupToken.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menu.deleteMany();
  await prisma.pickupSlot.deleteMany();
  await prisma.dishIngredient.deleteMany();
  await prisma.dishNutrition.deleteMany();
  await prisma.dish.updateMany({ data: { avgRating: 0, ratingCount: 0, verifiedRatingCount: 0 } });
  await prisma.refreshToken.deleteMany();
  await prisma.userTasteProfile.deleteMany();
  await prisma.userPreference.deleteMany();
  await prisma.dietaryRestriction.deleteMany();
  await prisma.systemAnnouncement.deleteMany();
  await prisma.user.deleteMany();

  // ── 食堂与档口 ──
  const canteens = [];
  const stalls = [];
  for (const c of CANTEENS) {
    const row = await prisma.canteen.create({ data: { ...c, coverUrl: null, notice: '今日菜品以窗口实际供应为准，营养信息为估算值。' } });
    canteens.push(row);
    for (let i = 0; i < 4; i += 1) {
      const idx = canteens.length * 4 - 4 + i;
      const [name, desc] = STALLS[idx];
      stalls.push(await prisma.stall.create({
        data: { canteenId: row.id, name, description: desc, floor: i < 2 ? '2F' : '1F', windowNo: String(i + 1), isActive: true },
      }));
    }
  }
  console.log(`[seed] 食堂 ${canteens.length} 个 / 档口 ${stalls.length} 个`);

  // ── 标签 ──
  const tagNames = [...new Set(DISHES.flatMap((d) => d[3]))];
  for (const name of tagNames) {
    await prisma.dishTag.upsert({
      where: { name },
      create: { name, category: ['清淡', '微辣', '重辣', '浓郁', '偏甜', '酸甜'].includes(name) ? 'FLAVOR' : 'INGREDIENT' },
      update: {},
    });
  }

  // ── 菜品（54 道）──
  const dishes = [];
  for (let i = 0; i < DISHES.length; i += 1) {
    const d = DISHES[i];
    const stall = stalls[i % stalls.length];
    const ingredients = [...new Set([
      ...d[3].filter((t) => !['微辣', '重辣', '清淡', '浓郁', '偏甜', '酸甜', '低脂', '纯素', '高蛋白', '现炸', '现煎', '烧烤', '自选', '均衡', '解腻', '小吃', '早餐', '夜宵', '甜品', '饮品'].includes(t)),
      d[1] === '米饭' ? '米饭' : d[1] === '面食' ? '面条' : d[1],
    ])].slice(0, 6);
    const dish = await prisma.dish.create({
      data: {
        stallId: stall.id, name: d[0], description: `${stall.name}出品，${d[3].slice(0, 2).join(' · ')}风味。`,
        imageUrl: `/demo/dishes/dish-${String(i + 1).padStart(2, '0')}.png`,
        priceCents: d[2], category: d[1], cuisine: d[3].includes('川湘') ? '川菜' : '粤菜',
        spiceScore: d[4], oilScore: d[5], saltScore: Math.min(5, Math.round(d[4] / 2) + 2),
        sweetnessScore: d[3].includes('偏甜') ? 4 : (d[3].includes('酸甜') ? 3 : 0),
        flavorIntensity: Math.min(5, Math.max(1, d[4] + 1)), portionScore: 3,
        isVegetarian: d[6], isHighProtein: d[7], isNew: i % 9 === 0,
        allergens: allergensFor(d), ingredients,
        tags: { connect: d[3].map((name) => ({ name })) },
        ingredientRows: { create: ingredients.map((name, k) => ({ name, isMain: k < 2, sortOrder: k })) },
        nutrition: {
          create: {
            energyKcal: 280 + d[5] * 55 + (d[7] ? 90 : 0),
            proteinG: d[7] ? 26 : 9,
            fatG: 4 + d[5] * 3.2,
            carbG: d[1] === '米饭' || d[1] === '面食' ? 62 : 22,
            fiberG: d[3].includes('蔬菜') ? 6.5 : 2.1,
            sodiumMg: 320 + d[4] * 90,
            source: 'ESTIMATED', isEstimated: true,
            sourceNote: '演示估算值：按菜品类别与常见配料推算，非实验室检测结果。',
          },
        },
      },
    });
    dishes.push(dish);
  }
  console.log(`[seed] 菜品 ${dishes.length} 道（含营养与过敏原）`);

  // ── 用户：两名偏好截然不同的学生 + 商户 + 管理员 + 4 名普通学生 ──
  const mkUser = (email: string, displayName: string, role: 'STUDENT' | 'MERCHANT' | 'ADMIN') =>
    prisma.user.create({ data: { email, passwordHash, displayName, role, onboardedAt: new Date() } });

  const studentA = await mkUser(env('DEMO_STUDENT_A_EMAIL', 'student.a@demo.shiguang.local'), '林小满', 'STUDENT');
  const studentB = await mkUser(env('DEMO_STUDENT_B_EMAIL', 'student.b@demo.shiguang.local'), '许知禾', 'STUDENT');
  const merchant = await mkUser(env('DEMO_MERCHANT_EMAIL', 'merchant@demo.shiguang.local'), '一食堂 · 王师傅', 'MERCHANT');
  const admin = await mkUser(env('DEMO_ADMIN_EMAIL', 'admin@demo.shiguang.local'), '平台管理员', 'ADMIN');
  const others = [];
  for (let i = 0; i < 4; i += 1) others.push(await mkUser(`student.c${i}@demo.shiguang.local`, ['周予安', '陈念', '沈嘉树', '苏晚'][i], 'STUDENT'));

  await prisma.stall.update({ where: { id: stalls[0].id }, data: { managers: { connect: { id: merchant.id } } } });
  await prisma.stall.update({ where: { id: stalls[1].id }, data: { managers: { connect: { id: merchant.id } } } });

  // A：微辣、鸡肉、米饭、15–25 元；B：清淡、蔬菜、面食、10–20 元
  await prisma.userPreference.create({ data: {
    userId: studentA.id, cuisines: ['川菜', '粤菜'], staplePreferences: ['米饭'],
    ingredientLikes: ['鸡肉', '香菇'], ingredientDislikes: [], spiceTolerance: 3, sweetness: 1,
    saltiness: 3, oilTolerance: 3, flavorIntensity: 4, specialLikes: ['葱'],
    budgetMinCents: 1500, budgetMaxCents: 2500, preferredCanteenIds: [canteens[0].id],
    preferredStallIds: [stalls[0].id], usualMealTimes: ['11:45'], priority: 'TASTE',
    adventurous: true, dietPattern: 'OMNIVORE',
  }});
  await prisma.userPreference.create({ data: {
    userId: studentB.id, cuisines: ['粤菜'], staplePreferences: ['面食', '粉类'],
    ingredientLikes: ['西兰花', '番茄'], ingredientDislikes: ['肥肉'], spiceTolerance: 0, sweetness: 2,
    saltiness: 1, oilTolerance: 1, flavorIntensity: 1, specialLikes: [],
    budgetMinCents: 1000, budgetMaxCents: 2000, preferredCanteenIds: [canteens[1].id],
    preferredStallIds: [stalls[5].id], usualMealTimes: ['12:00'], priority: 'NUTRITION',
    adventurous: false, dietPattern: 'VEGETARIAN',
  }});
  await prisma.dietaryRestriction.createMany({ data: [
    { userId: studentA.id, kind: 'DISLIKE', value: '香菜', source: 'USER_EXPLICIT', note: '明确设置，系统推断不得覆盖' },
    { userId: studentB.id, kind: 'ALLERGEN', value: '花生', source: 'USER_EXPLICIT', note: '硬性过滤' },
    { userId: studentB.id, kind: 'ALLERGEN', value: '乳糖', source: 'USER_EXPLICIT', note: '硬性过滤' },
  ]});
  console.log('[seed] 演示账号 4 类 / 学生画像 A-B 已建立（偏好截然不同）');

  // ── 今日菜单 / 库存 / 时段 ──
  const date = today();
  for (const mealType of ['BREAKFAST', 'LUNCH', 'DINNER'] as const) {
    for (const stall of stalls) {
      const menu = await prisma.menu.create({ data: { stallId: stall.id, date, mealType, status: 'PUBLISHED', publishedAt: new Date() } });
      const own = dishes.filter((d) => d.stallId === stall.id).slice(0, mealType === 'LUNCH' ? 5 : 3);
      for (let k = 0; k < own.length; k += 1) {
        await prisma.menuItem.create({ data: { menuId: menu.id, dishId: own[k].id, isAvailable: true, sortOrder: k } });
        await prisma.inventory.create({ data: { dishId: own[k].id, date, mealType, total: 40, remaining: 8 + ((k * 7) % 30) } });
      }
      for (const [start, end] of [['11:30', '11:45'], ['11:45', '12:00'], ['12:00', '12:15']]) {
        await prisma.pickupSlot.create({ data: { stallId: stall.id, date, mealType, startTime: start, endTime: end, capacity: 20, booked: 0, cutoffMinutes: 15 } });
      }
    }
  }
  console.log('[seed] 三餐菜单 / 库存 / 取餐时段已发布');

  // ── 历史评价：A 偏爱微辣鸡肉，B 偏爱清淡蔬菜，评分与体感都真实入库 ──
  const feelingPool = ['QUITE_GOOD', 'JUST_RIGHT', 'PORTION_RIGHT', 'TOO_OILY', 'TOO_SALTY', 'PORTION_SMALL', 'VERY_SATISFIED'];
  let reviewCount = 0;
  const allStudents = [studentA, studentB, ...others];
  for (const student of allStudents) {
    const picked = dishes.filter((_, i) => (i + allStudents.indexOf(student) * 3) % 7 === 0).slice(0, 8);
    for (let i = 0; i < picked.length; i += 1) {
      const dish = picked[i];
      const likesChicken = student.id === studentA.id;
      const likesLight = student.id === studentB.id;
      const isChickenSpicy = /鸡|辣|藤椒/.test(dish.name);
      const isLight = /清淡|时蔬|菜心|西兰花|粥|汤|沙拉/.test(dish.name);
      const base = likesChicken ? (isChickenSpicy ? 5 : 3) : likesLight ? (isLight ? 5 : 2) : 3 + (i % 3);
      const rating = Math.max(1, Math.min(5, base));
      const feelings = rating <= 2 ? ['TOO_OILY', feelingPool[i % feelingPool.length]] : [feelingPool[i % 4]];
      await prisma.review.create({
        data: {
          userId: student.id, dishId: dish.id, source: 'OFFLINE', rating,
          comment: rating <= 2 ? '味道还可以，就是有点油。' : (rating >= 5 ? '很合口味，会再来。' : null),
          createdAt: new Date(Date.now() - (i + 1) * 86_400_000),
          feelings: { create: [...new Set(feelings)].map((code) => ({ code, label: code, group: code === 'PORTION_SMALL' ? 'PORTION' : (code === 'QUITE_GOOD' || code === 'VERY_SATISFIED' ? 'OVERALL' : 'TASTE') as never })) },
        },
      });
      reviewCount += 1;
    }
  }
  // 按真实评价重算均分
  for (const dish of dishes) {
    const agg = await prisma.review.aggregate({ where: { dishId: dish.id }, _avg: { rating: true }, _count: { _all: true } });
    await prisma.dish.update({ where: { id: dish.id }, data: { avgRating: agg._avg.rating ?? 0, ratingCount: agg._count._all, verifiedRatingCount: 0 } });
  }
  console.log(`[seed] 历史评价 ${reviewCount} 条，菜品均分已按真实数据重算`);

  // ── 历史订单（已完成，可评价）──
  const slot = await prisma.pickupSlot.findFirst({ where: { date, mealType: 'LUNCH', stallId: stalls[0].id } });
  if (slot) {
    for (const student of [studentA, studentB]) {
      for (let i = 0; i < 3; i += 1) {
        const dish = dishes[i * 5];
        await prisma.order.create({
          data: {
            number: `SG${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${student.id.slice(-2)}${i}`,
            userId: student.id, stallId: stalls[0].id, canteenId: canteens[0].id,
            pickupSlotId: slot.id, mealType: 'LUNCH', scheduledDate: date,
            status: 'COMPLETED', paymentStatus: 'MOCK_PAID', totalCents: dish.priceCents,
            idempotencyKey: `seed-${student.id}-${i}`, completedAt: new Date(Date.now() - (i + 1) * 86_400_000),
            items: { create: [{ dishId: dish.id, dishName: dish.name, quantity: 1, unitPriceCents: dish.priceCents, subtotalCents: dish.priceCents }] },
            paymentOrders: { create: [{ provider: 'mock', amountCents: dish.priceCents, status: 'MOCK_PAID', isMock: true }] },
          },
        });
      }
    }
  }
  await prisma.systemAnnouncement.create({ data: {
    title: '食光有数试运行公告', body: '平台为演示环境：支付为到店付款演示模式，营养数据为估算值，未接入校园统一身份认证。',
    scope: 'ALL', authorId: admin.id, publishedAt: new Date(),
  }});
  await prisma.notification.create({ data: { userId: studentA.id, type: 'REVIEW_REMINDER', title: '评价这一餐', body: '花 10 秒打个分，食光会更懂你的口味。' } });

  console.log('[seed] 完成。演示账号（密码为 DEMO_PASSWORD 或本次打印值）：');
  console.table([
    { 角色: '学生 A · 微辣鸡肉米饭派', 邮箱: studentA.email },
    { 角色: '学生 B · 清淡蔬菜面食派', 邮箱: studentB.email },
    { 角色: '食堂商户', 邮箱: merchant.email },
    { 角色: '平台管理员', 邮箱: admin.email },
  ]);
}

main()
  .catch((e) => { console.error('[seed] 失败：', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
