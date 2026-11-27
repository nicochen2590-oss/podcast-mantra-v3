"use client";

import { useState } from "react";
import { X, Feather, Sparkles, Loader2, FolderOpen } from "lucide-react";
import type { Episode, Topic } from "./types";
import { FlowerRatingPicker } from "./flower-rating";

export type EpisodeMeta = { rating: number; note: string; topic_id: string };
const STORE_KEY = "pm_episode_meta";

function writeLocal(id: string, meta: EpisodeMeta) {
  const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  all[id] = meta;
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

export function EpisodeQuickEdit({
  episode, topics = [], onClose, onSaved,
}: {
  episode: Episode; topics?: Topic[]; onClose: () => void; onSaved: (meta: EpisodeMeta) => void;
}) {
  const [rating, setRating] = useState(episode.rating ?? 0);
  const [note, setNote] = useState(episode.note ?? "");
  const [topicId, setTopicId] = useState<string>(episode.topic_id || topics[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    const meta: EpisodeMeta = {
      rating: rating || 0,
      note: note.trim(),
      topic_id: topicId || episode.topic_id || topics[0]?.id || "",
    };
    // 只写本机：花朵、余音、归属专辑都落在 pm_episode_meta 里
    try {
      writeLocal(episode.id, meta);
      onSaved(meta);
    } catch {
      setError("这台设备的浏览器没能存下，可能是隐私模式或空间已满。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card edit-card">
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        <div className="modal-icon"><Feather size={22} strokeWidth={1.8} /></div>
        <h2 className="brush-title small">留个记号</h2>
        <p className="modal-sub">{episode.title}</p>

        <label className="modal-label">听完后，心里开了几朵花</label>
        <FlowerRatingPicker value={rating} onChange={setRating} />

        <label className="modal-label" style={{ marginTop: 22 }}>余音 <Sparkles size={11} /></label>
        <textarea
          className="edit-textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="哪一句还在耳边？一个念头、一点心情，随手记下就好…"
          rows={4}
        />

        {topics.length > 0 && (
          <>
            <label className="modal-label" style={{ marginTop: 20 }}><FolderOpen size={11} /> 收进哪张专辑</label>
            <select className="modal-input" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </>
        )}

        {error && <p className="edit-error">{error}</p>}

        <button className="modal-submit" onClick={save} disabled={saving}>
          {saving ? <><Loader2 size={17} className="spin" /> 收好中…</> : <>收进书斋 <Sparkles size={16} /></>}
        </button>
      </div>
    </div>
  );
}
