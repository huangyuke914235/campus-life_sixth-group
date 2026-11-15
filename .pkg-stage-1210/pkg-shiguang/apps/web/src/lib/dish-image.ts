/**
 * 菜品图片解析。
 *
 * 12 张按「主料 / 品类」拍的分类图覆盖全部 59 道菜 —— 不可能给每道菜单独拍，
 * 但按主料匹配后，图和菜是对得上的（牛肉粉配牛肉图、螺蛳粉配红汤粉图），
 * 不是随便贴一张通用食物照。
 *
 * 数据库里的 imageUrl 早期是 picsum 外链和 /demo/dishes/*.png 占位路径，
 * 文件都不存在，一律走本地兜底。
 */
const IMG = {
  beef: '/images/dishes/beef.jpg',
  chicken: '/images/dishes/chicken.jpg',
  roast: '/images/dishes/roast.jpg',
  noodle: '/images/dishes/noodle.jpg',
  soup: '/images/dishes/soup.jpg',
  bbq: '/images/dishes/bbq.jpg',
  snack: '/images/dishes/snack.jpg',
  dessert: '/images/dishes/dessert.jpg',
  veggie: '/images/dishes/veggie.jpg',
  stirfry: '/images/dishes/stirfry.jpg',
  setmeal: '/images/dishes/setmeal.jpg',
  luosi: '/images/dishes/luosi.jpg',
} as const;

/** 顺序即优先级：先匹配特征最强的，再落到通用主料 */
const RULES: [RegExp, keyof typeof IMG][] = [
  [/螺蛳|酸笋|老友粉/, 'luosi'],
  [/糖水|豆花|双皮奶|芋圆|西米|甜品|糕/, 'dessert'],
  [/烧烤|烤串|烤翅|烤鱼|生蚝|铁板/, 'bbq'],
  [/汤|羹|炖|盅/, 'soup'],
  [/烧腊|叉烧|烧鸭|烧鹅|卤|肠粉|腊味/, 'roast'],
  [/牛肉|牛腩|牛排|肥牛/, 'beef'],
  [/鸡|鸭|鸽/, 'chicken'],
  [/沙拉|时蔬|青菜|菌菇|豆腐|素|西兰花|秋葵/, 'veggie'],
  [/套餐|拼盘|双拼|自选/, 'setmeal'],
  [/煎饼|锅贴|饺子|包子|馄饨|粿|点心/, 'snack'],
  [/炒|爆|干锅|香锅/, 'stirfry'],
  [/面|粉|米线|粿条|拉面|河粉/, 'noodle'],
];

/** 判断是否是可用的自有图片地址（外链占位图和 /demo/ 假路径都不算） */
export function isOwnImage(url?: string | null): boolean {
  if (!url) return false;
  if (url.startsWith('/demo/')) return false;
  return !/picsum|unsplash|placehold|loremflickr|dummyimage/i.test(url);
}

/** 按菜名与分类推断主料，返回本地位图 */
export function fallbackDishImage(name: string, category?: string): string {
  const text = `${name}${category ?? ''}`;
  for (const [re, key] of RULES) {
    if (re.test(text)) return IMG[key];
  }
  return IMG.chicken;
}

/** 统一入口：优先自有图片，否则按菜名兜底 */
export function resolveDishImage(name: string, imageUrl?: string | null, category?: string): string {
  return isOwnImage(imageUrl) ? (imageUrl as string) : fallbackDishImage(name, category);
}
