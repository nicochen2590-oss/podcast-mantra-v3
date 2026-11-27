/**
 * 词云页的「题眼」：按最高频词挑一句真名言。
 * 只放能确认出处、且和词组真的对得上的句子，宁少不编。
 */
export type WordQuote = { text: string; author: string };

const THEMES: { keys: string[]; quote: WordQuote }[] = [
  {
    keys: ["声音", "播客", "听", "耳朵", "电台"],
    quote: { text: "大音希声，大象无形。", author: "老子《道德经》" },
  },
  {
    keys: ["书", "读", "文字", "字里行间", "文学"],
    quote: { text: "好读书，不求甚解；每有会意，便欣然忘食。", author: "陶渊明" },
  },
  {
    keys: ["品牌", "商业", "营销", "增长", "创业", "公司", "生意"],
    quote: { text: "企业的目的只有一个：创造顾客。", author: "彼得·德鲁克" },
  },
  {
    keys: ["出海", "全球", "海外", "跨文化", "国际", "旅行", "远方", "城市"],
    quote: { text: "世界是一本书，不旅行的人只读了其中一页。", author: "圣奥古斯丁" },
  },
  {
    keys: ["成长", "人生", "意义", "自己", "选择"],
    quote: { text: "未经省察的人生不值得过。", author: "苏格拉底" },
  },
  {
    keys: ["时间", "记忆", "过去", "历史"],
    quote: { text: "时间是构成我的实体，是一条载我飞逝的河，但这条河就是我。", author: "博尔赫斯" },
  },
  {
    keys: ["孤独", "关系", "爱", "情感", "亲密"],
    quote: { text: "真正重要的东西，用眼睛是看不见的。", author: "圣埃克苏佩里《小王子》" },
  },
  {
    keys: ["科技", "技术", "AI", "未来", "新知", "互联网"],
    quote: { text: "想象力比知识更重要。", author: "爱因斯坦" },
  },
  {
    keys: ["消费", "产品", "用户", "设计", "体验"],
    quote: { text: "设计不只是外观和感觉，设计是它如何运作。", author: "史蒂夫·乔布斯" },
  },
  {
    keys: ["文化", "审美", "艺术", "美", "声色"],
    quote: { text: "美是理念的感性显现。", author: "黑格尔《美学》" },
  },
  {
    keys: ["心理", "情绪", "自我", "心事"],
    quote: { text: "向外看的人在做梦，向内看的人才是清醒的。", author: "荣格" },
  },
  {
    keys: ["生活", "日常", "美食", "烟火", "闲谈"],
    quote: { text: "四方食事，不过一碗人间烟火。", author: "汪曾祺" },
  },
];

const FALLBACK: WordQuote[] = [
  { text: "我心里一直都在暗暗设想，天堂应该是图书馆的模样。", author: "博尔赫斯" },
  { text: "经典是那些你经常听人说「我正在重读」而不是「我正在读」的书。", author: "卡尔维诺" },
  { text: "旧书不厌百回读，熟读深思子自知。", author: "苏轼" },
];

/**
 * 每日日签用的句子：按「一年中的第几天」取，同一天所有人看到同一句。
 * 只收流传广、出处能对上的句子；宁可少，不硬凑。
 */
export const DAILY_QUOTES: WordQuote[] = [
  { text: "大音希声，大象无形。", author: "老子《道德经》" },
  { text: "好读书，不求甚解；每有会意，便欣然忘食。", author: "陶渊明《五柳先生传》" },
  { text: "旧书不厌百回读，熟读深思子自知。", author: "苏轼" },
  { text: "纸上得来终觉浅，绝知此事要躬行。", author: "陆游" },
  { text: "问渠那得清如许？为有源头活水来。", author: "朱熹《观书有感》" },
  { text: "山重水复疑无路，柳暗花明又一村。", author: "陆游《游山西村》" },
  { text: "不畏浮云遮望眼，自缘身在最高层。", author: "王安石《登飞来峰》" },
  { text: "竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。", author: "苏轼《定风波》" },
  { text: "博观而约取，厚积而薄发。", author: "苏轼《稼说送张琥》" },
  { text: "君子藏器于身，待时而动。", author: "《周易·系辞下》" },
  { text: "知者不惑，仁者不忧，勇者不惧。", author: "《论语·子罕》" },
  { text: "三人行，必有我师焉。", author: "《论语·述而》" },
  { text: "学而不思则罔，思而不学则殆。", author: "《论语·为政》" },
  { text: "上善若水，水善利万物而不争。", author: "老子《道德经》" },
  { text: "千里之行，始于足下。", author: "老子《道德经》" },
  { text: "知人者智，自知者明。", author: "老子《道德经》" },
  { text: "吾生也有涯，而知也无涯。", author: "庄子《养生主》" },
  { text: "博学之，审问之，慎思之，明辨之，笃行之。", author: "《礼记·中庸》" },
  { text: "知行合一。", author: "王阳明" },
  { text: "读史使人明智，读诗使人灵秀。", author: "培根《论读书》" },
  { text: "未经省察的人生不值得过。", author: "苏格拉底" },
  { text: "人是一根会思想的芦苇。", author: "帕斯卡《思想录》" },
  { text: "我思故我在。", author: "笛卡尔" },
  { text: "人是万物的尺度。", author: "普罗泰戈拉" },
  { text: "世界是一本书，不旅行的人只读了其中一页。", author: "圣奥古斯丁" },
  { text: "我心里一直都在暗暗设想，天堂应该是图书馆的模样。", author: "博尔赫斯《关于天赐的诗》" },
  { text: "经典是那些你经常听人说「我正在重读」而不是「我正在读」的书。", author: "卡尔维诺《为什么读经典》" },
  { text: "时间是构成我的实体，是一条载我飞逝的河，但这条河就是我。", author: "博尔赫斯" },
  { text: "想象力比知识更重要。", author: "爱因斯坦" },
  { text: "一个人知道自己为什么而活，就可以忍受任何一种生活。", author: "尼采" },
  { text: "那些杀不死我的，使我更强大。", author: "尼采《偶像的黄昏》" },
  { text: "真正重要的东西，用眼睛是看不见的。", author: "圣埃克苏佩里《小王子》" },
  { text: "使沙漠美丽的，是它在某处藏着一口井。", author: "圣埃克苏佩里《小王子》" },
  { text: "世界上最宽广的是海洋，比海洋更宽广的是天空，比天空更宽广的是人的心灵。", author: "雨果《悲惨世界》" },
  { text: "世界上只有一种真正的英雄主义，就是认清了生活的真相后还依然热爱它。", author: "罗曼·罗兰《米开朗基罗传》" },
  { text: "我步入丛林，因为我希望生活得有意义。", author: "梭罗《瓦尔登湖》" },
  { text: "我辽阔博大，我包罗万象。", author: "惠特曼《自我之歌》" },
  { text: "我们不应停止探索，而一切探索的终点，将是抵达最初的起点，并第一次认识那个地方。", author: "艾略特《四个四重奏》" },
  { text: "一本书必须是一把斧头，劈开我们心中冰封的海洋。", author: "卡夫卡" },
  { text: "在隆冬，我终于知道，我身上有一个不可战胜的夏天。", author: "加缪《回归蒂巴萨》" },
  { text: "人不能两次踏进同一条河流。", author: "赫拉克利特" },
  { text: "你所拥有的只有当下这一刻。", author: "马可·奥勒留《沉思录》" },
  { text: "我们并非时间太少，而是浪费太多。", author: "塞内加《论生命之短暂》" },
  { text: "使人不安的不是事物本身，而是人对事物的看法。", author: "爱比克泰德《手册》" },
  { text: "天空没有留下鸟的痕迹，但我已飞过。", author: "泰戈尔《飞鸟集》" },
  { text: "世界以痛吻我，要我报之以歌。", author: "泰戈尔《飞鸟集》" },
  { text: "无穷的远方，无数的人们，都和我有关。", author: "鲁迅《且介亭杂文末编》" },
  { text: "我行过许多地方的桥，看过许多次数的云。", author: "沈从文《湘行散记》" },
  { text: "黑夜给了我黑色的眼睛，我却用它寻找光明。", author: "顾城《一代人》" },
  { text: "四方食事，不过一碗人间烟火。", author: "汪曾祺" },
  { text: "从前的日色变得慢，车、马、邮件都慢。", author: "木心《从前慢》" },
  { text: "美是理念的感性显现。", author: "黑格尔《美学》" },
  { text: "设计不只是外观和感觉，设计是它如何运作。", author: "史蒂夫·乔布斯" },
  { text: "企业的目的只有一个：创造顾客。", author: "彼得·德鲁克《管理的实践》" },
];

/** 按日期取当天那句：同一天稳定，跨天自动换。 */
export function dailyQuote(date: Date): WordQuote {
  // 用 UTC 零点算「一年中的第几天」，避免夏令时把天数算偏
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const day = Math.floor((today - start) / 86400000);
  return DAILY_QUOTES[((day % DAILY_QUOTES.length) + DAILY_QUOTES.length) % DAILY_QUOTES.length];
}

/** 命中主题就用主题句；没命中时按词做稳定兜底（同一词每次刷新都是同一句）。 */
export function quoteForWord(word: string | undefined | null): WordQuote | null {
  if (!word) return null;
  const hit = THEMES.find((t) =>
    t.keys.some((k) => word.includes(k) || k.includes(word))
  );
  if (hit) return hit.quote;
  let h = 0;
  for (const ch of word) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 9973;
  return FALLBACK[h % FALLBACK.length];
}
