// 预置「专辑」：首次进入工作台时自动为当前用户播种，保证每条声音都有去处，
// 界面上永远不会出现「未归类 / 不归类」这类字样。
// 语义上 topics 表即「专辑」：一张专辑 = 一个按兴趣划分的收藏合集。
export type PresetTopic = { name: string; color: string; icon: string };

export const PRESET_TOPICS: PresetTopic[] = [
  { name: "人间闲谈",   color: "#9a8bc4", icon: "☕" },
  { name: "远方与路",   color: "#6f8fa8", icon: "✈" },
  { name: "商业洞察",   color: "#b98a86", icon: "◈" },
  { name: "品牌出海",   color: "#c07f62", icon: "⚑" },
  { name: "消费观察",   color: "#c0a06a", icon: "◎" },
  { name: "字里行间",   color: "#a97b93", icon: "✎" },
  { name: "心事与人",   color: "#8aa387", icon: "☾" },
  { name: "科技与新知", color: "#6f94a8", icon: "✳" },
  { name: "声色与审美", color: "#b0873e", icon: "♪" },
  { name: "拾光杂记",   color: "#8d8b96", icon: "✦" }, // 兜底专辑，名字雅，不像「未归类」
];

export const FALLBACK_TOPIC = "拾光杂记";

// 词云只统计「读得懂的词」：从标题里匹配这些主题概念，不再做滑窗切字。
// 这样词云里不会出现「兰壮」「游者」这类无意义碎片。
export const MEANINGFUL_WORDS: string[] = [
  "商业洞察", "品牌出海", "消费趋势", "跨境电商", "全球市场", "海外合规", "本地化",
  "国际化", "供应链", "用户洞察", "内容营销", "增长", "创业", "投资", "财经",
  "旅行人文", "壮游", "芬兰", "北欧", "慢生活", "自我成长", "职场", "创作",
  "心理学", "人工智能", "科技", "播客", "访谈", "故事", "城市", "文化",
  "阅读", "审美", "音乐", "设计", "可持续", "品牌", "渠道", "出海",
];
