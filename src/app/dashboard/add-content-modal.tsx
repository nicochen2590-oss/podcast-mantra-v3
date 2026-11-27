"use client";

import { useState } from "react";
import {
  X, Link2, ArrowRight, Loader2, CheckCircle2, AlertCircle,
  Podcast, Video, ChevronLeft, Pencil,
} from "lucide-react";
import type { ParsedEpisode } from "@/lib/parse/xiaoyuzhou";
import type { Episode, Topic } from "./types";
import { addGuestTopic, loadGuestLibrary, makeLocalEpisode } from "@/lib/guest/store";
import { friendlyError } from "@/lib/friendly-error";

type Stage = "input" | "parsing" | "preview" | "saving" | "done" | "error";

function detectPlatform(url: string): { key: string; label: string; icon: typeof Podcast; supported: boolean } {
  const u = url.toLowerCase();
  if (u.includes("xiaoyuzhou") || u.includes("xyzcdn")) return { key: "xiaoyuzhou", label: "小宇宙", icon: Podcast, supported: true };
  if (u.includes("podcasts.apple.com")) return { key: "apple", label: "Apple Podcasts", icon: Podcast, supported: true };
  if (u.includes("bilibili") || u.includes("b23.tv")) return { key: "bilibili", label: "B站", icon: Video, supported: false };
  if (u.includes("douyin") || u.includes("v.douyin")) return { key: "douyin", label: "抖音", icon: Video, supported: false };
  if (u.includes("xiaohongshu") || u.includes("xhslink")) return { key: "xiaohongshu", label: "小红书", icon: Video, supported: false };
  return { key: "other", label: "其他链接", icon: Link2, supported: false };
}

function fmtDuration(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} 小时 ${m % 60} 分` : `${m} 分钟`;
}


/** 关键词 → 专辑名：用来判断这期该进哪张专辑 */
const ALBUM_HINTS: { album: string; words: string[] }[] = [
  { album: "商业", words: ["商业", "公司", "营收", "利润", "品牌", "市场", "创业", "融资", "财报", "消费", "零售", "定价"] },
  { album: "时事新闻", words: ["新闻", "速览", "今日", "政策", "国际", "选举", "制裁", "发布会"] },
  { album: "人工智能", words: ["AI", "人工智能", "大模型", "算法", "芯片", "机器人", "机器学习", "算力"] },
  { album: "科技", words: ["科技", "互联网", "产品", "平台", "数据", "软件", "硬件"] },
  { album: "医疗健康", words: ["健康", "医疗", "医生", "疾病", "药", "睡眠", "心理", "情绪"] },
  { album: "学习提升", words: ["学习", "教育", "读书", "考试", "老师", "课程", "大学"] },
  { album: "旅游", words: ["旅行", "旅游", "出游", "目的地", "签证", "城市", "国家"] },
  { album: "英语学习", words: ["英语", "English", "口语", "听力", "雅思", "单词"] },
  { album: "文化与艺术", words: ["文化", "艺术", "电影", "音乐", "文学", "展览", "戏剧", "摄影"] },
  { album: "社会观察", words: ["社会", "城市", "劳动", "群体", "调查", "现象", "年轻人"] },
  { album: "自我成长", words: ["成长", "自我", "习惯", "选择", "焦虑", "关系", "人生"] },
];

/** 没有合适的专辑时，新建一张并返回它的 id（写进本机书斋，主题专辑页立即可见） */
function ensureTopic(name: string, existing: Topic[]): string {
  const hit = existing.find((t) => t.name === name);
  if (hit) return hit.id;
  const topic: Topic = { id: `local-${Date.now().toString(36)}`, name, color: null };
  try { addGuestTopic(topic); } catch { /* 存不下就退回空 */ }
  return topic.id;
}

function guessAlbum(title: string, summary: string, topics: Topic[], showName = ""): { name: string; existingId?: string } {
  const hay = `${title} ${summary}`;
  let best = { score: 0, album: "" };
  for (const { album, words } of ALBUM_HINTS) {
    const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    if (score > best.score) best = { score, album };
  }
  // 主题词本身已经是一张专辑
  const byName = best.album ? topics.find((t) => t.name.includes(best.album) || best.album.includes(t.name)) : undefined;
  if (best.score >= 1) return { name: byName?.name ?? best.album, existingId: byName?.id };
  // 一个关键词都没命中：按节目名归类（比"待归类"有意义），节目名也空才兜底
  const showAlbum = showName.trim();
  if (showAlbum) {
    const hit = topics.find((t) => t.name === showAlbum || t.name.includes(showAlbum) || showAlbum.includes(t.name));
    return { name: hit?.name ?? showAlbum, existingId: hit?.id };
  }
  const exists = topics.find((t) => t.name === "待归类");
  return { name: "待归类", existingId: exists?.id };
}

export function AddContentModal({
  onClose,
  onAdded,
  topics = [],
  onAddLocally,
}: {
  onClose: () => void;
  onAdded: () => void;
  topics?: Topic[];
  onAddLocally?: (ep: Episode) => void;
}) {
  const [stage, setStage] = useState<Stage>("input");
  const [url, setUrl] = useState("");
  const [data, setData] = useState<ParsedEpisode | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [msg, setMsg] = useState("");
  // 默认收进「拾光杂记」，永远不出现「不归类」
  const [newTopicName, setNewTopicName] = useState<string>("");
  const [autoAlbum, setAutoAlbum] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string>(
    () => topics.find((t) => t.name === "拾光杂记")?.id || topics[0]?.id || ""
  );
  const platform = detectPlatform(url);
  const PlatformIcon = platform.icon;

  const urls = url.split(/\s+/).map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x)).slice(0, 150);

  async function doParse() {
    if (!urls.length) return;
    if (urls.length > 1) return doParseMany();
    setStage("parsing");
    setErrorMsg("");
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "解析失败");
      setData(json.data);
      // 自动归档：标题/简介命中哪张专辑就进哪张；没有命中就准备新建一张
      const guess = guessAlbum(json.data?.title || "", json.data?.summary || "", topics, json.data?.show?.name || "");
      if (guess.existingId) {
        setTopicId(guess.existingId);
        setAutoAlbum(null);
      } else {
        setAutoAlbum(guess.name);
        setNewTopicName(guess.name);
      }
      setStage("preview");
    } catch (e) {
      setErrorMsg(friendlyError(e, "解析失败"));
      setStage("error");
    }
  }

  function updateField<K extends keyof ParsedEpisode>(key: K, value: ParsedEpisode[K]) {
    setData((d) => (d ? { ...d, [key]: value } : d));
  }

  /** 批量：逐条解析 → 自动归档 → 直接收进来 */
  async function doParseMany() {
    setStage("saving");
    setErrorMsg("");
    // 去重：库里已有的（同一期链接）+ 本次粘贴里的重复
    const existing = new Set(
      loadGuestLibrary().episodes.map((e) => String(e.source_url ?? "").trim()).filter(Boolean)
    );
    const seen = new Set<string>();
    const fresh: string[] = [];
    let skipped = 0;
    for (const u of urls) {
      const key = u.split("?")[0];
      if (existing.has(u) || existing.has(key) || seen.has(key)) { skipped += 1; continue; }
      seen.add(key);
      fresh.push(u);
    }
    if (!fresh.length) {
      setStage("done");
      setMsg(`这 ${urls.length} 条都已经在内容典藏里了，跳过 ${skipped} 条重复。`);
      return;
    }
    let ok = 0;
    const fails: string[] = [];
    let idx = 0;
    for (const one of fresh) {
      idx += 1;
      setMsg(`正在处理 ${idx}/${fresh.length}${skipped ? `（已跳过 ${skipped} 条重复）` : ""}：${one.slice(0, 44)}…`);
      try {
        const res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: one }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "解析失败");
        const guess = guessAlbum(json.data?.title || "", json.data?.summary || "", topics, json.data?.show?.name || "");
        const tid = guess.existingId ?? ensureTopic(guess.name, topics);
        onAddLocally?.(makeLocalEpisode(json.data, tid));
        ok += 1;
      } catch (e) {
        fails.push(`${one.slice(0, 40)}… ${friendlyError(e, "失败")}`);
      }
    }
    if (ok) onAdded();
    setMsg(`成功收进 ${ok} 期${fails.length ? `，${fails.length} 条失败` : ""}${skipped ? `，跳过 ${skipped} 条重复` : ""}。`);
    setErrorMsg(fails.join("；"));
    setStage(ok ? "done" : "error");
  }

  async function doSave() {
    if (!data) return;
    setStage("saving");
    setErrorMsg("");
    try {
      // 只存本机：元数据落进浏览器，不写云端、不需要登录
      // 需要新建专辑时，先用同名主题占位（保存后会出现在主题专辑里）
      const finalTopicId = autoAlbum
        ? ensureTopic(autoAlbum, topics)
        : (topicId || topics[0]?.id || "");
      const ep = makeLocalEpisode(data, finalTopicId);
      onAddLocally?.(ep);
      setStage("done");
    } catch (e) {
      setErrorMsg(friendlyError(e, "保存失败"));
      setStage("error");
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>

        {/* 第 1 步：输入链接 */}
        {stage === "input" && (
          <>
            <div className="modal-icon"><Link2 size={22} strokeWidth={1.8} /></div>
            <h2>添加一条内容</h2>
            <p className="modal-sub">粘贴播客链接，自动提取封面和信息</p>

            <label className="modal-label">内容链接</label>
            <div className="modal-input-wrap">
              <textarea
                autoFocus
                rows={3}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="一行一条，最多 150 条：\nhttps://www.xiaoyuzhoufm.com/episode/…\nhttps://podcasts.apple.com/…/id123?i=456"
                className="modal-input"
              />
              {url && <button className="modal-input-clear" onClick={() => setUrl("")}><X size={15} /></button>}
            </div>

            <div className="modal-guide">
              <p className="mg-title">链接怎么拿？</p>
              <p className="mg-body">
                打开小宇宙 App，找到想收的那一期 → 右上角「分享」→「复制链接」，回来粘贴到这里即可。
                网页版也一样：在单集页复制浏览器地址栏。
              </p>
              <div className="mg-links">
                <a href="https://www.xiaoyuzhoufm.com" target="_blank" rel="noreferrer">小宇宙网页版 ↗</a>
                <a href="https://apps.apple.com/cn/app/id1508478581" target="_blank" rel="noreferrer">iOS 下载</a>
                <a href="https://www.xiaoyuzhoufm.com/download" target="_blank" rel="noreferrer">Android 下载</a>
              </div>
            </div>

            {urls.length > 1 && (
              <div className="modal-detected">
                <span className="modal-detected-icon"><Link2 size={15} /></span>
                <span>识别到 <strong>{urls.length}</strong> 条链接，将逐条解析并自动归档（最多 150 条）</span>
              </div>
            )}

            {urls.length === 1 && (
              <div className={`modal-detected ${platform.supported ? "" : "unsupported"}`}>
                <span className="modal-detected-icon"><PlatformIcon size={15} /></span>
                <span>
                  {platform.supported
                    ? <>识别为 <strong>{platform.label}</strong> 链接，可以解析</>
                    : <><strong>{platform.label}</strong> 暂未接入自动解析，目前支持小宇宙与 Apple Podcasts</>}
                </span>
                {platform.supported && <CheckCircle2 size={15} className="modal-detected-ok" />}
              </div>
            )}

            <div className="modal-platforms">
              <span>已支持</span>
              <em className="on">小宇宙</em>
              <em>B站</em><em>抖音</em><em>小红书</em>
            </div>

            <button className="modal-submit" onClick={doParse} disabled={urls.length === 0 || (urls.length === 1 && !platform.supported)}>
              解析链接 <ArrowRight size={17} />
            </button>
            <p className="modal-footnote">信息抓取后可手动修改，确认无误再保存。</p>
          </>
        )}

        {/* 解析中 */}
        {stage === "parsing" && (
          <div className="modal-loading">
            <Loader2 size={30} className="spin" />
            <h2>正在读取这条内容…</h2>
            <p>正在从{platform.label}获取标题、封面和音频信息</p>
          </div>
        )}

        {/* 第 2 步：预览 + 可编辑 */}
        {stage === "preview" && data && (
          <>
            <button className="modal-backlink" onClick={() => setStage("input")}><ChevronLeft size={14} /> 重新输入</button>
            <h2>确认内容信息</h2>
            <p className="modal-sub">已自动抓取，可直接修改后保存</p>

            <div className="preview-cover-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {data.cover_url ? <img src={data.cover_url} alt="封面" className="preview-cover" /> : <div className="preview-cover ph"><Podcast size={26} /></div>}
              <div className="preview-cover-info">
                <span className="preview-badge">小宇宙</span>
                {data.show?.title && <span className="preview-show">{data.show.title}</span>}
                {data.duration_sec && <span className="preview-dur">{fmtDuration(data.duration_sec)}</span>}
              </div>
            </div>

            <label className="modal-label">标题 <Pencil size={11} /></label>
            <input className="modal-input" value={data.title} onChange={(e) => updateField("title", e.target.value)} />

            <label className="modal-label" style={{ marginTop: 14 }}>节目名 <Pencil size={11} /></label>
            <input
              className="modal-input"
              value={data.show?.title ?? ""}
              onChange={(e) => setData((d) => d ? { ...d, show: d.show ? { ...d.show, title: e.target.value } : null } : d)}
            />

            {topics.length > 0 && (
              <>
                <label className="modal-label" style={{ marginTop: 14 }}>收进哪张专辑</label>
                <select className="modal-input" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </>
            )}

            <div className="preview-note"><CheckCircle2 size={13} /> 封面、出处与声音都取到了，随时可以回来听</div>

            <button className="modal-submit" onClick={doSave} disabled={!data.title.trim()}>
              收进书斋 <ArrowRight size={17} />
            </button>
          </>
        )}

        {/* 保存中 */}
        {stage === "saving" && (
          <div className="modal-loading">
            <Loader2 size={30} className="spin" />
            <h2>正在收整…</h2>
            <p>{msg || "给这缕声音在书斋里找个位置"}</p>
          </div>
        )}

        {/* 完成 */}
        {stage === "done" && msg && (
          <p className="modal-done-msg">{msg}</p>
        )}
        {stage === "done" && (
          <div className="modal-done">
            <div className="modal-done-icon"><CheckCircle2 size={30} strokeWidth={1.6} /></div>
            <h2>收进来了</h2>
            <p>「{data?.title}」已经在书斋里安了家。<br />想听的时候，翻开就是。</p>
            <button className="modal-submit" onClick={onAdded}>回书斋看看</button>
          </div>
        )}

        {/* 错误 */}
        {stage === "error" && (
          <div className="modal-done">
            <div className="modal-done-icon err"><AlertCircle size={30} strokeWidth={1.6} /></div>
            <h2>没能完成</h2>
            <p>{errorMsg}</p>
            <button className="modal-submit" onClick={() => setStage(data ? "preview" : "input")}>返回重试</button>
          </div>
        )}
      </div>
    </div>
  );
}
