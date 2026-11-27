"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Headphones, Search, Plus, Link2, LayoutGrid, List, ChevronDown,
  FolderOpen, Sparkles, Clock, CheckCircle2, Loader2,
  Library, Inbox, Compass, MessageCircle, Settings, ArrowRight, X, FileText,
  CheckSquare, Trash2, FolderInput, Check, Home, Network, Download, ListChecks, Upload,
  Cloud, Pencil, Feather, Disc3, BookHeart, CalendarDays,
  ChevronsLeft, ChevronsRight, Orbit, HardDrive, Feather as FeatherIcon,
  Pin, PinOff, Layers,
} from "lucide-react";
import { OrnamentLayer } from "./ornament-layer";
import { AddContentModal } from "./add-content-modal";
import { EpisodeQuickEdit, type EpisodeMeta } from "./episode-quick-edit";
import { WordCloud } from "./word-cloud";
import { AlbumWall } from "./album-wall";
import { AlbumDetail } from "./album-detail";
import { HomePage } from "./home-page";
import { DailyPage } from "./daily-page";
import { SearchPage } from "./search-page";
import { FontSwitcher } from "./font-switcher";
import ALBUM_MAP from "@/data/album-mapping.json";
import { cloudLibrary, cloudTranscriptIds } from "@/lib/cloud";
import BUNDLED_TRANSCRIPTS from "@/data/bundled-transcripts.json";
import { mergeDuplicateTopics, normalizeAlbums, canonicalTopic, rebuildCanonicalAlbums, renameTopicById, CANONICAL_TOPICS } from "@/lib/guest/store";
import { useSearchParams } from "next/navigation";
import { LibraryStage } from "./library-stage";
import { ShowCover } from "./show-cover";
import { FlowerRatingReadonly, FLOWER_WORDS } from "./flower-rating";
import { GUEST_LIBRARY_EMPTY, GUEST_SEGMENTS, GUEST_CARD, displayCover } from "@/lib/guest/data";
import {
  loadGuestLibrary, addGuestEpisode, addGuestTopic, updateGuestEpisode, removeGuestEpisode,
  loadTranscriptMap, loadHiddenEpisodes, hideEpisodes,
  loadHiddenTopics, hideTopic, type GuestLibrary,
} from "@/lib/guest/store";
import type { Episode, Topic } from "./types";

const PLATFORM_LABEL: Record<string, string> = {
  xiaoyuzhou: "小宇宙", bilibili: "B站", douyin: "抖音",
  xiaohongshu: "小红书", other: "链接",
};

const FALLBACK_TOPIC: Topic = { id: "__fallback__", name: "拾光杂记", color: "#8d8b96" };
const STORE_KEY = "pm_episode_meta";

function fmtDuration(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h > 0 ? `${h}小时${m % 60}分` : `${m}分钟`;
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

type NavKey =
  | "library" | "albums" | "months" | "cloud" | "later"
  | "graph" | "backup" | "search" | "home" | "daily";
type ViewKey = "orbit" | "grid" | "list";

export function DashboardClient({
  episodes: initialEpisodes, topics: initialTopics,
}: {
  episodes: Episode[];
  topics: Topic[];
}) {
  const [nav, setNav] = useState<NavKey>("home");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewKey>("orbit");
  // 手机上环绕书廊太挤，默认直接给网格；想看环绕随时点右下角切回去。
  // 也支持 /dashboard?view=grid|list 直接落到某个视图（方便分享与截图）。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const want = params.get("view");
    const albumId = params.get("album");
    if (albumId) {
      const t = [...initialTopics, ...loadGuestLibrary().topics].find((x) => x.id === albumId);
      if (t) { setOpenAlbum(t); setNav("albums"); setActiveLabel("主题专辑"); }
    }
    if (want === "library") {
      setNav("library");
      setActiveLabel("内容典藏");
      setView("orbit");
      return;
    }
    if (want === "grid" || want === "list") { setView(want); return; }
    if (window.matchMedia("(max-width: 720px)").matches) setView("grid");
  }, []);
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "pending">("all");
  const [sortBy, setSortBy] = useState<"added" | "title">("added");
  const [addOpen, setAddOpen] = useState(false);
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const [editEp, setEditEp] = useState<Episode | null>(null);
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [activeLabel, setActiveLabel] = useState("首页");
  const [paper, setPaper] = useState<"none" | "cover" | "out">("none");
  const searchParams = useSearchParams();
  const albumQ = searchParams.get("album");
  const viewQ = searchParams.get("view");

  // 同页面切换 ?album= / ?view= 时，上面的初始化 effect 不会重跑，这里补一次监听
  useEffect(() => {
    if (albumQ) {
      const t = [...initialTopics, ...loadGuestLibrary().topics].find((x) => x.id === albumQ);
      if (t) { setOpenAlbum(t); setNav("albums"); setActiveLabel("主题专辑"); }
      return;
    }
    if (viewQ === "library") { setNav("library"); setActiveLabel("内容典藏"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumQ, viewQ]);
  const [mobileNav, setMobileNav] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("pm_pinned_v1") || "[]") as string[];
      setPinned(new Set(raw));
    } catch { /* 忽略 */ }
  }, []);

  function renameAlbum(t: { id: string; name: string }) {
    const next = window.prompt("给这张专辑改个名字（建议四个字）：", t.name);
    if (!next || next.trim() === t.name) return;
    if (!renameTopicById(t.id, next)) { window.alert("这个名字已经被别的专辑用了。"); return; }
    window.location.reload();
  }

  function rebuildAlbums() {
    if (!window.confirm("重建 10 个标准专辑？\n\n会清空专辑的删除记录，并把每期重新挂到对应的标准分类下。\n逐字稿、文章、精华都不会受影响。")) return;
    const r = rebuildCanonicalAlbums();
    window.alert(`已重建 ${r.created} 个专辑，调整了 ${r.moved} 期。`);
    window.location.reload();
  }

  function unifyAlbums() {
    if (!window.confirm("把所有专辑统一成 10 个标准分类？\n\n同名、近义的会合并，每期会重新挂到标准分类下，逐字稿/文章/精华都不受影响。")) return;
    const r = normalizeAlbums();
    window.alert(`已统一：${r.before} 个专辑 → ${r.after} 个标准分类，调整了 ${r.moved} 期。`);
    window.location.reload();
  }

  function mergeAlbums() {
    const { merged, moved } = mergeDuplicateTopics();
    if (!merged) { window.alert("没有同名专辑需要合并。"); return; }
    window.alert(`已合并 ${merged} 张同名专辑，移动了 ${moved} 期。刷新后生效。`);
    window.location.reload();
  }

  /** 指定节目的强制归类：标题命中就挪到对应专辑（不存在则新建） */
  const SHOW_RULES: { match: string; album: string }[] = [
    { match: "小Lin说财经", album: "商业" },
    { match: "鼠一鼠二", album: "社会观察" },
    { match: "科技早知道", album: "人工智能" },
  ];

  function applyShowRules(): number {
    let moved = 0;
    for (const ep of episodes) {
      const rule = SHOW_RULES.find((r) => ep.title.includes(r.match));
      if (!rule) continue;
      let topic = topics.find((t) => t.name === rule.album);
      if (!topic) {
        const t: Topic = { id: `local-${rule.album}-${Math.random().toString(36).slice(2, 6)}`, name: rule.album, color: null };
        addGuestTopic(t);
        topic = t;
      }
      if (ep.topic_id !== topic.id) { moveEpisode(ep.id, topic.id); moved += 1; }
    }
    return moved;
  }

  function autoClassify() {
    const forced = applyShowRules();
    if (forced) window.alert(`已按节目规则调整 ${forced} 期，接下来处理其余未归类的期…`);
    const fallbackNames = new Set(["待归类", "拾光杂记", "未分类"]);
    const targets = episodes.filter((e) => {
      const t = topics.find((x) => x.id === e.topic_id);
      return !t || fallbackNames.has(t.name);
    });
    if (!targets.length) { window.alert("没有需要归类的期。"); return; }

    let moved = 0;
    const created: string[] = [];
    for (const ep of targets) {
      const hay = `${ep.title} ${ep.summary ?? ""}`;
      let best = { score: 0, album: "" };
      for (const rule of CLASSIFY_RULES) {
        const sc = rule.words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
        if (sc > best.score) best = { score: sc, album: rule.album };
      }
      const albumName = best.score >= 1 ? best.album : "未分类";
      let topic = topics.find((t) => t.name === albumName);
      if (!topic) {
        const id = `local-${Date.now().toString(36)}-${moved}`;
        const t: Topic = { id, name: albumName, color: null };
        addGuestTopic(t);
        created.push(albumName);
        topic = t;
      }
      moveEpisode(ep.id, topic.id);
      moved += 1;
    }
    window.alert(`已归类 ${moved} 期${created.length ? `，新建专辑：${created.join("、")}` : ""}。`);
  }

  function togglePinSelected() {
    if (!selected.size) return;
    setPinned((prev) => {
      const next = new Set(prev);
      const allPinned = [...selected].every((id) => next.has(id));
      selected.forEach((id) => (allPinned ? next.delete(id) : next.add(id)));
      try { localStorage.setItem("pm_pinned_v1", JSON.stringify([...next])); } catch { /* 忽略 */ }
      return next;
    });
  }
  const [openAlbum, setOpenAlbum] = useState<Topic | null>(null);
  const [guestLib, setGuestLib] = useState<GuestLibrary>({ episodes: [], topics: [] });

  // 内容库管理：多选 → 删除 / 移到别的专辑
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenEps, setHiddenEps] = useState<string[]>([]);
  const [hiddenTopics, setHiddenTopics] = useState<string[]>([]);
  const [cloudEpisodes, setCloudEpisodes] = useState<typeof initialEpisodes>([]);
  const [cloudTxIds, setCloudTxIds] = useState<string[]>([]);

  // 上线后所有人读云端清单；本机数据优先（本机有编辑过的元数据）
  useEffect(() => {
    let alive = true;
    cloudLibrary()
      .then((list) => { if (alive && list.length) setCloudEpisodes(list as never); })
      .catch(() => { /* 离线时只用本机数据 */ });
    cloudTranscriptIds()
      .then((ids) => { if (alive && ids.length) setCloudTxIds(ids); })
      .catch(() => { /* 忽略 */ });
    return () => { alive = false; };
  }, []);

  // 从开屏进来时，先铺一张同色的纸，等首页渲染好再向上揭开
  useEffect(() => {
    let flag = false;
    try { flag = sessionStorage.getItem("pm_paper_in") === "1"; } catch { /* 忽略 */ }
    if (!flag) return;
    setPaper("cover");
    // 注意：不清 cleanup、也不立刻删标记——React StrictMode 会跑两遍 effect，
    // 清掉定时器会让"纸"永远盖着页面。
    window.setTimeout(() => setPaper("out"), 90);
    window.setTimeout(() => setPaper("none"), 1050);
    window.setTimeout(() => { try { sessionStorage.removeItem("pm_paper_in"); } catch { /* 忽略 */ } }, 1200);
  }, []);

  // 侧栏折叠：记住上次选择
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("pm_sidebar_collapsed") === "1"); } catch { /* 忽略 */ }
  }, []);
  function toggleSide() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("pm_sidebar_collapsed", next ? "1" : "0"); } catch { /* 忽略 */ }
      return next;
    });
  }

  // 本机草稿：自己粘进来的期、自己建的专辑
  useEffect(() => {
    setGuestLib(loadGuestLibrary());
    setHiddenEps(loadHiddenEpisodes());
    setHiddenTopics(loadHiddenTopics());
  }, []);
  function refreshGuestLib() { setGuestLib(loadGuestLibrary()); }

  // 云端还没跑补丁时，评分 / 余音 / 专辑先存在浏览器里；这里合并进列表，
  // 保证「保存后立刻能在卡片、手账、词云上看到」。
  const [localMeta, setLocalMeta] = useState<Record<string, EpisodeMeta>>({});
  useEffect(() => {
    try { setLocalMeta(JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch { /* 忽略 */ }
  }, []);

  const baseEpisodes = useMemo(() => {
    const hidden = new Set(hiddenEps);
    const local = [...guestLib.episodes, ...initialEpisodes];
    const seenId = new Set(local.map((e) => e.id));
    const urlKey = (u: string | null | undefined) => (u ?? "").trim().split("?")[0];
    const seenUrl = new Set(local.map((e) => urlKey(e.source_url)).filter(Boolean));
    // 云端同一期可能换了 id（旧导出/新导出），按链接再去一次重
    const fromCloud = cloudEpisodes.filter((e) => {
      if (seenId.has(e.id)) return false;
      const u = urlKey(e.source_url);
      if (u && seenUrl.has(u)) return false;
      return true;
    });
    const mappedIds = new Set(Object.keys((ALBUM_MAP as { episodes: Record<string, string> }).episodes));
    return [...local, ...fromCloud]
      .filter((e) => !hidden.has(e.id))
      // 只展示这次分类重构的 410 期，避免和公共索引里的旧节目混在一起
      .filter((e) => mappedIds.size === 0 || mappedIds.has(e.id));
  }, [guestLib.episodes, initialEpisodes, hiddenEps, cloudEpisodes]);
  const topics = useMemo(() => {
    const hidden = new Set(hiddenTopics);
    const all = [...initialTopics, ...guestLib.topics].filter((t) => !hidden.has(t.id));
    // 主题专辑墙只呈现 10 个标准一级分类：近义专辑收敛到同一张
    const byCanon = new Map<string, typeof all[number]>();
    for (const t of all) {
      const canon = canonicalTopic(t.name);
      if (!byCanon.has(canon)) byCanon.set(canon, { ...t, name: canon });
    }
    return [...byCanon.values()];
  }, [initialTopics, guestLib.topics, hiddenTopics]);

  // 专辑被删光时自动补齐 10 个标准分类（保证专辑墙 / 内容典藏 / 首页胶囊一致）
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    const names = new Set(topics.map((t) => t.name));
    const missing = CANONICAL_TOPICS.filter((n) => !names.has(n));
    if (!missing.length) return;
    restoredRef.current = true;
    normalizeAlbums();
    refreshGuestLib();
  }, [topics, refreshGuestLib]);

  // 每期的 topic_id 也重挂到标准分类上，专辑墙的计数才对得上
  const canonicalIdOf = useMemo(() => {
    const byCanon = new Map<string, string>();
    for (const t of topics) if (!byCanon.has(t.name)) byCanon.set(t.name, t.id);
    return byCanon;
  }, [topics]);
  const allTopicsByOldId = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of [...initialTopics, ...guestLib.topics]) {
      const canon = canonicalTopic(t.name);
      const cid = canonicalIdOf.get(canon);
      if (cid) m.set(t.id, cid);
    }
    return m;
  }, [initialTopics, guestLib.topics, canonicalIdOf]);

  const albumIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of topics) if (!m.has(t.name)) m.set(t.name, t.id);
    return m;
  }, [topics]);

  const episodes = useMemo(
    () => baseEpisodes.map((e) => {
      // 410 期分类建议表优先：按 episode_id 直接指定专辑
      const themeName = (e as unknown as { theme?: string }).theme;
      const themeId = themeName ? albumIdByName.get(themeName) : undefined;
      if (themeId) return { ...e, ...(localMeta[e.id] ?? {}), topic_id: themeId };
      const mappedAlbum = (ALBUM_MAP.episodes as Record<string, string>)[e.id];
      const mappedId = mappedAlbum ? albumIdByName.get(mappedAlbum) : undefined;
      if (mappedId) return { ...e, ...(localMeta[e.id] ?? {}), topic_id: mappedId };
      const remapped = allTopicsByOldId.get(String(e.topic_id ?? ""));
      return { ...e, ...(localMeta[e.id] ?? {}), ...(remapped ? { topic_id: remapped } : {}) };
    }),
    [baseEpisodes, localMeta, allTopicsByOldId, albumIdByName]
  );

  // 回到这一页 / 别的标签页存了稿时，重新算一遍卡片的「有没有稿」
  const [txNonce, setTxNonce] = useState(0);
  useEffect(() => {
    const bump = () => setTxNonce((n) => n + 1);
    window.addEventListener("focus", bump);
    window.addEventListener("storage", bump);
    document.addEventListener("visibilitychange", bump);
    return () => {
      window.removeEventListener("focus", bump);
      window.removeEventListener("storage", bump);
      document.removeEventListener("visibilitychange", bump);
    };
  }, []);

  // 哪些期已经有稿：内置示例 + 自己贴过的
  const transcriptIds = useMemo(() => {
    const set = new Set<string>(Object.keys(GUEST_SEGMENTS));
    Object.keys(loadTranscriptMap()).forEach((id) => set.add(id));
    guestLib.episodes.forEach((e) => { if (e.transcript_status === "ready") set.add(e.id); });
    Object.keys(BUNDLED_TRANSCRIPTS).forEach((id) => set.add(id));
    cloudTxIds.forEach((id) => set.add(id));
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestLib, localMeta, txNonce, cloudTxIds]);

  const topicMap = useMemo(() => Object.fromEntries(topics.map((t) => [t.id, t])), [topics]);
  const markedCount = useMemo(() => episodes.filter((e) => (e.rating && e.rating > 0) || e.note?.trim()).length, [episodes]);
  const latestMarked = useMemo(() => {
    const list = episodes
      .filter((e) => (e.rating && e.rating > 0) || e.note?.trim())
      .sort((a, b) => new Date(b.added_at || b.created_at).getTime() - new Date(a.added_at || a.created_at).getTime());
    return list[0] ?? null;
  }, [episodes]);

  // 全局搜索：云端接口 + 本地兜底。输入时自动回到内容库并清掉专辑筛选。
  useEffect(() => {
    if (!query.trim()) { setSearchIds(null); setSearching(false); return; }
    setNav("library");
    setTopicFilter("all");
    setSearching(true);
    const timer = setTimeout(() => {
      const q = query.trim().toLowerCase();
      const ids = new Set<string>();
      episodes.forEach((e) => {
        const hay = `${e.title} ${e.author ?? ""} ${e.note ?? ""} ${e.summary ?? ""} ${topicMap[e.topic_id ?? ""]?.name ?? ""}`.toLowerCase();
        if (hay.includes(q)) ids.add(e.id);
      });
      setSearchIds(ids);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, episodes, topicMap]);

  const filtered = useMemo(() => {
    let list = episodes;
    if (topicFilter !== "all") list = list.filter((e) => e.topic_id === topicFilter);
    if (searchIds) list = list.filter((e) => searchIds.has(e.id));
    if (statusFilter === "ready") list = list.filter((e) => transcriptIds.has(e.id));
    if (statusFilter === "pending") list = list.filter((e) => !transcriptIds.has(e.id));
    if (sortBy === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title, "zh"));
    // 排序：置顶最前 → 已转写成文的次之 → 其余保持原顺序
    list = [...list].sort((a, b) => {
      const pin = Number(pinned.has(b.id)) - Number(pinned.has(a.id));
      if (pin !== 0) return pin;
      return Number(transcriptIds.has(b.id)) - Number(transcriptIds.has(a.id));
    });
    // 置顶 / 已成文的保持在前，其余"打散"：同一个节目的单集不再扎堆
    const head = list.filter((e) => pinned.has(e.id) || transcriptIds.has(e.id));
    const tail = list.filter((e) => !pinned.has(e.id) && !transcriptIds.has(e.id));

    const buckets = new Map<string, typeof tail>();
    for (const e of tail) {
      const key = String((e as unknown as { show?: string }).show ?? e.author ?? "其他");
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(e);
    }
    const spread: typeof tail = [];
    const queues = [...buckets.values()];
    let idx = 0;
    while (spread.length < tail.length) {
      let added = false;
      for (const q of queues) {
        if (idx < q.length) { spread.push(q[idx]); added = true; }
      }
      idx += 1;
      if (!added) break;
    }
    return [...head, ...spread];
  }, [episodes, topicFilter, searchIds, statusFilter, transcriptIds, sortBy, pinned]);

  const readyCount = episodes.filter((e) => transcriptIds.has(e.id)).length;
  const monthCount = useMemo(
    () => new Set(episodes.map((e) => {
      const d = new Date(e.added_at || e.created_at);
      return `${d.getFullYear()}.${d.getMonth() + 1}`;
    })).size,
    [episodes]
  );

  // 把某一期搬到别的专辑：只改本机（公开索引的期靠 pm_episode_meta 叠加）
  function moveEpisode(id: string, topicId: string) {
    const ep = episodes.find((e) => e.id === id);
    if (!ep) return;
    setLocalMeta((prev) => ({ ...prev, [id]: { rating: ep.rating ?? 0, note: ep.note ?? "", topic_id: topicId } }));
    if (id.startsWith("guest-local-")) updateGuestEpisode(id, { topic_id: topicId });
  }

  function toggleManage() {
    setManaging((v) => {
      if (v) setSelected(new Set());
      return !v;
    });
  }
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const selectedArr = useMemo(() => [...selected], [selected]);

  function deleteSelected() {
    if (!selectedArr.length) return;
    if (!window.confirm(`把这 ${selectedArr.length} 期从你的书斋里隐藏？

只影响这台设备，公共索引不受影响，随时可以再收回来。`)) return;
    const localIds = selectedArr.filter((id) => id.startsWith("guest-local-"));
    localIds.forEach((id) => removeGuestEpisode(id));
    // 本地期也要进隐藏名单：云端有同一 id，不记隐藏的话下次拉取又会被加回来
    hideEpisodes(selectedArr);
    setHiddenEps(loadHiddenEpisodes());
    setGuestLib(loadGuestLibrary());
    setSelected(new Set());
    setManaging(false);
  }

  function moveSelectedTo(topicId: string) {
    if (!selectedArr.length || !topicId) return;
    setLocalMeta((prev) => {
      const next = { ...prev };
      selectedArr.forEach((id) => {
        const ep = episodes.find((e) => e.id === id);
        next[id] = { rating: ep?.rating ?? 0, note: ep?.note ?? "", topic_id: topicId };
      });
      return next;
    });
    selectedArr.filter((id) => id.startsWith("guest-local-")).forEach((id) => updateGuestEpisode(id, { topic_id: topicId }));
    setSelected(new Set());
    setManaging(false);
  }

  /** 删专辑：先把里面的期挪到「拾光杂记」，再把这张专辑从书斋里拿掉 */
  function deleteAlbum(t: Topic) {
    const fallback =
      topics.find((x) => x.id !== t.id && x.name === "拾光杂记") ??
      topics.find((x) => x.id !== t.id) ?? null;
    const ids = episodes.filter((e) => e.topic_id === t.id).map((e) => e.id);
    if (ids.length && !fallback) {
      window.alert("至少要留一张专辑收内容。先新建一张，再删这张。");
      return;
    }
    const tip = ids.length
      ? `删掉「${t.name}」？里面的 ${ids.length} 期会移到「${fallback!.name}」。`
      : `删掉「${t.name}」？这一张还空着。`;
    if (!window.confirm(tip)) return;

    if (fallback && ids.length) {
      setLocalMeta((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          const ep = episodes.find((e) => e.id === id);
          next[id] = { rating: ep?.rating ?? 0, note: ep?.note ?? "", topic_id: fallback.id };
        });
        return next;
      });
      ids.filter((id) => id.startsWith("guest-local-")).forEach((id) => updateGuestEpisode(id, { topic_id: fallback.id }));
    }
    if (topicFilter === t.id) setTopicFilter("all");
    hideTopic(t.id);
    setHiddenTopics(loadHiddenTopics());
  }

  function openTopic(id: string) {
    setTopicFilter(id); setNav("library"); setTopicMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const pendingCount = episodes.filter((e) => !transcriptIds.has(e.id)).length;

  const navGroups: { title: string; items: { key: NavKey; label: string; icon: typeof Library; badge?: string }[] }[] = [
    {
      title: "DISCOVER",
      items: [
        { key: "home", label: "首页", icon: Home },
        { key: "daily", label: "每日一荐", icon: Sparkles },
      ],
    },
    {
      title: "SEARCH",
      items: [{ key: "search", label: "全局搜索", icon: Search }],
    },
    {
      title: "MY LIBRARY",
      items: [
        { key: "library", label: "内容典藏", icon: Library, badge: String(episodes.length) },

        { key: "albums", label: "主题专辑", icon: Disc3, badge: String(topics.length) },
      ],
    },
    {
      title: "KNOWLEDGE",
      items: [
        { key: "cloud", label: "词云洞察", icon: Cloud },
      ],
    },
    {
      title: "SYSTEM",
      items: [
        { key: "backup", label: "数据备份与导出", icon: Download },

      ],
    },
  ];

  return (
    <div className={`dash-root ${collapsed ? "side-collapsed" : ""} ${paper !== "none" ? "is-entering" : ""}`}>
      {paper !== "none" && <div className={`paper-reveal ${paper === "out" ? "out" : ""}`} />}
      <aside className={`dash-sidebar ${mobileNav ? "open" : ""}`}>
        <button
          className="dash-collapse"
          onClick={toggleSide}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
        <Link href="/dashboard" className="dash-logo" title="Podcast Mantra">
          <span className="dash-logo-mark"><Headphones size={19} color="#fff" strokeWidth={2} /></span>
          <span className="dash-logo-name">Podcast <b>Mantra</b></span>
        </Link>

        <button className="dash-add-btn" onClick={() => setAddOpen(true)} title="添加内容">
          <Plus size={18} /> <span className="dash-add-text">添加内容</span>
        </button>

        <nav className="dash-nav">
          {navGroups.map((g) => (
            <div className="dash-nav-group" key={g.title}>
              <div className="dash-nav-label">{g.title}</div>
              {g.items.map((item) => (
                <button
                  key={`${g.title}-${item.key}-${item.label}`}
                  className={`dash-nav-item ${activeLabel === item.label ? "active" : ""}`}
                  onClick={() => {
                    setActiveLabel(item.label);

                    setNav(item.key);
                  }}
                >
                  <item.icon size={17} strokeWidth={1.9} />
                  <span>{item.label}</span>
                  {item.badge && item.badge !== "0" && <em>{item.badge}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="dash-sidebar-foot">
          {latestMarked && (
            <button className="dash-side-note" onClick={() => setNav("library")} title="去内容典藏">
              <span className="dash-side-note-tape" />
              <span className="dash-side-note-label"><Feather size={11} /> 今日余音</span>
              <div className="dash-side-note-flowers"><FlowerRatingReadonly value={latestMarked.rating ?? 0} size={11} /></div>
              <p>{latestMarked.note?.trim() ? `「${latestMarked.note.trim()}」` : FLOWER_WORDS[latestMarked.rating ?? 0]}</p>
              <span className="dash-side-note-from">— {latestMarked.title}</span>
            </button>
          )}
          <div className="dash-user">
            <span className="dash-avatar"><HardDrive size={15} strokeWidth={1.8} /></span>
            <span className="dash-user-mail" title="内容保存在这台设备的浏览器里">本机书斋</span>
          </div>
        </div>
      </aside>

      <main className="dash-main">
        <OrnamentLayer />
        <header className="dash-topbar">
          <button className="dash-menu-btn" onClick={() => setMobileNav((v) => !v)} aria-label="菜单">☰</button>
          <div className="dash-search">
            <Search size={17} strokeWidth={1.9} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value && nav !== "library" && nav !== "search") {
                  setNav("search"); setActiveLabel("全局搜索");
                }
              }}
              onFocus={() => { if (nav === "home" || nav === "daily") { setNav("search"); setActiveLabel("全局搜索"); } }}
              placeholder="搜标题、节目、简介、余音…"
              aria-label="搜索"
            />
            {searching && <Loader2 size={14} className="spin" />}
            {query && !searching && <button className="dash-search-clear" onClick={() => setQuery("")}><X size={14} /></button>}
          </div>
          <div className="dash-topbar-right">
          </div>
        </header>

        <div className={`dash-body ${nav === "library" && view === "orbit" ? "dash-body--stage" : ""}`}>
          {nav === "home" && (
            <HomePage
              episodes={episodes}
              topics={topics}
              doneCount={readyCount}
              onOpenDaily={() => { setNav("daily"); setActiveLabel("每日一荐"); window.scrollTo({ top: 0 }); }}
              onOpenLibrary={() => { setNav("library"); setActiveLabel("内容典藏"); }}
              onOpenGraph={() => { setNav("graph"); setActiveLabel("知识图谱"); }}
            />
          )}

          {nav === "daily" && (
            <DailyPage onEnterLibrary={() => { setNav("library"); setActiveLabel("内容典藏"); }} />
          )}

          {nav === "search" && (
            <SearchPage
              episodes={episodes}
              topics={topics}
              transcriptIds={transcriptIds}
              onOpenEpisode={(id) => { window.location.assign(`/episode/${id}`); }}
            />
          )}

          {nav === "library" && view === "orbit" && (
            <LibraryStage
              episodes={filtered}
              topics={topics}
              emptyLibrary={GUEST_LIBRARY_EMPTY}
              topicFilter={topicFilter}
              onTopicFilter={setTopicFilter}
              onAdd={() => setAddOpen(true)}
              onExit={setView}
              query={query}
              searching={searching}
            />
          )}

          {nav === "library" && view !== "orbit" && (
            <>
              <div className="lib-head">
                <div className="lib-head-copy">
                  <div className="dash-eyebrow"><Library size={13} /> 内容典藏</div>
                  <h1 className="brush-title">你的书斋，{episodes.length} 期。</h1>
                </div>
                <div className="lib-stats">
                  <div><span>{episodes.length}</span><em>收藏总量</em></div>
                  <div><span>{readyCount}</span><em>已处理</em></div>
                  <div><span>{episodes.length - readyCount}</span><em>待处理</em></div>
                </div>
              </div>

              <div className="dash-hero">
                <div className="dash-hero-copy">
                  <div className="dash-eyebrow"><Sparkles size={13} /> 声音书斋</div>
                  <h1 className="brush-title">
                    <RevealText text="听过的，" start={60} />
                    <em><RevealText text="慢慢落成" start={300} /></em>
                    <RevealText text="自己的。" start={540} />
                  </h1>
                  <p className="hero-fade">收了 <strong>{episodes.length}</strong> 期声音{readyCount > 0 && <> · <strong>{readyCount}</strong> 期落成文字</>}。哪一句忽然想起，回头去翻，它还在。</p>
                </div>
                <button className="dash-hero-add" onClick={() => setAddOpen(true)}><Link2 size={17} /> 粘一条链接</button>
              </div>

              <div className="dash-toolbar">
                <div className="dash-filter">
                  <button className={`dash-chip ${topicFilter === "all" ? "active" : ""}`} onClick={() => setTopicFilter("all")}>全部</button>
                  {topics.map((t) => (
                    <button key={t.id} className={`dash-chip ${topicFilter === t.id ? "active" : ""}`} onClick={() => setTopicFilter(t.id)}>
                      <i style={{ background: t.color || "#7d6bab" }} />{t.name}
                    </button>
                  ))}
                  <div className="dash-topic-more">
                    <button className="dash-chip ghost" onClick={() => setTopicMenuOpen((v) => !v)}><ChevronDown size={13} /> 专辑</button>
                    {topicMenuOpen && (
                      <div className="dash-menu">
                        <div className="dash-menu-title">翻开一张专辑</div>
                        <button onClick={() => { setTopicFilter("all"); setTopicMenuOpen(false); }}>全部内容</button>
                        {topics.map((t) => <button key={t.id} onClick={() => { setTopicFilter(t.id); setTopicMenuOpen(false); }}><i style={{ background: t.color || "#7d6bab" }} />{t.name}</button>)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="dash-view-toggle">
                  <div className="lib-seg" role="tablist" aria-label="按成文状态筛选">
                    {([
                      ["all", "全部"],
                      ["ready", "已成文"],
                      ["pending", "暂未开放"],
                    ] as const).map(([key, label]) => (
                      <button
                        key={key}
                        role="tab"
                        aria-selected={statusFilter === key}
                        className={statusFilter === key ? "on" : ""}
                        onClick={() => setStatusFilter(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <select className="lib-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="排序">
                    <option value="added">按收录时间</option>
                    <option value="title">按标题</option>
                  </select>
                  <button className={`orbit-back ${managing ? "active" : ""}`} onClick={toggleManage} title="管理内容库">
                    <CheckSquare size={14} /> <span>{managing ? "完成" : "管理"}</span>
                  </button>
                  <button className="orbit-back" onClick={() => setView("orbit")} title="回到环绕舞台"><Orbit size={14} /> <span>环绕舞台</span></button>
                  <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="网格视图"><LayoutGrid size={16} /></button>
                  <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="列表视图"><List size={16} /></button>
                </div>
              </div>

              {query && <div className="dash-search-info">{searching ? "正在全库翻找…" : `找到 ${filtered.length} 条相符内容（标题 / 节目 / 简介 / 余音）`}</div>}

              {filtered.length === 0 ? (
                <EmptyState query={query} onAdd={() => setAddOpen(true)} />
              ) : (
                <div className={`dash-grid ${view}`}>
                  {filtered.map((ep, i) => (
                    <EpisodeCard
                      key={ep.id} ep={ep} topic={(ep.topic_id && topicMap[ep.topic_id]) || FALLBACK_TOPIC}
                      view={view} index={i} onEdit={() => setEditEp(ep)} hasTranscript={transcriptIds.has(ep.id)}
                      managing={managing} selected={selected.has(ep.id)} onToggle={() => toggleSelect(ep.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {nav === "albums" && (openAlbum ? (
            <AlbumDetail
              topic={openAlbum}
              topics={topics}
              episodes={episodes}
              onBack={() => setOpenAlbum(null)}
              onOpenTopic={(id) => { const t = topics.find((x) => x.id === id); if (t) setOpenAlbum(t); }}
              onOpenEpisode={(id) => { window.location.assign(`/episode/${id}`); }}
              onDelete={(t) => { deleteAlbum(t); setOpenAlbum(null); }}
            />
          ) : (
            <AlbumWall
              topics={topics}
              episodes={episodes}
              onOpenTopic={(id) => { const t = topics.find((x) => x.id === id); if (t) setOpenAlbum(t); }}
              onMove={moveEpisode}
              onCreate={(t) => { addGuestTopic(t); refreshGuestLib(); }}
              onDelete={deleteAlbum}
              onRename={renameAlbum}
            />
          ))}
          {nav === "cloud" && <WordCloud episodes={episodes} topics={topics} />}
          {nav === "graph" && <KnowledgeGraph episodes={episodes} topics={topics} transcriptIds={transcriptIds} />}
          {nav === "backup" && <BackupPanel />}
        </div>
      </main>

      {managing && (
        <div className="manage-bar">
          <span className="mb-count">已选 <strong>{selected.size}</strong> 期</span>
          <div className="mb-actions">
            <div className="mb-move">
              <FolderInput size={15} />
              <select
                value=""
                onChange={(e) => { if (e.target.value) moveSelectedTo(e.target.value); }}
                disabled={selected.size === 0}
                aria-label="移到专辑"
              >
                <option value="">移到专辑…</option>
                {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <button className="mb-pin" onClick={togglePinSelected} disabled={selected.size === 0}>
              {[...selected].every((id) => pinned.has(id)) ? <><PinOff size={15} /> 取消置顶</> : <><Pin size={15} /> 置顶</>}
            </button>
            <button className="mb-del" onClick={deleteSelected} disabled={selected.size === 0}>
              <Trash2 size={15} /> 删除
            </button>
            <button className="mb-cancel" onClick={() => { setSelected(new Set()); setManaging(false); }}>取消</button>
          </div>
          <div className="mb-drop">
            <span className="mb-drop-label">把卡片拖到专辑上即可移动：</span>
            {topics.map((t) => (
              <span
                key={t.id}
                className="mb-drop-chip"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
                onDragLeave={(e) => e.currentTarget.classList.remove("over")}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("over");
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) moveEpisode(id, t.id);
                }}
              >
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {addOpen && (
        <AddContentModal
          onClose={() => setAddOpen(false)}
          onAdded={() => setAddOpen(false)}
          topics={topics}
          onAddLocally={(ep) => { addGuestEpisode(ep); refreshGuestLib(); }}
        />
      )}
      {editEp && (
        <EpisodeQuickEdit
          episode={editEp}
          topics={topics}
          onClose={() => setEditEp(null)}
          onSaved={(meta) => {
            const id = editEp.id;
            setLocalMeta((prev) => ({ ...prev, [id]: meta }));
            if (id.startsWith("guest-local-")) updateGuestEpisode(id, { rating: meta.rating, note: meta.note, topic_id: meta.topic_id });
            setEditEp(null);
          }}
        />
      )}

      {mobileNav && <div className="dash-nav-mask" onClick={() => setMobileNav(false)} />}
      <FontSwitcher />
    </div>
  );
}

/** 把一句中文拆成单字，逐字从遮罩底下升起 */
function RevealText({ text, start = 0 }: { text: string; start?: number }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span className="reveal-mask" key={`${ch}-${i}`}>
          <span className="reveal-ch" style={{ animationDelay: `${start + i * 52}ms` }}>{ch}</span>
        </span>
      ))}
    </>
  );
}

function EpisodeCard({ ep, topic, view, index, onEdit, hasTranscript, managing = false, selected = false, onToggle }: {
  ep: Episode; topic: Topic; view: "grid" | "list"; index: number; onEdit: () => void; hasTranscript: boolean;
  managing?: boolean; selected?: boolean; onToggle?: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  function tilt(e: React.MouseEvent<HTMLElement>) {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    el.classList.add("tilting");
    el.style.setProperty("--rx", `${(-ny * 11).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(nx * 15).toFixed(2)}deg`);
  }
  function untilt() {
    const el = cardRef.current;
    if (!el) return;
    el.classList.remove("tilting");
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
  }

  const st = hasTranscript
    ? { label: "已成文", icon: CheckCircle2, cls: "ready" }
    : { label: "", icon: FileText, cls: "pending" };
  const StatusIcon = st.icon;
  const rating = ep.rating ?? 0;
  const card = GUEST_CARD[ep.id];

  return (
    <article
      ref={cardRef}
      onMouseMove={tilt}
      onMouseLeave={untilt}
      className={`ep-card sketch-card ${view} ${managing ? "managing" : ""} ${selected ? "selected" : ""}`}
      draggable={managing}
      onDragStart={(e) => { if (!managing) return; e.dataTransfer.setData("text/plain", ep.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={managing ? (e) => { e.preventDefault(); onToggle?.(); } : undefined}
      style={{ "--tilt": `${(index % 4 - 1.5) * 0.7}deg`, animationDelay: `${Math.min(index, 8) * 55}ms` } as React.CSSProperties}
    >
      <Link href={`/episode/${ep.id}`} className="ep-card-link" aria-label={`打开：${ep.title}`}>
        <div className="ep-cover">
          {displayCover(ep) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayCover(ep) as string} alt="" />
          ) : (
            <ShowCover data={{ coverUrl: null, seed: index, title: ep.title, show: card?.show ?? ep.author ?? "播客", no: ep.episode_no ?? "" }} />
          )}
          {managing && (
            <span className={`ep-check ${selected ? "on" : ""}`}>{selected && <Check size={13} strokeWidth={3} />}</span>
          )}
          <span className="ep-platform">{PLATFORM_LABEL[ep.platform] || ep.platform}</span>
          {ep.duration_sec && <span className="ep-duration"><Clock size={11} />{fmtDuration(ep.duration_sec)}</span>}
        </div>
      </Link>
      <div className="ep-info">
        <div className="ep-toprow">
          {hasTranscript && (
            <span className={`ep-status ${st.cls}`}><StatusIcon size={12} className={st.cls === "processing" ? "spin" : ""} />{st.label}</span>
          )}
          <span className="ep-date">{fmtDate(ep.added_at || ep.created_at)} 收</span>
        </div>
        <Link href={`/episode/${ep.id}`}><h3 title={ep.title}>{ep.title}</h3></Link>
        <div className="ep-meta">
          {(ep.author || card?.show) && <span>{card?.show ?? ep.author}</span>}
          <span className="ep-topic"><i style={{ background: topic.color || "#7d6bab" }} />{topic.name}</span>
        </div>
        {rating > 0 && (
          <div className="ep-rating-line"><FlowerRatingReadonly value={rating} size={13} /><span>{rating} 朵 · {FLOWER_WORDS[rating]}</span></div>
        )}
        {ep.note && (
          <p className="ep-note" title={ep.note}><Feather size={12} />{ep.note}</p>
        )}
        <button className="ep-edit" onClick={onEdit}><Pencil size={12} /> 留个记号</button>
      </div>
    </article>
  );
}

function EmptyState({ query, onAdd }: { query: string; onAdd: () => void }) {
  if (query) {
    return (
      <div className="dash-empty">
        <div className="dash-empty-art"><Search size={34} strokeWidth={1.4} /></div>
        <h2 className="brush-title small">没翻到「{query}」</h2>
        <p>换个词再找找，或者收一条新的进来。</p>
      </div>
    );
  }
  return (
    <div className="dash-empty">
      <div className="dash-empty-art">
        <div className="dash-empty-covers">
          {["/covers/psychology-20s.png", "/covers/zongheng-purple.png", "/covers/hidden-brain.png"].map((c, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={c} src={c} alt="" style={{ transform: `rotate(${(i - 1) * 9}deg) translateY(${i === 1 ? -8 : 4}px)`, zIndex: i === 1 ? 3 : 1 }} />
          ))}
        </div>
      </div>
      <h2 className="brush-title small">书斋还空着，等第一缕声音</h2>
      <p>粘一条小宇宙 / B站 / 抖音 / 小红书链接，<br />留下封面与出处，落成文字，慢慢收进这里。</p>
      <button className="dash-empty-btn" onClick={onAdd}><Plus size={16} /> 收进第一条</button>
    </div>
  );
}

/** 知识图谱：把「专题 → 节目」画成一张辐射图；没有数据就老实说没有 */
function KnowledgeGraph({ episodes, topics, transcriptIds }: { episodes: Episode[]; topics: Topic[]; transcriptIds: Set<string> }) {
  const groups = topics
    .map((t) => ({ topic: t, eps: episodes.filter((e) => e.topic_id === t.id) }))
    .filter((g) => g.eps.length > 0);
  const ready = episodes.filter((e) => transcriptIds.has(e.id)).length;

  if (groups.length === 0) {
    return <EmptyHint icon={Network} title="知识图谱 · 还没有节点" desc="等书斋里收进几期、并有了逐字稿，这里会把「专题 → 节目 → 共同概念」连成一张图。" />;
  }

  const W = 900, H = 520, cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.34;
  return (
    <div className="dash-section">
      

      <div className="dash-eyebrow"><Network size={13} /> 知识图谱</div>
      <h1 className="brush-title">概念之间，是会连起来的。</h1>
      <p className="album-sub">{topics.length} 个专题 · {episodes.length} 期 · {ready} 期已有逐字稿。滚到哪一段都还能点回去听。</p>
      <div className="graph-wrap sketch-card">
        <svg viewBox={`0 0 ${W} ${H}`} className="kg-svg">
          {groups.map((g, i) => {
            const a = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
            return (
              <g key={g.topic.id}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(125,107,171,.25)" strokeWidth={1.5} />
                {g.eps.slice(0, 6).map((e, j) => {
                  const aa = a + (j - Math.min(6, g.eps.length) / 2) * 0.24;
                  const rr = R + 74;
                  return (
                    <g key={e.id}>
                      <line x1={x} y1={y} x2={cx + Math.cos(aa) * rr} y2={cy + Math.sin(aa) * rr} stroke="rgba(125,107,171,.16)" strokeWidth={1} />
                      <circle cx={cx + Math.cos(aa) * rr} cy={cy + Math.sin(aa) * rr} r={5} fill={transcriptIds.has(e.id) ? "#7d6bab" : "rgba(125,107,171,.3)"} />
                    </g>
                  );
                })}
                <circle cx={x} cy={y} r={26} fill={g.topic.color || "#9a8bc4"} opacity={0.9} />
                <text x={x} y={y + 4} textAnchor="middle" className="kg-topic-label">{g.topic.name}</text>
                <text x={x} y={y + 44} textAnchor="middle" className="kg-count">{g.eps.length} 期</text>
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={30} fill="#3a3450" />
          <text x={cx} y={cy + 5} textAnchor="middle" className="kg-center">MANTRA</text>
        </svg>
      </div>
    </div>
  );
}

/** 数据备份：本机数据全在这几个 localStorage 键里，导出一份 JSON 就是完整备份 */

/** 一键归类：把「待归类 / 拾光杂记 / 没有专辑」的期，按标题关键词分到专辑（没有就新建） */
const CLASSIFY_RULES: { album: string; words: string[] }[] = [
  { album: "商业洞察", words: ["商业", "公司", "营收", "利润", "品牌", "市场", "创业", "融资", "财报", "消费", "零售", "定价", "生意", "企业", "收购", "上市", "商业模式"] },
  { album: "时事速览", words: ["新闻", "速览", "今日", "政策", "国际", "选举", "制裁", "时政", "世界", "全球", "报道"] },
  { album: "人工智能", words: ["AI", "人工智能", "大模型", "算法", "芯片", "机器人", "算力", "智能体", "GPT", "deepseek"] },
  { album: "科技与互联网", words: ["科技", "互联网", "产品", "平台", "数据", "软件", "硬件", "App", "手机", "电脑"] },
  { album: "医疗健康", words: ["健康", "医疗", "医生", "疾病", "药", "睡眠", "运动", "跑步", "健身", "抑郁", "焦虑"] },
  { album: "学习提升", words: ["学习", "教育", "读书", "考试", "老师", "课程", "大学", "学校", "留学"] },
  { album: "旅游", words: ["旅行", "旅游", "目的地", "签证", "环球", "游记", "南美", "欧洲", "日本", "城市"] },
  { album: "英语学习", words: ["英语", "English", "口语", "听力", "雅思", "单词", "外刊"] },
  { album: "文化与艺术", words: ["文化", "艺术", "电影", "音乐", "文学", "展览", "戏剧", "摄影", "小说", "诗", "导演"] },
  { album: "心理与成长", words: ["心理", "情绪", "自我", "成长", "习惯", "选择", "关系", "人生", "疗愈", "孤独", "焦虑"] },
  { album: "社会观察", words: ["社会", "劳动", "群体", "调查", "现象", "年轻人", "女性", "家庭", "历史", "人文"] },
];

function BackupPanel() {
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState({ episodes: 0, transcripts: 0, notes: 0 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [list, setList] = useState<{ id: string; title: string; hasTx: boolean }[]>([]);

  useEffect(() => {
    try {
      const lib = JSON.parse(localStorage.getItem("pm_guest_library_v1") || "{}");
      const tx = JSON.parse(localStorage.getItem("pm_guest_transcripts_v1") || "{}");
      const notes = JSON.parse(localStorage.getItem("pm_episode_notes_v1") || "{}");
      const txIds = new Set(Object.keys(tx));
      setList((lib.episodes ?? []).map((e: { id: string; title: string }) => ({ id: e.id, title: e.title, hasTx: txIds.has(e.id) })));
      setStats({
        episodes: lib.episodes?.length ?? 0,
        transcripts: Object.keys(tx).length,
        notes: Object.values(notes as Record<string, unknown[]>).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0),
      });
    } catch { /* 读不出就显示 0 */ }
  }, []);

  function exportAll() {
    const keys: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("pm_")) {
        try { keys[k] = JSON.parse(localStorage.getItem(k) || "null"); } catch { keys[k] = localStorage.getItem(k); }
      }
    }
    const dump = { app: "podcast-mantra", version: 1, exported_at: new Date().toISOString(), data: keys };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mantra-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("已导出。把这个文件收好，换电脑时导入回来就行。");
  }

  function exportPicked() {
    if (!picked.size) { setMsg("先勾几期再导出。"); return; }
    const tx = JSON.parse(localStorage.getItem("pm_guest_transcripts_v1") || "{}");
    const lib = JSON.parse(localStorage.getItem("pm_guest_library_v1") || "{}");
    const episodes = (lib.episodes ?? []).filter((e: { id: string }) => picked.has(e.id));
    const transcripts: Record<string, unknown> = {};
    picked.forEach((id) => { if (tx[id]) transcripts[id] = tx[id]; });
    const dump = {
      app: "podcast-mantra", version: 1, kind: "episodes",
      exported_at: new Date().toISOString(),
      episodes, transcripts,
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mantra-selected-${picked.size}期-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg(`已导出 ${picked.size} 期（含 ${Object.keys(transcripts).length} 份逐字稿）。`);
  }

  async function importAll(file: File) {
    try {
      const dump = JSON.parse(await file.text());
      const data = dump?.data ?? {};
      if (!data || typeof data !== "object") throw new Error("文件格式不对");
      if (!window.confirm("导入会覆盖这台设备上现有的同名字段，确定吗？")) return;
      Object.entries(data).forEach(([k, v]) => {
        if (!k.startsWith("pm_")) return;
        localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      });
      setMsg("导入完成，页面马上刷新。");
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setMsg(`导入失败：${e instanceof Error ? e.message : "文件读不出来"}`);
    }
  }

  return (
    <div className="dash-section">
      <div className="backup-pick">
        <div className="bp-head">
          <h3>选择要导出的播客</h3>
          <div className="bp-actions">
            <button onClick={() => setPicked(new Set(list.map((x) => x.id)))}>全选</button>
            <button onClick={() => setPicked(new Set<string>())}>清空</button>
            <button className="primary" onClick={exportPicked}>导出所选（{picked.size}）</button>
          </div>
        </div>
        <div className="bp-list">
          {list.map((e) => (
            <label key={e.id} className={`bp-row ${picked.has(e.id) ? "on" : ""}`}>
              <input
                type="checkbox"
                checked={picked.has(e.id)}
                onChange={() => setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                  return next;
                })}
              />
              <span className="bp-title">{e.title}</span>
              {e.hasTx && <em>有逐字稿</em>}
            </label>
          ))}
        </div>
      </div>

      {msg && <p className="backup-msg">{msg}</p>}
    </div>
  );
}
function EmptyHint({ icon: Icon, title, desc }: { icon: typeof Library; title: string; desc: string }) {
  return (
    <div className="dash-placeholder">
      <div className="dash-empty-art"><Icon size={34} strokeWidth={1.4} /></div>
      <h2 className="brush-title small">{title}</h2>
      <p>{desc}</p>
      <span className="dash-soon"><Sparkles size={13} /> 明确留空，不做假按钮</span>
    </div>
  );
}
