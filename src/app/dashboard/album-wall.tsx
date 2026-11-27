"use client";

import { useEffect, useMemo, useState } from "react";
import { Disc3, Plus, ArrowUpRight, Loader2, Sparkles, Headphones, FolderInput, X, ArrowRight, Pin, Pencil, Trash2, CheckSquare } from "lucide-react";
import type { Episode, Topic } from "./types";
import { displayCover } from "@/lib/guest/data";

const SWATCHES = ["#9a8bc4", "#6f8fa8", "#b98a86", "#c0a06a", "#a97b93", "#8aa387", "#7d6bab", "#b0873e"];
const GLYPHS = ["✿", "✦", "❧", "☾", "♪", "✳", "◈", "✎"];
const PIN_KEY = "pm_pinned_topics";

function lastTouched(eps: Episode[]) {
  return eps.reduce((m, e) => {
    const ts = new Date(e.added_at || e.created_at).getTime();
    return Number.isFinite(ts) ? Math.max(m, ts) : m;
  }, 0);
}

export function AlbumWall({
  topics, episodes, onOpenTopic, onMove, onCreate, onDelete, onRename,
}: {
  topics: Topic[]; episodes: Episode[];
  onOpenTopic: (id: string) => void;
  onRename?: (t: Topic) => void;
  onMove: (episodeId: string, topicId: string) => Promise<void> | void;
  onCreate: (t: Topic) => void;
  onDelete: (t: Topic) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // 正在整理哪张专辑
  const [managing, setManaging] = useState<Topic | null>(null);
  // 专辑管理态：卡片上直接出现删除
  const [albumMode, setAlbumMode] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);

  async function createAlbum() {
    if (!name.trim()) return;
    setSaving(true); setErr("");
    try {
      onCreate({ id: `guest-local-t-${Date.now()}`, name: name.trim(), color });
      setCreating(false); setName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "没能建好");
    } finally {
      setSaving(false);
    }
  }

  async function move(epId: string, topicId: string) {
    if (!topicId) return;
    setMovingId(epId);
    try { await onMove(epId, topicId); } finally { setMovingId(null); }
  }

  const managingEps = managing ? episodes.filter((e) => e.topic_id === managing.id) : [];

  return (
    <div className="album-page">
      <div className="dash-eyebrow"><Disc3 size={13} /> 专辑墙</div>
      <div className="album-head">
        <div>
          <h1 className="brush-title">给声音，分一间屋子。</h1>
          <p className="album-sub">按自己的心意，把听过的收进一张张专辑。想重听哪一类，翻开就是；放错了屋子，随时可以搬。</p>
        </div>
        <div className="album-head-actions">
          <button className={`album-manage-btn ${albumMode ? "active" : ""}`} onClick={() => setAlbumMode((v) => !v)}>
            <CheckSquare size={15} /> {albumMode ? "完成" : "管理"}
          </button>
          <button className="album-new" onClick={() => { setCreating((v) => !v); if (!creating) setAlbumMode(false); }}>
            {creating ? <><Plus size={16} className="rot45" /> 收起</> : <><Plus size={16} /> 新建专辑</>}
          </button>
        </div>
      </div>

      {creating && (
        <div className="album-create sketch-card">
          <div className="sketch-sticky">新专辑</div>
          <label className="modal-label">给它起个名字</label>
          <input
            className="modal-input" autoFocus
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createAlbum(); }}
            placeholder="比如：深夜书房、通勤路上、关于远方…"
            maxLength={20}
          />
          <label className="modal-label" style={{ marginTop: 16 }}>挑个颜色</label>
          <div className="album-swatches">
            {SWATCHES.map((c) => (
              <button key={c} className={`album-swatch ${color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
          {err && <p className="edit-error">{err}</p>}
          <button className="modal-submit" style={{ marginTop: 20 }} onClick={createAlbum} disabled={saving || !name.trim()}>
            {saving ? <><Loader2 size={16} className="spin" /> 收整中…</> : <><Sparkles size={16} /> 收好这间屋子</>}
          </button>
        </div>
      )}

      <div className="album-grid">
        {topics.map((t, idx) => {
          const eps = episodes.filter((e) => e.topic_id === t.id);
          const covers = eps.map(displayCover).filter(Boolean).slice(0, 3) as string[];
          return (
            <div
              key={t.id}
              className="album-card sketch-card"
              role="button"
              tabIndex={0}
              style={{ "--tilt": `${(idx % 4 - 1.5) * 0.8}deg`, "--album": t.color || SWATCHES[idx % SWATCHES.length] } as React.CSSProperties}
              onClick={() => { if (!albumMode) onOpenTopic(t.id); }}
              onKeyDown={(e) => { if (!albumMode && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpenTopic(t.id); } }}
            >
              <span className="album-tape" />
              {albumMode && (
                <>
                  {onRename && (
                    <button
                      className="album-delete album-rename"
                      title="给这张专辑改个名字"
                      onClick={(e) => { e.stopPropagation(); onRename(t); }}
                    >
                      <Pencil size={13} /> 重命名
                    </button>
                  )}
                  <button
                    className="album-delete"
                    title="删掉这张专辑（里面的期会移到「拾光杂记」）"
                    onClick={(e) => { e.stopPropagation(); onDelete(t); }}
                  >
                    <Trash2 size={13} /> 删除
                  </button>
                </>
              )}
              {eps.length > 0 && (
                <button
                  className="album-manage"
                  title="整理这张专辑：把某期搬到别的屋子"
                  onClick={(e) => { e.stopPropagation(); setManaging(t); }}
                >
                  <FolderInput size={12} /> 整理
                </button>
              )}
              <span className="album-glyph-big" style={{ color: t.color || SWATCHES[idx % SWATCHES.length] }}>
                {GLYPHS[idx % GLYPHS.length]}
              </span>
              <div className="album-stack">
                {covers.length > 0 ? (
                  covers.map((c, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={c + i} src={c} alt="" className="album-polaroid" style={{ transform: `rotate(${(i - 1) * 9}deg) translate(${i * 8 - 8}px, ${i * 4}px)`, zIndex: 3 - i }} />
                  ))
                ) : (
                  <div className="album-stack-empty"><Headphones size={26} strokeWidth={1.3} /><span>还空着</span></div>
                )}
              </div>
              <div className="album-foot">
                <div className="album-name">{t.name}</div>
                <div className="album-count">{eps.length} 期 <ArrowUpRight size={14} /></div>
              </div>
            </div>
          );
        })}

        <div className="album-card album-card-add sketch-card" role="button" tabIndex={0} onClick={() => setCreating(true)} onKeyDown={(e) => { if (e.key === "Enter") setCreating(true); }}>
          <span className="album-add-inner"><Plus size={26} strokeWidth={1.6} /><span>再开一间</span></span>
        </div>
      </div>

      {/* 整理专辑：把单期搬到别的屋子 */}
      {managing && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setManaging(null); }}>
          <div className="modal-card album-manage-card">
            <button className="modal-close" onClick={() => setManaging(null)} aria-label="关闭"><X size={18} /></button>
            <div className="modal-icon" style={{ borderColor: managing.color || undefined }}>
              <FolderInput size={22} strokeWidth={1.8} color={managing.color || undefined} />
            </div>
            <h2 className="brush-title small">整理「{managing.name}」</h2>
            <p className="modal-sub">这一间收了 {managingEps.length} 期。想换屋子的，点右边换个专辑就好。</p>

            <div className="album-manage-list">
              {managingEps.map((e) => (
                <div className="album-manage-row" key={e.id}>
                  {displayCover(e) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={displayCover(e) as string} alt="" className="album-manage-cover" />
                  ) : (
                    <div className="album-manage-cover ph"><Headphones size={14} /></div>
                  )}
                  <span className="album-manage-title" title={e.title}>{e.title}</span>
                  {movingId === e.id ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <div className="album-manage-select">
                      <ArrowRight size={12} />
                      <select value="" onChange={(ev) => move(e.id, ev.target.value)} aria-label="移到其他专辑">
                        <option value="">移到…</option>
                        {topics.filter((t) => t.id !== managing.id).map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ))}
              {managingEps.length === 0 && <p className="album-manage-empty">这间还空着，先收几期进来。</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
