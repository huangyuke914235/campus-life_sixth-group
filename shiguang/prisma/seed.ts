/**
 * 演示数据初始化：3 个食堂 / 12 个档口 / 54 道菜 / 营养 / 每日菜单 /
 * 库存 / 取餐时段 / 历史评价 / 订单 / 两名偏好截然不同的学生。
 *
 * 运行：pnpm db:seed
 * 由调用方显式提供隔离数据库连接、DEMO_DATABASE_NAME 和 DEMO_PASSWORD。
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { emptyTasteProfile, updateTasteProfile } from '@shiguang/shared';

class DemoSeedError extends Error {}

const FIXTURE_ID = 'shiguang-demo-fixture-v1';

function demoEmail(key: string, fallback: string): string {
  const email = (process.env[key] || fallback).trim().toLowerCase();
  if (!/^[^@\s]+@demo\.shiguang\.local$/.test(email)) {
    throw new DemoSeedError(`${key} 必须使用 @demo.shiguang.local 演示域。`);
  }
  return email;
}

const SZU_CANTEEN_IDS = ["kaifeng","lishan","litian","tingshan","tingli","shiyan","nanqu","nanqu3","caige","fatan","famu","lakespice","caiwei"];

const CANTEENS = [
  { name: "凯风餐厅", location: "粤海校区 · 文山湖社区 · 立业门附近后勤楼（新西南）一楼", description: "大众菜 / 点炒 / 潮汕粿条 / 烤肉", openTime: "07:00", closeTime: "21:00" },
  { name: "荔山餐厅", location: "粤海校区 · 斋区 · 斋区学生宿舍楼下", description: "新疆风味 / 手抓饭 / 拉面 / 烧烤", openTime: "07:00", closeTime: "21:30" },
  { name: "荔天餐厅", location: "粤海校区 · 斋区 · 斋区学生宿舍楼下 · 二/三楼", description: "湘菜 / 烧鸭 / 糖水 / 黄焖鸡", openTime: "07:00", closeTime: "21:00" },
  { name: "听山餐厅", location: "粤海校区 · 文山湖社区 · 紫藤轩附近 · 二/三楼", description: "螺蛳粉 / 烧腊 / 烤盘饭 / 自选称重", openTime: "07:00", closeTime: "21:30" },
  { name: "听荔餐厅", location: "粤海校区 · 时光社区 · 汇德楼（教育学部）旁", description: "小碗菜 / 潮汕卤水 / 水饺 / 自助餐", openTime: "07:00", closeTime: "20:30" },
  { name: "实验餐厅", location: "粤海校区 · 斋区 · 汇真楼 / 实验楼附近", description: "自选称重 / 生滚粥 / 三及第 / 铁板炒粉", openTime: "07:00", closeTime: "20:30" },
  { name: "南区餐厅", location: "粤海校区 · 沧海社区 · 南区宿舍区旁 · 一/二楼", description: "手工拉面 / 北方水饺 / 潮式卤肉 / 西点", openTime: "07:00", closeTime: "21:00" },
  { name: "南区三楼餐厅", location: "粤海校区 · 沧海社区 · 南区餐厅三楼（满之裕 / 鑫辉 / 鼎晟城）", description: "过桥米线 / 麦当劳 / 湘味小碗菜 / 冒菜", openTime: "09:00", closeTime: "22:00" },
  { name: "采葛餐厅", location: "丽湖校区 · 惟品社区 · 风信子学生宿舍一/二楼", description: "猪杂汤粉 / 湘菜 / 烧腊 / 糖水", openTime: "07:00", closeTime: "20:30" },
  { name: "伐檀餐厅", location: "丽湖校区 · 洗星社区 · 梧桐树学生宿舍一/二楼", description: "烧腊 / 自选称重 / 客家猪杂汤 / 现炒", openTime: "07:00", closeTime: "20:30" },
  { name: "伐木餐厅", location: "丽湖校区 · 洗星社区 · 伐木二/三楼", description: "隆江猪脚饭 / 鲜肉包 / 石锅扒饭 / 馄饨", openTime: "07:00", closeTime: "21:00" },
  { name: "丽湖风味餐厅", location: "丽湖校区 · 洗星社区 · 伐木一楼西侧", description: "新疆大盘鸡 / 手抓饭 / 烤包子 / 烤馕", openTime: "10:00", closeTime: "21:00" },
  { name: "采薇餐厅", location: "丽湖校区 · 惟品社区 · 教工餐厅 · 二楼国际风味", description: "小碗蒸菜 / 现炒 / 手工面 / 西式简餐", openTime: "10:30", closeTime: "20:00" },
];

const STALLS = [
  { canteenIndex: 0, name: "凯风主档口", description: "大众菜、点炒、潮汕粿条" },
  { canteenIndex: 1, name: "荔山主档口", description: "新疆风味、手抓饭、拉面" },
  { canteenIndex: 2, name: "荔天主档口", description: "湘菜、烧鸭、糖水" },
  { canteenIndex: 3, name: "听山主档口", description: "螺蛳粉、烧腊、烤盘饭" },
  { canteenIndex: 4, name: "听荔主档口", description: "小碗菜、潮汕卤水、水饺" },
  { canteenIndex: 5, name: "实验主档口", description: "自选称重、生滚粥、三及第" },
  { canteenIndex: 6, name: "南区主档口", description: "手工拉面、北方水饺、潮式卤肉" },
  { canteenIndex: 7, name: "南区三楼主档口", description: "过桥米线、麦当劳、湘味小碗菜" },
  { canteenIndex: 8, name: "采葛主档口", description: "猪杂汤粉、湘菜、烧腊" },
  { canteenIndex: 9, name: "伐檀主档口", description: "烧腊、自选称重、客家猪杂汤" },
  { canteenIndex: 10, name: "伐木主档口", description: "隆江猪脚饭、鲜肉包、石锅扒饭" },
  { canteenIndex: 11, name: "丽湖风味主档口", description: "新疆大盘鸡、手抓饭、烤包子" },
  { canteenIndex: 12, name: "采薇主档口", description: "小碗蒸菜、现炒、手工面" },
];

/** [菜名, 分类, 价格(分), 标签, 辣度, 油腻度, 素食, 高蛋白, 咸度, 餐厅id, 源评分(5分制), 源评价数, 真实描述] */
type DishSeed = [string, string, number, string[], number, number, boolean, boolean, number, string, number, number, string];
const DISHES: DishSeed[] = [
  ["潮汕牛肉粿条", "面食", 1800, ["汤鲜","牛肉嫩","潮汕风味","面食"], 0, 2, false, true, 3, "kaifeng", 4.8, 412, "牛骨清汤 · 牛肉现烫。每日现熬牛骨汤底，牛肉下锅十秒即捞，粿条爽滑，配一勺沙茶酱更香。"],
  ["现点现炒小炒肉", "现炒", 1500, ["锅气足","下饭","微辣","现炒"], 2, 4, false, true, 3, "kaifeng", 4.6, 288, "锅气十足 · 三分钟出餐。五花肉配螺丝椒猛火爆炒，油亮喷香，白饭杀手，建议配一份例汤。"],
  ["自选麻辣烫", "汤品", 1400, ["食材新鲜","可调辣度","划算","汤品"], 4, 2, false, false, 3, "kaifeng", 4.5, 503, "自选称重 · 麻辣可调。三十多种食材自选，麻辣 / 番茄 / 骨汤三种锅底，人均十几块吃得饱。"],
  ["卤味三拼饭", "主食", 1600, ["卤味香","分量足","主食"], 0, 2, false, false, 4, "kaifeng", 4.4, 197, "卤水鹅 · 卤蛋 · 豆干。潮式卤水拼盘盖饭，鹅肉入味不柴，卤汁浇饭是精髓。"],
  ["秘制烤肉饭", "主食", 1700, ["烤得香","偏甜口","主食"], 0, 3, false, true, 3, "kaifeng", 4.5, 231, "现烤 · 蜜汁微焦。叉烧与烤鸡双拼，边缘微焦带蜜香，配时蔬解腻。"],
  ["新疆手抓饭", "主食", 2000, ["羊肉香","分量大","正宗","主食"], 0, 2, false, true, 3, "lishan", 4.9, 368, "羊腿肉 · 胡萝卜甜。大块羊腿肉配黄胡萝卜焖饭，米粒吸饱羊油，粒粒分明，荔山招牌。"],
  ["新疆拌面（拉条子）", "面食", 1600, ["面劲道","浇头足","面食"], 0, 2, false, false, 3, "lishan", 4.7, 275, "手工拉制 · 过油肉拌。面条筋道，过油肉浇头带番茄酸香，拌开很过瘾。"],
  ["兰州牛肉拉面", "面食", 1400, ["汤清","性价比高","面食"], 2, 1, false, true, 2, "lishan", 4.4, 421, "一清二白三红四绿。清汤牛肉面，萝卜片配香菜蒜苗，辣油香而不燥。"],
  ["香辣烤肉串", "烧烤", 1200, ["孜然香","现烤","烧烤"], 2, 3, false, true, 3, "lishan", 4.6, 312, "现串现烤 · 孜然味。羊肉串现烤，孜然辣椒面撒得实在，三串起售，夜宵首选。"],
  ["新疆馕饼", "小吃", 500, ["便宜","耐嚼","小吃"], 0, 2, false, false, 3, "lishan", 4.3, 156, "现烤 · 芝麻香。刚出炉的馕外脆内软，配抓饭或奶茶都合适，五块钱一大张。"],
  ["黄焖鸡米饭", "主食", 1600, ["下饭","鸡肉嫩","主食"], 0, 2, false, true, 3, "litian", 4.5, 389, "砂锅现焖 · 微辣。鸡腿肉焖得软烂，土豆吸汁，汤汁拌饭能多吃一碗。"],
  ["湘味小炒肉", "现炒", 1500, ["够辣","锅气足","现炒"], 2, 3, false, true, 3, "litian", 4.6, 262, "螺丝椒 · 猛火快炒。湖南同学认证的辣度，五花肉煸出油香，一口一口停不下来。"],
  ["广式烧鸭饭", "主食", 1700, ["皮脆","酱汁香","主食"], 0, 2, false, false, 3, "litian", 4.7, 341, "脆皮烧鸭 · 酸梅酱。皮脆肉嫩，酸梅酱解腻，配一勺烧鸭汁的油饭是精华。"],
  ["潮汕粿条汤", "汤品", 1300, ["清淡","汤头好","汤品"], 0, 2, false, false, 2, "litian", 4.4, 208, "猪骨汤底 · 现烫。汤底清甜，粿条滑溜，加一份牛肉丸更满足。"],
  ["芋圆烧仙草", "甜品", 700, ["Q弹","解腻","甜品"], 0, 2, false, false, 3, "litian", 4.5, 175, "手工芋圆 · 冰镇。饭后甜品，芋圆 Q 弹，仙草微苦回甘，夏天必点。"],
  ["螺粉记螺蛳粉", "面食", 1300, ["酸笋香","够味","面食"], 0, 2, false, false, 3, "tingshan", 4.3, 455, "酸笋可加 · 微辣。酸笋够味，汤底螺香浓郁，带回宿舍要小心味道。"],
  ["水煮屋猪肚鸡", "汤品", 2200, ["汤浓","暖胃","汤品"], 0, 2, false, true, 3, "tingshan", 4.8, 271, "胡椒暖胃 · 两人份。胡椒猪肚鸡汤，冬天来一锅从头暖到脚，鸡肉可以免费加。"],
  ["烧腊双拼饭", "主食", 1800, ["双拼划算","叉烧好吃","主食"], 0, 2, false, false, 3, "tingshan", 4.6, 298, "叉烧 · 烧肉。蜜汁叉烧配脆皮烧肉，双拼一次满足，例汤每天换。"],
  ["烤盘饭", "现炒", 1600, ["香","有锅巴","现炒"], 0, 3, false, false, 4, "tingshan", 4.4, 215, "铁板滋滋响。铁板现炒，酱香浓郁，底部会有一层微焦的饭焦。"],
  ["自选称重屋", "套餐", 1500, ["选择多","可清淡","套餐"], 0, 2, false, false, 2, "tingshan", 4.3, 332, "按克计价 · 选择多。几十种热菜自选称重，荤素自由搭配，适合想吃多样的同学。"],
  ["潮汕卤水拼盘", "主食", 1800, ["卤味正","料足","主食"], 0, 2, false, false, 4, "tingli", 4.6, 244, "卤鹅 · 卤肠 · 卤蛋。卤汁咸香带甜，鹅肉厚切，配蒜泥白醋很地道。"],
  ["手工水饺", "小吃", 1200, ["皮薄","馅大","小吃"], 0, 2, false, false, 3, "tingli", 4.5, 186, "皮薄馅大 · 现包。每日现包，猪肉白菜与玉米虾仁两种馅，皮薄得透光。"],
  ["黑椒鸡扒饭", "主食", 1600, ["鸡扒嫩","酱多","主食"], 0, 2, false, true, 3, "tingli", 4.4, 203, "现煎鸡扒 · 黑椒汁。鸡扒厚实多汁，黑椒汁给得足，配意面或米饭都可。"],
  ["小碗菜三件套", "套餐", 1300, ["精致","不浪费","套餐"], 0, 2, false, false, 3, "tingli", 4.3, 158, "精致小碗 · 一人食。小碗装菜，一个人也能吃到三样，适合不想吃太饱的中午。"],
  ["三及第汤粉", "汤品", 1300, ["汤鲜","料新鲜","汤品"], 0, 2, false, false, 2, "shiyan", 4.7, 326, "猪肝瘦肉粉肠。客家三及第，枸杞叶配猪杂，汤清味鲜，早餐首选。"],
  ["现熬生滚粥", "小吃", 600, ["绵密","暖胃","小吃"], 0, 2, false, false, 3, "shiyan", 4.4, 212, "绵密 · 现滚。白粥底熬得绵密，加皮蛋瘦肉或鱼片现滚，六块钱很实在。"],
  ["铁板炒粉", "现炒", 1200, ["不油","镬气足","现炒"], 0, 3, false, false, 3, "shiyan", 4.5, 238, "镬气足 · 不油。河粉炒得干爽不粘，镬气足，加个蛋更香。"],
  ["自选称重（实验）", "套餐", 1400, ["便宜","家常","套餐"], 0, 2, false, false, 3, "shiyan", 4.2, 265, "家常菜 · 性价比。菜品轮换快，家常口味，价格实惠，适合每天吃。"],
  ["潮式卤肉饭", "主食", 1500, ["入味","下饭","主食"], 0, 2, false, true, 4, "nanqu", 4.6, 287, "卤肉入口即化。卤肉肥瘦相间，卤汁浸透米饭，配半颗卤蛋。"],
  ["砂锅云吞", "面食", 1200, ["汤鲜","热乎","面食"], 0, 2, false, false, 3, "nanqu", 4.4, 196, "砂锅现煮 · 汤鲜。砂锅端上桌还在滚，云吞皮薄，汤里有紫菜虾皮。"],
  ["手工拉面", "面食", 1300, ["现拉","汤浓","面食"], 0, 2, false, false, 3, "nanqu", 4.3, 241, "现拉 · 可选粗细。师傅现场拉面，可选二细或宽面，牛肉汤底浓郁。"],
  ["煎扒套餐", "套餐", 1800, ["肉厚","配套齐全","套餐"], 0, 2, false, true, 3, "nanqu", 4.5, 178, "鸡扒猪扒双选。煎扒配意面、玉米浓汤，一份吃得很饱。"],
  ["西点面包", "甜品", 600, ["现烤","方便","甜品"], 0, 3, false, false, 3, "nanqu", 4.2, 302, "现烤 · 早八救星。每天现烤的菠萝包与蛋挞，配豆浆就是一顿早八早餐。"],
  ["蒙自源过桥米线", "面食", 2200, ["料足","汤鲜","面食"], 0, 2, false, false, 3, "nanqu3", 4.5, 214, "滚汤烫熟 · 料多。一大碗滚汤自己下料，米线滑，汤头鲜，冬天很治愈。"],
  ["麦当劳巨无霸套餐", "套餐", 3200, ["方便","稳定","套餐"], 0, 2, false, false, 3, "nanqu3", 4.4, 398, "校园店 · 全天供应。不想吃食堂时候的备选，套餐配薯条可乐，深夜也开。"],
  ["湘味小碗菜", "现炒", 1600, ["够味","下饭","现炒"], 2, 3, false, false, 3, "nanqu3", 4.6, 183, "现炒 · 辣度可选。鼎晟城档口现炒小碗菜，辣椒炒肉够味，米饭管够。"],
  ["冒菜麻辣烫", "汤品", 1800, ["香辣","选择多","汤品"], 2, 2, false, false, 3, "nanqu3", 4.3, 226, "牛油锅底 · 香。牛油锅底够香，菜品选择多，人均二十左右能吃很好。"],
  ["港卤猪排饭", "主食", 2000, ["猪排厚","港味","主食"], 0, 2, false, false, 4, "nanqu3", 4.5, 167, "厚切猪排 · 港式卤汁。厚切猪排炸得酥，港式卤汁带甜，配一杯柠檬茶刚好。"],
  ["猪杂汤粉面", "汤品", 1400, ["干净","汤甜","汤品"], 0, 2, false, false, 3, "caige", 4.7, 258, "猪杂现烫 · 汤清。丽湖同学的心头好，猪杂处理得干净，汤底清甜。"],
  ["烧腊烧鸭饭", "主食", 1700, ["皮脆","蜜香","主食"], 0, 2, false, false, 3, "caige", 4.5, 204, "烧鸭 · 叉烧。烧鸭皮脆，叉烧蜜香，双拼加五块很值。"],
  ["湘菜小炒黄牛肉", "现炒", 1800, ["牛肉嫩","够辣","现炒"], 2, 3, false, true, 3, "caige", 4.6, 176, "黄牛肉 · 小米辣。黄牛肉嫩，小米辣够劲，湖南同学说接近家乡味。"],
  ["双皮奶糖水", "甜品", 800, ["奶味浓","不太甜","甜品"], 0, 2, false, false, 3, "caige", 4.8, 289, "奶味浓 · 冰热可选。奶皮厚，入口滑，甜度克制，晚饭后来一碗很幸福。"],
  ["客家猪杂汤", "汤品", 1500, ["料足","暖胃","汤品"], 0, 2, false, false, 3, "fatan", 4.6, 231, "胡椒香 · 料实在。客家做法，胡椒暖胃，猪杂给得实在，配一碗白饭。"],
  ["自选称重（伐檀）", "套餐", 1600, ["选择多","新鲜","套餐"], 0, 3, false, false, 3, "fatan", 4.4, 264, "菜品多 · 现炒档。二楼自选称重菜品丰富，还有现点现炒，适合人多一起。"],
  ["烧腊三宝饭", "主食", 1900, ["三拼满足","皮脆","主食"], 0, 2, false, false, 3, "fatan", 4.7, 197, "烧鸭 · 叉烧 · 烧肉。三宝齐全，烧肉皮脆得响，配酸梅酱很正。"],
  ["蒜蓉炒时蔬", "现炒", 800, ["清爽","不油","现炒"], 0, 3, false, false, 3, "fatan", 4.3, 142, "现炒 · 清爽。青菜炒得翠绿不塌，蒜香足，解腻必点。"],
  ["隆江猪脚饭", "主食", 1500, ["软糯","卤汁香","主食"], 0, 2, false, false, 4, "famu", 4.8, 352, "软糯脱骨 · 卤汁香。猪脚卤得软糯，筷子一夹就散，卤汁拌饭是灵魂。"],
  ["石锅扒饭", "主食", 1800, ["锅巴香","保温好","主食"], 0, 2, false, false, 3, "famu", 4.5, 213, "石锅 · 有锅巴。石锅保温到最后一勺，底部锅巴香脆，鸡扒给得厚。"],
  ["上海馄饨", "面食", 1200, ["皮薄","清淡","面食"], 0, 1, false, false, 2, "famu", 4.4, 188, "薄皮 · 清汤。皮薄如纸，一碗十只，清汤配蛋皮丝，清淡舒服。"],
  ["网红鲜肉包", "小吃", 300, ["便宜","馅多汁","小吃"], 0, 2, false, true, 3, "famu", 4.6, 412, "现蒸 · 三块钱。三块钱一个，肉馅带汁，早上七点就开始排队。"],
  ["三及第汤", "汤品", 1000, ["鲜","实惠","汤品"], 0, 2, false, false, 3, "famu", 4.5, 175, "枸杞叶 · 猪杂。经典客家早餐汤，配一份肠粉或包子就是完整早餐。"],
  ["新疆大盘鸡（半份）", "主食", 3800, ["入味","分量大","主食"], 0, 2, false, true, 3, "lakespice", 4.7, 164, "两人份 · 送面。土豆软糯，鸡肉入味，汤汁拌面是精华，两人吃刚好。"],
  ["手抓饭（丽湖风味）", "主食", 2000, ["羊肉酥","香甜","主食"], 0, 1, false, true, 3, "lakespice", 4.6, 192, "羊排 · 葡萄干。羊排炖得酥烂，饭里有葡萄干与胡萝卜的甜。"],
  ["牛肉烤包子", "小吃", 600, ["皮酥","多汁","小吃"], 0, 2, false, true, 3, "lakespice", 4.5, 208, "现烤 · 皮酥。外皮酥脆，牛肉洋葱馅带汁，六块钱两个。"],
  ["自制烤馕", "小吃", 500, ["便宜","耐嚼","小吃"], 0, 3, false, false, 3, "lakespice", 4.4, 143, "现烤 · 芝麻。现烤列巴与馕，配大盘鸡汤汁吃很绝。"],
  ["小碗蒸菜套餐", "套餐", 1500, ["少油","健康","套餐"], 0, 2, false, false, 3, "caiwei", 4.6, 187, "蒸菜 · 少油。蒸菜少油健康，一份三小碗配米饭，适合健身的同学。"],
  ["手工牛肉面", "面食", 1600, ["面劲道","牛肉大块","面食"], 0, 2, false, true, 3, "caiwei", 4.7, 203, "手工面 · 牛肉大块。手工面筋道，牛肉大块不柴，汤头清亮。"],
  ["黑椒西冷扒", "套餐", 3200, ["环境好","适合聚餐","套餐"], 0, 2, false, false, 3, "caiwei", 4.5, 129, "西式简餐 · 配沙拉。校园里的西式简餐，西冷煎得中规中矩，环境安静适合聚餐。"],
  ["现炒小炒（采薇）", "现炒", 1400, ["家常","实惠","现炒"], 0, 3, false, false, 3, "caiwei", 4.4, 158, "现点现炒 · 家常。家常小炒，火候到位，一个人点一份配饭刚好。"],
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

function demoDate(): Date {
  const day = process.env.DEMO_SEED_DATE || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format();
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new DemoSeedError('DEMO_SEED_DATE 必须是有效的 YYYY-MM-DD 日期。');
  }
  return date;
}

async function createDemoData(prisma: Prisma.TransactionClient, date: Date, passwordHash: string): Promise<void> {
  // ── 食堂与档口 ──
  const canteens = [];
  const stalls = [];
  const stallByCanteenKey = new Map<string, string>();
  for (let ci = 0; ci < CANTEENS.length; ci += 1) {
    const c = CANTEENS[ci];
    const key = SZU_CANTEEN_IDS[ci];
    const row = await prisma.canteen.create({ data: { ...c, id: `demo-canteen-${key}`, coverUrl: null, notice: '今日菜品以窗口实际供应为准，营养信息为估算值。' } });
    canteens.push(row);
    const st = STALLS[ci];
    const stall = await prisma.stall.create({
      data: { id: `demo-stall-${key}`, canteenId: row.id, name: st.name, description: st.description, floor: '1F', windowNo: '1', isActive: true },
    });
    stalls.push(stall);
    stallByCanteenKey.set(SZU_CANTEEN_IDS[ci], stall.id);
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
    const stallId = stallByCanteenKey.get(d[9]) ?? stalls[0].id;
    const ingredients = [...new Set([
      ...d[3].filter((t) => !['微辣', '重辣', '清淡', '浓郁', '偏甜', '酸甜', '低脂', '纯素', '高蛋白', '现炸', '现煎', '烧烤', '自选', '均衡', '解腻', '小吃', '早餐', '夜宵', '甜品', '饮品'].includes(t)),
      d[1] === '米饭' ? '米饭' : d[1] === '面食' ? '面条' : d[1],
    ])].slice(0, 6);
    const dish = await prisma.dish.create({
      data: {
        stallId, name: d[0], description: d[12],
        avgRating: d[10] * 2, ratingCount: d[11],
        // 图片由前端按菜名映射到 12 张分类图，这里不再写占位路径
        priceCents: d[2], category: d[1],
        // 菜系按菜名与标签关键词判断（新数据没有「川湘」这类显式标签）
        cuisine: /辣|川|湘|螺蛳|酸笋|剁椒|麻辣/.test(d[0] + d[3].join(''))
          ? '川菜'
          : /潮汕|粿条|卤|烧腊|肠粉|炖汤|清汤|白灼/.test(d[0] + d[3].join(''))
            ? '粤菜'
            : '其他',
        spiceScore: d[4], oilScore: d[5], saltScore: d[8] ?? Math.min(5, Math.round(d[4] / 2) + 2),
        sweetnessScore: d[1] === '甜品' ? 4 : (/甜|糖水|双皮奶|豆花/.test(d[0] + d[3].join('')) ? 3 : 0),
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

  const studentA = await mkUser(demoEmail('DEMO_STUDENT_A_EMAIL', 'student.a@demo.shiguang.local'), '林小满', 'STUDENT');
  const studentB = await mkUser(demoEmail('DEMO_STUDENT_B_EMAIL', 'student.b@demo.shiguang.local'), '许知禾', 'STUDENT');
  const merchant = await mkUser(demoEmail('DEMO_MERCHANT_EMAIL', 'merchant@demo.shiguang.local'), '一食堂 · 王师傅', 'MERCHANT');
  const admin = await mkUser(demoEmail('DEMO_ADMIN_EMAIL', 'admin@demo.shiguang.local'), '平台管理员', 'ADMIN');
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
  // C–F：按真实菜品体系（川湘 / 预算 / 夜宵 / 汤饮）配画像，不再只有 A、B 两个有偏好
  // C 周予安：川湘重口，常去听荔（螺蛳粉/烧腊）与荔天（湘菜/黄焖鸡）
  await prisma.userPreference.create({ data: {
    userId: others[0].id, cuisines: ['川菜', '湘菜'], staplePreferences: ['主食'],
    ingredientLikes: ['辣椒', '牛肉', '五花肉'], ingredientDislikes: [],
    spiceTolerance: 5, sweetness: 0, saltiness: 4, oilTolerance: 4, flavorIntensity: 5,
    specialLikes: ['小米辣'], budgetMinCents: 1200, budgetMaxCents: 2600,
    preferredCanteenIds: [canteens[4].id, canteens[2].id], preferredStallIds: [stalls[4].id],
    usualMealTimes: ['12:00'], priority: 'TASTE', adventurous: true, dietPattern: 'OMNIVORE',
  }});
  // D 陈念：预算敏感，3–12 元区间，性价比优先
  await prisma.userPreference.create({ data: {
    userId: others[1].id, cuisines: ['粤菜'], staplePreferences: ['面食', '主食'],
    ingredientLikes: ['鸡蛋', '青菜'], ingredientDislikes: [],
    spiceTolerance: 1, sweetness: 1, saltiness: 2, oilTolerance: 2, flavorIntensity: 2,
    specialLikes: [], budgetMinCents: 300, budgetMaxCents: 1200,
    preferredCanteenIds: [canteens[6].id], preferredStallIds: [stalls[6].id],
    usualMealTimes: ['11:40'], priority: 'PRICE', adventurous: false, dietPattern: 'OMNIVORE',
  }});
  // E 沈嘉树：夜宵常客，烧烤与小吃为主
  await prisma.userPreference.create({ data: {
    userId: others[2].id, cuisines: ['粤菜'], staplePreferences: ['小吃'],
    ingredientLikes: ['烧烤', '生蚝'], ingredientDislikes: [],
    spiceTolerance: 3, sweetness: 1, saltiness: 4, oilTolerance: 4, flavorIntensity: 4,
    specialLikes: ['孜然'], budgetMinCents: 1000, budgetMaxCents: 3000,
    preferredCanteenIds: [canteens[11].id], preferredStallIds: [stalls[11].id],
    usualMealTimes: ['21:30'], priority: 'CONVENIENCE', adventurous: true, dietPattern: 'OMNIVORE',
  }});
  // F 苏晚：清淡汤饮 + 素食倾向
  await prisma.userPreference.create({ data: {
    userId: others[3].id, cuisines: ['粤菜'], staplePreferences: ['汤类'],
    ingredientLikes: ['菌菇', '豆腐', '时蔬'], ingredientDislikes: ['肥肉', '内脏'],
    spiceTolerance: 0, sweetness: 1, saltiness: 1, oilTolerance: 1, flavorIntensity: 1,
    specialLikes: [], budgetMinCents: 600, budgetMaxCents: 1800,
    preferredCanteenIds: [canteens[4].id], preferredStallIds: [stalls[4].id],
    usualMealTimes: ['12:10'], priority: 'NUTRITION', adventurous: false, dietPattern: 'VEGETARIAN',
  }});

    await prisma.dietaryRestriction.createMany({ data: [
    { userId: studentA.id, kind: 'DISLIKE', value: '香菜', source: 'USER_EXPLICIT', note: '明确设置，系统推断不得覆盖' },
    { userId: studentB.id, kind: 'ALLERGEN', value: '花生', source: 'USER_EXPLICIT', note: '硬性过滤' },
    { userId: studentB.id, kind: 'ALLERGEN', value: '乳糖', source: 'USER_EXPLICIT', note: '硬性过滤' },
  ]});
  console.log('[seed] 演示账号 4 类 / 学生画像 A–F 已建立（6 种真实偏好）');

// ── 评价文案库：按菜品分类 × 评分档位，避免几百条评价全是同一句话 ──
type CommentTier = { high: string[]; mid: string[]; low: string[] };
const COMMENT_LIB: Record<string, CommentTier> = {
  米饭: {
    high: [
      '浇头给得实在，汤汁拌进米饭里很香。',
      '{name}的肉很嫩，一口下去很满足。',
      '分量足，中午吃完到晚上都不饿，会回购。',
      '米饭软硬刚好，配菜也不齁咸。',
      '出餐快，饭还是热的，性价比不错。',
    ],
    mid: ['味道还行，就是配菜有点少。', '整体中规中矩，价格在那摆着。', '{name}偏咸了一点，米饭倒是刚好。'],
    low: ['浇头太油，吃到底下浮着一层。', '米饭有点坨，肉也没几块。', '咸得厉害，吃完喝了半瓶水。'],
  },
  面食: {
    high: ['汤头清亮，面煮得刚好有嚼劲。', '{name}的牛肉给得足，汤也鲜。', '分量够，冬天吃一碗很暖。', '面不坨，出餐也快。'],
    mid: ['面条口感不错，汤偏淡。', '还行，就是配料少了点。', '{name}整体可以，下次试试别的。'],
    low: ['面煮过头了，一夹就断。', '汤太咸，面又没味道。', '等了很久，端上来已经坨了。'],
  },
  粉类: {
    high: ['粉很滑，汤底够味。', '{name}的酸辣比例刚好，很开胃。', '分量实在，料给得不抠。'],
    mid: ['味道正常，粉稍微软了点。', '还行吧，没有特别惊艳。'],
    low: ['粉太烂了，一夹就碎。', '汤底齁咸，料也少。'],
  },
  轻食: {
    high: ['蔬菜很新鲜，酱汁不腻。', '{name}的鸡胸不柴，调味刚好。', '吃完很清爽，下午不犯困。', '分量对减脂来说刚好，不会饿。'],
    mid: ['菜挺新鲜，就是酱给得太少。', '整体清淡，适合减脂期。', '价格稍高，胜在干净。'],
    low: ['菜叶有点蔫，酱汁也寡淡。', '分量太少，吃完还得再买点。'],
  },
  汤品: {
    high: ['汤头清甜，喝完胃里很舒服。', '{name}料给得足，不是清汤寡水。', '温度刚好，冬天来一碗很值。'],
    mid: ['汤还可以，就是偏淡。', '料不算多，胜在便宜。'],
    low: ['汤寡得很，像兑了水。', '太咸了，喝两口就放下了。'],
  },
  热炒: {
    high: ['锅气足，辣度也够。', '{name}的辣是真辣，吃完很过瘾。', '下饭神器，一份能配两碗饭。', '肉不柴，火候把握得好。'],
    mid: ['味道够，就是油偏多。', '辣度可以，咸了一点。', '整体不错，分量中等。'],
    low: ['油太多，盘底全是油。', '咸到发苦，辣椒也不香。', '肉少得可怜，主要是配菜。'],
  },
  早餐: {
    high: ['热乎，早八前来一份很顶。', '{name}的味道很正，跟家里做的像。', '便宜又管饱，早餐首选。'],
    mid: ['味道还行，就是有点凉了。', '常规水平，胜在方便。'],
    low: ['凉了，口感差很多。', '咸得厉害，不太适合早上吃。'],
  },
  default: {
    high: ['味道不错，会再来。', '{name}比预期好吃。', '整体满意，性价比可以。'],
    mid: ['中规中矩，没什么惊喜。', '还行，看个人口味。'],
    low: ['不太合口味，有点失望。', '和描述不太一样。'],
  },
};

/** 按分类 + 评分档位挑一条文案，部分文案会带上菜名 */
const CATEGORY_ALIAS: Record<string, string> = {
  主食: '米饭', 现炒: '热炒', 烧烤: '热炒', 套餐: '米饭', 小吃: 'default', 甜品: 'default',
};

function pickComment(category: string, rating: number, name: string, seed: number): string {
  const tier = rating >= 8 ? 'high' : rating >= 5 ? 'mid' : 'low';
  const key = CATEGORY_ALIAS[category] ?? category;
  const lib = COMMENT_LIB[key] ?? COMMENT_LIB.default;
  const pool = lib[tier];
  return pool[seed % pool.length].replace('{name}', name);
}

  // ── 历史评价：A 偏爱微辣鸡肉，B 偏爱清淡蔬菜，评分与体感都真实入库 ──

/** 体感标签中文名：原来是直接把英文 code 当 label 存了 */
const FEELING_LABELS: Record<string, string> = {
  QUITE_GOOD: '整体不错',
  JUST_RIGHT: '口味刚好',
  PORTION_RIGHT: '分量合适',
  PORTION_SMALL: '分量偏少',
  TOO_OILY: '太油了',
  TOO_SALTY: '太咸了',
  VERY_SATISFIED: '非常满意',
};
  const feelingPool = ['QUITE_GOOD', 'JUST_RIGHT', 'PORTION_RIGHT', 'TOO_OILY', 'TOO_SALTY', 'PORTION_SMALL', 'VERY_SATISFIED'];
  let reviewCount = 0;
  const allStudents = [studentA, studentB, ...others];
  for (const student of allStudents) {
    const picked = dishes.filter((_, i) => (i + allStudents.indexOf(student) * 3) % 3 === 0).slice(0, 30);
    for (let i = 0; i < picked.length; i += 1) {
      const dish = picked[i];
      const likesChicken = student.id === studentA.id;
      const likesLight = student.id === studentB.id;
      const isChickenSpicy = /鸡|辣|藤椒/.test(dish.name);
      const isLight = /清淡|时蔬|菜心|西兰花|粥|汤|沙拉/.test(dish.name);
      // A/B 走各自的偏好逻辑，其他人围绕这道菜的真实评分（源数据 4.2–4.9 → 10 分制的 8.4–9.8）浮动
      const base = likesChicken
        ? (isChickenSpicy ? 9 : 6)
        : likesLight
          ? (isLight ? 9 : 4)
          : Math.round(dish.avgRating || 8) + ((i % 3) - 1);
      const rating = Math.max(1, Math.min(10, base));
      const feelings = rating <= 4 ? ['TOO_OILY', feelingPool[i % feelingPool.length]] : [feelingPool[i % 4]];
      await prisma.review.create({
        data: {
          userId: student.id, dishId: dish.id, source: 'OFFLINE', rating,
          comment: pickComment(dish.category, rating, dish.name, i + allStudents.indexOf(student) * 7),
          createdAt: new Date(Date.now() - (i + 1) * 86_400_000),
          feelings: { create: [...new Set(feelings)].map((code) => ({ code, label: FEELING_LABELS[code] ?? code, group: code === 'PORTION_SMALL' || code === 'PORTION_RIGHT' ? 'PORTION' : (code === 'QUITE_GOOD' || code === 'VERY_SATISFIED' ? 'OVERALL' : 'TASTE') as never })) },
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

  // 用 shared 引擎基于真实评价重放画像，与 reviews 模块保持一致
  for (const st of allStudents) {
    const rows = await prisma.review.findMany({
      where: { userId: st.id },
      include: { feelings: true, dish: { include: { tags: true, ingredientRows: true } } },
      orderBy: { createdAt: 'asc' },
    });
    let profile = emptyTasteProfile(new Date().toISOString());
    for (const r of rows) {
      profile = updateTasteProfile(profile, {
        rating: r.rating,
        feelings: r.feelings.map((f) => f.code),
        dishTags: r.dish.tags.map((t) => t.name),
        dishIngredients: r.dish.ingredientRows.map((i) => i.name),
        source: r.source,
        createdAt: r.createdAt.toISOString(),
      });
    }
    const data = {
      tagWeights: profile.tagWeights,
      confidence: profile.confidence,
      feedbackCount: profile.feedbackCount,
      oilToleranceInferred: profile.oilToleranceInferred,
      spiceAffinity: profile.spiceAffinity,
      saltSensitivity: profile.saltSensitivity,
      flavorIntensity: profile.flavorIntensity,
      portionPreference: profile.portionPreference,
      vegetableAffinity: profile.vegetableAffinity,
      proteinAffinity: profile.proteinAffinity,
      noveltyAffinity: profile.noveltyAffinity,
      lastDecayAt: new Date(profile.lastDecayAt),
    };
    await prisma.userTasteProfile.upsert({ where: { userId: st.id }, create: { userId: st.id, ...data }, update: data });
  }
  console.log('[seed] 用户口味画像已按真实评价重放生成');

  // ── 历史订单（已完成，可评价）──
  const previousDay = new Date(date.getTime() - 86_400_000);
  const historicalDishes = dishes.filter((dish) => dish.stallId === stalls[0].id).slice(0, 3);
  const historicalSlot = await prisma.pickupSlot.create({ data: {
    stallId: stalls[0].id, date: previousDay, mealType: 'LUNCH', startTime: '11:30', endTime: '11:45',
    capacity: 20, booked: historicalDishes.length * 2, cutoffMinutes: 15,
  } });
  const completedAt = new Date(previousDay.getTime() + (3 * 60 + 40) * 60_000);
  for (const [studentIndex, student] of [studentA, studentB].entries()) {
    for (const [dishIndex, dish] of historicalDishes.entries()) {
      await prisma.order.create({
        data: {
          number: `SGDEMO${studentIndex + 1}${dishIndex + 1}`,
          userId: student.id, stallId: stalls[0].id, canteenId: canteens[0].id,
          pickupSlotId: historicalSlot.id, mealType: 'LUNCH', scheduledDate: previousDay,
          status: 'COMPLETED', paymentStatus: 'MOCK_PAID', totalCents: dish.priceCents,
          idempotencyKey: `seed-${student.id}-${dishIndex}`, createdAt: completedAt, completedAt,
          items: { create: [{ dishId: dish.id, dishName: dish.name, quantity: 1, unitPriceCents: dish.priceCents, subtotalCents: dish.priceCents }] },
          paymentOrders: { create: [{ provider: 'mock', amountCents: dish.priceCents, status: 'MOCK_PAID', isMock: true }] },
        },
      });
    }
  }
  await prisma.systemAnnouncement.create({ data: {
    id: FIXTURE_ID,
    title: '食光有数试运行公告', body: '平台为演示环境：支付为到店付款演示模式，营养数据为估算值，未接入校园统一身份认证。',
    scope: 'ALL', authorId: admin.id, publishedAt: new Date(),
  }});
  await prisma.notification.create({ data: { userId: studentA.id, type: 'REVIEW_REMINDER', title: '评价这一餐', body: '花 10 秒打个分，食光会更懂你的口味。' } });

}

const SLOT_PLAN = {
  BREAKFAST: [['07:30', '07:45'], ['07:45', '08:00']],
  LUNCH: [['11:30', '11:45'], ['11:45', '12:00'], ['12:00', '12:15']],
  DINNER: [['17:30', '17:45'], ['17:45', '18:00']],
} as const;

async function seedAvailability(prisma: Prisma.TransactionClient, date: Date): Promise<void> {
  const stalls = await prisma.stall.findMany({
    where: { id: { in: SZU_CANTEEN_IDS.map((key) => `demo-stall-${key}`) } },
    select: { id: true, dishes: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } } },
  });
  for (const stall of stalls) {
    for (const mealType of ['BREAKFAST', 'LUNCH', 'DINNER'] as const) {
      const menuKey = { stallId: stall.id, date, mealType };
      const menu = await prisma.menu.upsert({
        where: { stallId_date_mealType: menuKey },
        create: { ...menuKey, status: 'PUBLISHED', publishedAt: new Date() },
        update: {},
      });
      const dishes = stall.dishes.slice(0, mealType === 'LUNCH' ? 5 : 3);
      for (const [sortOrder, dish] of dishes.entries()) {
        const itemKey = { menuId: menu.id, dishId: dish.id };
        await prisma.menuItem.upsert({
          where: { menuId_dishId: itemKey }, create: { ...itemKey, sortOrder }, update: {},
        });
        const inventoryKey = { dishId: dish.id, date, mealType };
        await prisma.inventory.upsert({
          where: { dishId_date_mealType: inventoryKey },
          create: { ...inventoryKey, total: 40, remaining: 8 + ((sortOrder * 7) % 30) },
          update: {},
        });
      }
      for (const [startTime, endTime] of SLOT_PLAN[mealType]) {
        const slotKey = { ...menuKey, startTime };
        await prisma.pickupSlot.upsert({
          where: { stallId_date_mealType_startTime: slotKey },
          create: { ...slotKey, endTime, capacity: 20, cutoffMinutes: 15 },
          update: {},
        });
      }
    }
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new DemoSeedError('生产环境禁止执行演示初始化。');
  const expectedDatabase = process.env.DEMO_DATABASE_NAME;
  const databaseUrl = process.env.DATABASE_URL;
  const demoPassword = process.env.DEMO_PASSWORD;
  if (!expectedDatabase || !/^shiguang_(?:demo|test)(?:_[a-z0-9]+)*$/.test(expectedDatabase) || !databaseUrl) {
    throw new DemoSeedError('显式设置 DATABASE_URL 和隔离库名 DEMO_DATABASE_NAME（shiguang_demo 或 shiguang_test，可加后缀）。');
  }
  if (!demoPassword || demoPassword.length < 8 || demoPassword.startsWith('CHANGE_ME')) {
    throw new DemoSeedError('请设置至少 8 位的 DEMO_PASSWORD。');
  }
  try {
    const parsed = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
      || decodeURIComponent(parsed.pathname.slice(1)) !== expectedDatabase) {
      throw new Error();
    }
  } catch {
    throw new DemoSeedError('DATABASE_URL 的目标库与 DEMO_DATABASE_NAME 不一致。');
  }
  const date = demoDate();
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const [identity] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (identity?.name !== expectedDatabase) throw new DemoSeedError('连接的数据库与指定隔离库不一致。');
    const passwordHash = await argon2.hash(demoPassword, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(513087145)::text`;
      const fixture = await tx.systemAnnouncement.findUnique({ where: { id: FIXTURE_ID }, select: { id: true } });
      if (!fixture) await createDemoData(tx, date, passwordHash);
      await seedAvailability(tx, date);
    }, { timeout: 60_000, maxWait: 10_000 });
    console.log(`[seed] ${date.toISOString().slice(0, 10)} 演示数据已就绪。`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof DemoSeedError) console.error(`[seed] ${error.message}`);
  else if (error instanceof Prisma.PrismaClientKnownRequestError) console.error(`[seed] 初始化失败（${error.code}）。请检查隔离库迁移状态和夹具冲突。`);
  else console.error('[seed] 初始化失败。请检查隔离库连接和依赖构建。');
  process.exitCode = 1;
});
