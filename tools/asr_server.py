#!/usr/bin/env python3
"""
本地播客转写服务（零成本、无限量）。

为什么要独立进程：whisper 模型加载一次要几秒，Next 的 API 每次调用都重启
python 的话，光加载就吃掉大半时间。所以这里做成常驻小服务，模型只在启动时
加载一次，之后每片音频直接推理。

接口（只监听 127.0.0.1）：
  GET  /health                    → {"ok":true,"model":"small","ready":true}
  POST /asr    {wav, language}    → {"segments":[{start,end,text}]}   时间相对该片音频
  POST /analyze {title, segments} → {items, summary, keywords, highlights, mindmap}

全部规则化处理，不调用任何付费 API。
"""
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("PM_ASR_HOST", "127.0.0.1")
PORT = int(os.environ.get("PM_ASR_PORT", "8765"))
MODEL_SIZE = os.environ.get("PM_WHISPER_MODEL", "small")
_LOCAL_MLX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "whisper-large-v3-turbo")
# 默认用 small：内存吃紧时 large 会被换页拖慢十倍以上。
# 想要最高准确率，启动前设 PM_MLX_MODEL=<large 目录> 即可。
_DEFAULT_MLX = "mlx-community/whisper-small-mlx"
MLX_MODEL = os.environ.get("PM_MLX_MODEL") or _DEFAULT_MLX
USE_MLX = os.environ.get("PM_USE_MLX", "1") != "0"

_model = None
_backend = "faster-whisper"
_model_lock = threading.Lock()
_ready = False
_load_error = ""


def load_model():
    global _model, _backend, _ready, _load_error
    # 先试 Apple GPU 版：一小时的音频通常几分钟就能出稿
    if USE_MLX:
        try:
            import mlx_whisper
            import numpy as np

            # 先把模型装进显存：拿 1 秒静音跑一次（首次会下载模型）

            silence = np.zeros(16000, dtype=np.float32)
            mlx_whisper.transcribe(silence, path_or_hf_repo=MLX_MODEL, language="zh", verbose=False)
            _backend = "mlx"
            _model = MLX_MODEL
            _ready = True
            sys.stderr.write(f"[asr] mlx model={MLX_MODEL} ready\n")
            return
        except Exception as e:  # noqa: BLE001
            _load_error = f"mlx 不可用，改用 CPU：{e}"
            sys.stderr.write(f"[asr] mlx failed: {e}\n")

    try:
        from faster_whisper import WhisperModel

        threads = int(os.environ.get("PM_ASR_THREADS", "0")) or min(8, os.cpu_count() or 4)
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8", cpu_threads=threads)
        _backend = "faster-whisper"
        _ready = True
        sys.stderr.write(f"[asr] cpu model={MODEL_SIZE} ready\n")
    except Exception as e:  # noqa: BLE001
        _load_error = str(e)
        sys.stderr.write(f"[asr] load failed: {e}\n")


# ────────────────────────── 文本清理 ──────────────────────────
FILLERS = re.compile(
    r"(嗯+|呃+|啊+|哦+|唉+|诶+|呀+|呢+$|就是说|那个那个|这个这个|你知道吧|怎么说呢|"
    r"对吧|然后呢|其实吧|就是吧|我跟你讲)"
)
PUNCT = "。！？!?；;，,、：:"


def clean_text(t: str) -> str:
    t = t.strip()
    t = FILLERS.sub("", t)
    t = re.sub(r"\s+", "", t)
    t = re.sub(r"([，。！？、；：])\1+", r"\1", t)
    t = re.sub(r"^[，。！？、；：\s]+", "", t)
    if t and t[-1] not in "。！？!?…":
        t += "。"
    return t


def first_clause(t: str, n: int = 16) -> str:
    cut = re.search(f"[{PUNCT}]", t)
    head = t[: cut.start()] if cut and cut.start() > 0 else t
    head = head.strip("，、 ")
    return head if len(head) <= n else head[:n] + "…"


def split_sentences(t: str):
    return [s for s in re.split(r"(?<=[。！？!?；;…])", t) if s.strip()]


# ────────────────────────── 关键词 ──────────────────────────
STOP = set(
    """的 了 是 在 我 你 他 她 它 我们 你们 他们 这 那 这个 那个 就 也 都 还 而 与 和 跟 对 把 被 让 给 但
    但是 所以 因为 如果 虽然 然后 现在 可以 可能 应该 需要 觉得 认为 知道 时候 一个 一些 这样 那样 没有 不是
    自己 别人 东西 事情 问题 方面 其实 就是 这种 那种 什么样 怎么 为什么 什么 多少 一些 很多 非常 特别 真的
    有点 一点 一直 已经 开始 结束 一起 之后 之前 当时 现在 后来 感觉 感受 方式 方法 部分 情况 过程""".split()
)


POS_KEEP = ("n", "nr", "ns", "nt", "nz", "vn", "an", "eng")


def extract_terms(texts):
    """只留名词/专名/动名词：动词和虚词拼出来的碎片（「会念」「事上」）不要。"""
    try:
        import jieba.posseg as pseg
        counts = {}
        for t in texts:
            for w, flag in pseg.cut(t):
                w = w.strip()
                if len(w) < 2 or len(w) > 8 or w in STOP:
                    continue
                if not flag.startswith(POS_KEEP):
                    continue
                if re.fullmatch(r"[\d.]+", w):
                    continue
                counts[w] = counts.get(w, 0) + 1
        if counts:
            return counts
    except Exception:  # noqa: BLE001
        pass
    # 退化：2-4 字 n-gram
    joined = "".join(texts)
    chars = re.sub(r"[\s\W_]+", "", joined)
    counts = {}
    for n in (2, 3, 4):
        for i in range(len(chars) - n + 1):
            w = chars[i : i + n]
            if w in STOP:
                continue
            counts[w] = counts.get(w, 0) + 1
    return counts


def keyword_weights(texts):
    counts = extract_terms(texts)
    if not counts:
        return {}
    top = max(counts.values())
    return {w: c / top for w, c in counts.items() if c >= 2}


def keywords_of(texts, terms, limit=8):
    """从候选词里挑出真正成词、且能在正文找到解释句的"""
    picked = []
    for w, _ in sorted(terms.items(), key=lambda kv: (-kv[1], -len(kv[0]))):
        if len(picked) >= limit:
            break
        sent = next((s for s in texts if w in s and 12 <= len(s) <= 90), None)
        if sent is None:
            sent = next((s for s in texts if w in s), None)
        if not sent:
            continue
        brief = first_clause(clean_text(sent), 44)
        if brief and all(brief != p["brief"] for p in picked):
            picked.append({"term": w, "brief": brief})
    return picked


# ────────────────────────── 摘要 / 高光 / 导图 ──────────────────────────
def score_sentences(texts, weights):
    scored = []
    for i, s in enumerate(texts):
        if len(s) < 12:
            continue
        hit = sum(wt for w, wt in weights.items() if w in s)
        # 信息密度：关键词权重 / 句长，再给带数字与判断词的一点加成
        density = hit / (len(s) ** 0.55)
        if re.search(r"\d", s):
            density *= 1.15
        if re.search(r"(其实|关键|本质|因为|所以|意味着|最重要|反而是|不是.*而是)", s):
            density *= 1.2
        scored.append((density, i, s))
    scored.sort(key=lambda x: -x[0])
    return scored


def build_summary(texts, weights, limit=3):
    top = score_sentences(texts, weights)[: limit * 2]
    picked = sorted(top, key=lambda x: x[1])[:limit]
    body = "".join(clean_text(s) for _, _, s in picked)
    return body if len(body) >= 40 else ""


def build_highlights(scored, limit=5):
    out = []
    for density, i, s in scored:
        if len(out) >= limit:
            break
        if len(s) < 14 or len(s) > 70:
            continue
        out.append({"idx": i, "text": _strip_loops(clean_text(s))})
    return out


def build_mindmap(title, items, weights):
    """规则版导图：按时间把逐字稿分成 3~5 个大段，段内再分 2~4 小块。

    命名不用逐字稿原句，而是取这几段里权重最高的两三个术语拼成语义标签，
    这样一级二级读起来像「议题」，三级才是从原文压出来的短句。
    """
    n = len(items)
    if n < 6:
        return None
    k = max(3, min(5, round(n / 8)))
    per = (n + k - 1) // k
    branches = []
    for gi in range(k):
        group = items[gi * per : (gi + 1) * per]
        if len(group) < 2:
            continue
        texts = [g["text"] for g in group]
        local = extract_terms(texts)
        lab = keywords_of(texts, {k: v for k, v in local.items()}, 2)
        label = " · ".join(x["term"] for x in lab) or first_clause(clean_text(texts[0]), 12)
        sub_k = 2 if len(group) < 6 else min(4, max(2, len(group) // 3))
        sub_per = (len(group) + sub_k - 1) // sub_k
        children = []
        for si in range(sub_k):
            sub = group[si * sub_per : (si + 1) * sub_per]
            if not sub:
                continue
            sub_texts = [x["text"] for x in sub]
            local_sub = extract_terms(sub_texts)
            slab = keywords_of(sub_texts, {k: v for k, v in local_sub.items()}, 1)
            slabel = slab[0]["term"] if slab else first_clause(clean_text(sub_texts[0]), 10)
            leaves = [
                {"name": first_clause(clean_text(x["text"]), 22), "start_ms": x["start_ms"]}
                for x in sub[:3]
            ]
            leaf_names = {l["name"] for l in leaves}
            children.append(
                {
                    "name": slabel[:18],
                    "start_ms": sub[0]["start_ms"],
                    "children": leaves,
                }
                if leaves and len(leaf_names) > 1
                else {"name": slabel[:18], "start_ms": sub[0]["start_ms"]}
            )
        if children:
            branches.append({"name": label[:18], "start_ms": group[0]["start_ms"], "children": children})
    if len(branches) < 2:
        return None
    return {"name": first_clause(title, 14) or title, "start_ms": 0, "children": branches}


def _sentence_units(items):
    """把段落拆成句子单元，带时间；用于挑金句/观点"""
    units = []
    for it in items:
        parts = split_sentences(it["text"]) or [it["text"]]
        total = sum(len(p) for p in parts) or 1
        t = it["start_ms"]
        span = max(1000, (it.get("end_ms") or it["start_ms"] + 8000) - it["start_ms"])
        for p in parts:
            dur = int(span * len(p) / total)
            units.append({"text": clean_text(p), "start_ms": t, "end_ms": t + dur})
            t += dur
    return units


def _pause_between(a, b):
    return max(0, (b["start_ms"] - (a.get("end_ms") or a["start_ms"])) / 1000.0)


def build_paragraphs(units, pause_gap=1.6, max_chars=320):
    """按语义段落合并：停顿超过阈值、或段落已经够长、或跑完一个完整意思就断开"""
    paras = []
    cur = []
    for u in units:
        if cur:
            gap = _pause_between(cur[-1], u)
            cur_len = sum(len(x["text"]) for x in cur)
            ends_clean = bool(re.search(r"[。！？!?…]$", cur[-1]["text"]))
            if gap >= pause_gap or cur_len >= max_chars or (ends_clean and cur_len >= 140) or re.search(r"^[一二三四五六七八九十]、|^第[一二三四五六七八九十]+[章节]|^(那么|好|接下来)", u["text"]):
                paras.append(cur)
                cur = []
        cur.append(u)
    if cur:
        paras.append(cur)

    out = []
    for i, group in enumerate(paras):
        text = "".join(x["text"] for x in group)
        out.append({
            "start_ms": group[0]["start_ms"],
            "end_ms": group[-1]["end_ms"],
            "text": _strip_loops(text),
            "gist": first_clause(text, 18),
            "topic": "",
        })
    return out


def build_chapters(paragraphs, title):
    n = len(paragraphs)
    if n == 0:
        return []
    dur = paragraphs[-1]["end_ms"] - paragraphs[0]["start_ms"]
    k = 3 if dur < 20 * 60_000 else 4 if dur < 45 * 60_000 else 5 if dur < 75 * 60_000 else 6
    k = min(k, max(1, n // 3))
    if k <= 1:
        return []
    per = n / k
    chapters = []
    for i in range(k):
        group = paragraphs[int(i * per): int((i + 1) * per)]
        if not group:
            continue
        texts = [p["text"] for p in group]
        local = extract_terms(texts)
        top = keywords_of(texts, local, 3)
        if top:
            label = " · ".join(t["term"] for t in top[:2])
        else:
            label = first_clause(group[0]["text"], 12)
        # 术语太"平"时，用这一章里最有信息量的一句当副题
        core_sentence = next(
            (p["text"] for p in group if 16 <= len(p["text"]) <= 60 and re.search(r"[是|不是|其实|关键|才|会|要]", p["text"])),
            group[0]["text"],
        )
        qu = [u["text"] for u in _sentence_units(group) if 12 <= len(u["text"]) <= 46]
        chapters.append({
            "title": label[:24],
            "start_ms": group[0]["start_ms"],
            "end_ms": group[-1]["end_ms"],
            "core": (core_sentence[:42] + "…") if len(core_sentence) > 42 else core_sentence,
            "points": [p["gist"] for p in group[:4] if p["gist"]],
            "quotes": qu[:2],
        })
    return chapters


def build_overview(title, units, chapters, weights):
    if not units:
        return None
    scored = score_sentences([u["text"] for u in units], weights)
    by_idx = {i: s for _, i, s in scored}
    top_idx = [i for _, i, _ in scored[:12]]

    def pick(max_len=90, prefer=None, skip=()):
        for i in top_idx:
            t = units[i]["text"]
            if i in skip or len(t) < 10 or len(t) > max_len:
                continue
            if prefer and not re.search(prefer, t):
                continue
            return i, t
        return None, None

    # 一句话：用章节标题串成「从…到…」，比抽一句原文更像概览
    top_terms = [w for w, _ in sorted(weights.items(), key=lambda kv: -kv[1])][:3]
    i_one, thesis = pick(100)
    if thesis and _is_judgement(thesis):
        one = thesis
    elif top_terms:
        one = f"这一期围绕「{'」「'.join(top_terms)}」展开。"
    else:
        one = f"这一期围绕{title}展开。"
    background = [u["text"] for u in units[:3] if len(u["text"]) > 12][:2]

    core = []
    for ch in chapters:
        core.append({"title": ch["title"], "point": ch["core"], "start_ms": ch["start_ms"]})
    if not core:
        core = [{"title": "主干", "point": first_clause(units[0]["text"], 30), "start_ms": units[0]["start_ms"]}]

    # 结论：优先用最后一章的核心句
    conclusion = chapters[-1]["core"] if chapters else ""
    if not conclusion:
        tail = units[int(len(units) * 0.75):] or units[-3:]
        for u in reversed(tail):
            if 14 <= len(u["text"]) <= 120:
                conclusion = u["text"]
                break
    if not conclusion:
        conclusion = units[-1]["text"]

    terms = [w for w, _ in sorted(weights.items(), key=lambda kv: -kv[1])][:5]
    audience = (
        f"适合正关心「{'、'.join(terms[:3])}」的人；只想快速了解这期在讲什么的话，看概览和章节就够。"
        if terms else "适合想了解这一期在讲什么、又没时间完整听的人。"
    )

    return {
        "one_line": one,
        "background": background,
        "core": core,
        "conclusion": conclusion,
        "audience": audience,
        "incomplete": False,
    }


META_RE = re.compile(r"^(我们|咱们|今天|这期|本期|节目|刚才|接下来|首先|然后|那么|好的|好|ok|OK|嗯|其实我们|上一个|下一)")


def _is_judgement(text):
    """是不是一句"有内容"的判断，而不是"我们先从上车的闲聊开始"这种过场"""
    t = text.strip()
    if META_RE.search(t):
        return False
    if re.search(r"(欢迎|收听|关注|订阅|下期再见|广告|赞助|公众号|进群|链接)", t):
        return False
    if re.search(r"(我们先|我们来看|我们聊|说说|先说说)", t):
        return False
    # 要有判断/论证的骨架
    return bool(re.search(r"(是|不是|其实|关键在于|本质|因为|所以|意味着|应该|必须|反而|区别|原因|方法|问题在于|才会|才能|需要|不要|可以)", t))


def build_takeaways(units, weights, chapters):
    """核心观点：挑信息密度高的句子，配一句解释（用同段落里另一句作依据）"""
    texts = [u["text"] for u in units]
    scored = score_sentences(texts, weights)
    picked = []
    used = set()
    for density, i, s in scored:
        if len(picked) >= 6:
            break
        if i in used or len(s) < 18 or len(s) > 90:
            continue
        if not _is_judgement(s):
            continue
        # 观点标题：压成短句（去掉起头的连接词）
        head = re.sub(r"^(但是|所以|其实|然后|因为|而且|不过|我觉得|我认为|就是说)[，,]?", "", s)
        title = first_clause(head, 24)
        if len(title) < 8:
            continue
        ch = next((c for c in chapters if c["start_ms"] <= units[i]["start_ms"] <= c["end_ms"]), None)
        picked.append({
            "title": title,
            "explain": s if len(s) <= 90 else s[:90] + "…",
            "evidence": (s + (texts[i + 1] if i + 1 < len(texts) else ""))[:180],
            "start_ms": units[i]["start_ms"],
            "chapter": ch["title"] if ch else "",
        })
        used.update({i, i - 1, i + 1})
    if len(picked) < 2:
        for density, i, s in scored:
            if len(picked) >= 3:
                break
            if i in used or not (18 <= len(s) <= 80):
                continue
            if META_RE.search(s) or re.search(r"(欢迎|收听|下期|广告)", s):
                continue
            head = re.sub(r"^(但是|所以|其实|然后|因为|而且|不过)[，,]?", "", s)
            picked.append({
                "title": first_clause(head, 24),
                "explain": s,
                "evidence": "",
                "start_ms": units[i]["start_ms"],
                "chapter": "",
            })
            used.update({i - 1, i, i + 1})
    return picked


ACTION_RE = re.compile(r"(第一步|第二步|首先|其次|然后就是|你可以|建议你|不妨|试试|方法是|做法是|关键在于|秘诀|技巧|步骤|操作|记得要)")
EXAMPLE_RE = re.compile(r"(我有一个|有一次|我当时|比如说|举个例子|我朋友|我认识一个人|那会儿|曾经)")


def build_actions(units):
    out = []
    for u in units:
        t = u["text"]
        if 10 <= len(t) <= 110 and ACTION_RE.search(t):
            out.append({"text": t, "start_ms": u["start_ms"], "declared": True})
        if len(out) >= 5:
            break
    return out


def build_examples(units):
    out = []
    for u in units:
        t = u["text"]
        if 14 <= len(t) <= 120 and EXAMPLE_RE.search(t):
            out.append({"text": t, "start_ms": u["start_ms"]})
        if len(out) >= 4:
            break
    return out


def _pick_quotes(units, weights):
    """金句：能独立成立、有态度的一句；去掉重复和口水"""
    seen = set()
    out = []
    scored = []
    for u in units:
        t = u["text"]
        if not (10 <= len(t) <= 46):
            continue
        if META_RE.search(t) or re.search(r"(欢迎|收听|下期|广告|公众号)", t):
            continue
        # 有一定态度词才像金句
        weight = sum(v for k, v in weights.items() if k in t) + (0.4 if re.search(r"(其实|才|不是|而是|反而|根本|真正)", t) else 0)
        scored.append((weight, u))
    scored.sort(key=lambda x: -x[0])
    for _, u in scored:
        key = u["text"][:12]
        if key in seen:
            continue
        seen.add(key)
        out.append({"text": u["text"], "start_ms": u["start_ms"]})
        if len(out) >= 6:
            break
    return out


def build_questions(units, weights, title):
    """问题要有落点：从节目里真实出现的提问 + 从关键词延伸的具体问题"""
    qs = []
    for u in units:
        t = u["text"]
        if t.endswith("？") and 12 <= len(t) <= 48:
            qs.append(t)
        if len(qs) >= 2:
            break
    terms = [w for w, _ in sorted(weights.items(), key=lambda kv: -kv[1])][:4]
    for t in terms[:2]:
        qs.append(f"如果把你自己的经验放进「{t}」这件事里，会有哪一步是节目没说、但你做过的？")
    if len(qs) < 3:
        qs.append("这一期里哪一个判断，你其实并不同意？不同意的理由是什么？")
    return qs[:4]


EDIT_SYSTEM = """你是播客的资深文字编辑，负责把机器识别的逐字稿整理成"可以读"的编辑版。
硬性要求：
1. 只做三件事：补标点、按语义断句分段、修正明显的同音错字/专有名词。
2. 不许改写、概括、删减事实，不许添加原文没有的信息。
3. 数字、金额、年份、百分比、人名、公司名一律照抄；拿不准就保留原样。
4. 口语保留：语气词、"就是说""这个"这类有节奏的表达不要全删。
4b. **严禁概括**：编辑后的总字数不得少于原文的 90%。原文每一句都要出现在编辑版里，
    只允许合并断句、补标点、改错字，不允许删句、缩写、总结。
4c. 输出的每一段都必须以句号/问号/感叹号结尾；不允许出现"但依然。"这种半句收尾。
4d. 段落按话题自然分段，2–5 句一段，不要把整段压成一句。
5. 每段 2–5 句，段首给时间码 t（取该段开头那句的原始时间码，毫秒）。
6. 按话题把这期切成 4–8 个章节，章节标题要具体（不要"第一部分"）。
只输出 JSON：
{"chapters":[{"title":"","summary":"","start_ms":0,"end_ms":0,"paragraphs":[{"t":0,"text":""}]}]}
"""


def _norm_ms(v):
    try:
        v = float(v)
    except Exception:  # noqa: BLE001
        return 0
    ms = int(v * 1000) if v < 100000 else int(v)
    if ms > 4 * 3600 * 1000:
        ms = int(ms / 1000)
    return ms


def edit_transcript_with_llm(title, segments, window_ms=None):
    """单独一次调用：把逐字稿整理成带标点、带章节的阅读版。"""
    refresh_llm_config()
    if not LLM_KEY or not segments:
        return None
    out = []
    # 长音频按窗口分段处理；越长的节目窗口越大，控制调用次数
    if window_ms is None:
        dur = int(segments[-1].get("start_ms", 0)) if segments else 0
        window_ms = 12 * 60 * 1000 if dur > 120 * 60 * 1000 else 8 * 60 * 1000
    step = window_ms
    total = max(int(segments[-1].get("start_ms", 0)), 1)
    for start in range(0, total + 1, step):
        chunk = [s for s in segments if start <= int(s.get("start_ms", 0)) < start + step]
        if len(chunk) < 3:
            continue
        lines = "\n".join(f"[{int(s['start_ms'])}] {s['text']}" for s in chunk)
        prompt = f"节目：{title}\n逐字稿（[毫秒] 正文）：\n{lines}"
        try:
            r = _llm_chat(
                [{"role": "system", "content": EDIT_SYSTEM}, {"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=6000,
            )
            st, en = r.find("{"), r.rfind("}")
            data = json.loads(r[st : en + 1])
        except Exception as e:  # noqa: BLE001
            print(f"[edit] llm failed: {e}", flush=True)
            return out or None
        for ch in data.get("chapters") or []:
            paras = []
            for p in ch.get("paragraphs") or []:
                txt = str(p.get("text", "")).strip()
                if len(txt) < 8:
                    continue
                paras.append({"t": _norm_ms(p.get("t", 0)), "text": txt[:1200]})
            if not paras:
                continue
            out.append({
                "index": len(out) + 1,
                "title": str(ch.get("title", ""))[:30] or f"第 {len(out) + 1} 段",
                "summary": str(ch.get("summary", ""))[:120],
                "start_ms": _norm_ms(ch.get("start_ms", 0)) or paras[0]["t"],
                "end_ms": _norm_ms(ch.get("end_ms", 0)) or paras[-1]["t"],
                "paragraphs": paras,
            })
    total_src = sum(len(x.get("text", "")) for x in segments)
    total_out = sum(len(p["text"]) for c in out for p in c["paragraphs"])
    if total_src > 0 and total_out < total_src * 0.7:
        print(f"[edit] 编辑版被压缩过多（{total_out}/{total_src}），退回原文", flush=True)
        return None
    return {"chapters": out} if len(out) >= 2 else None


INSIGHTS_SYSTEM = """你是中文播客的知识编辑。任务：从整期逐字稿里提炼「值得读者记住的知识卡片」。
只输出 JSON：{"insights":[{"category":"method|case|takeaway","title":"","content":"","entities":[""],"start_ms":0,"raw":""}]}

硬性要求：
1. 一共 4–8 条，宁少勿滥；没有就少给，不许凑数。
2. title 必须是一句**完整的判断句**（12–26 字），能独立成立；
   绝对不能只是品牌名、产品名、人名、行业词（例如"品牌""产品""九阳"这种一律不合格）。
3. content 2–4 句、40–160 字，必须带完整中文标点；
   要写清：发生了什么 / 为什么 / 意味着什么。不能是半句话，不能用「…」掩盖截断。
4. raw 必须是逐字稿里**真实出现过的一段原文**（可跨 1–3 句），用于回溯核对；
   start_ms 取 raw 第一句的时间码，必须是原文里真实存在的数字。
5. 专有名词（公司/品牌/产品/人名）必须与 raw 原文一致；
   如果怀疑识别有误但无法确认，就保留原样并在 title/content 里避开它，不要猜。
6. 分类标准：
   - method：节目里明确的做法、策略、步骤、建议（企业采取的具体措施也算）
   - case：有背景、有数据、有结果的真实案例/事件/人物经历
   - takeaway：能让人「多懂一点」的行业知识、机制、规律、判断
   普通新闻播报、节目流程、开场寒暄不要收录。
7. 数字、金额、百分比、年份一律照抄原文，不得换算或改写。
"""


def build_insights_with_llm(title, segments):
    """单独一次调用：产出结构化精华（分类 + 完整标题 + 完整正文 + 原文回溯）。"""
    refresh_llm_config()
    if not LLM_KEY or not segments:
        return None
    lines = "\n".join(f"[{int(s['start_ms'])}] {s['text']}" for s in segments)
    try:
        out = _llm_chat(
            [{"role": "system", "content": INSIGHTS_SYSTEM},
             {"role": "user", "content": f"节目：《{title}》\n\n逐字稿（[毫秒] 正文）：\n{lines}"}],
            temperature=0.35,
            max_tokens=4000,
        )
        st, en = out.find("{"), out.rfind("}")
        data = json.loads(out[st : en + 1])
    except Exception as e:  # noqa: BLE001
        print(f"[insights] llm failed: {e}", flush=True)
        return None

    raw_all = "".join(s["text"] for s in segments)
    kept = []
    for i, it in enumerate(data.get("insights") or []):
        cat = str(it.get("category", "")).strip()
        if cat not in ("method", "case", "takeaway"):
            continue
        title = str(it.get("title", "")).strip()
        content = str(it.get("content", "")).strip()
        raw = str(it.get("raw", "")).strip()
        ms = _norm_ms(it.get("start_ms", 0))
        # 质量闸门
        if len(title) < 10 or len(content) < 30 or not ms:
            continue
        if not re.search(r"[。！？；，]", content):
            continue
        if content.endswith(("…", "...", "、")) or "……" in content:
            continue
        # title 不能是纯实体（没有动词/判断意味）
        if re.fullmatch(r"[\u4e00-\u9fa5A-Za-z0-9·\s]{2,8}", title):
            continue
        # raw 必须能在原文里找到（允许空白差异）
        probe = re.sub(r"\s", "", raw)[:24]
        if probe and probe not in re.sub(r"\s", "", raw_all):
            continue
        kept.append({
            "id": f"ins-{len(kept) + 1}",
            "category": cat,
            "title": title[:40],
            "content": content[:400],
            "entities": [str(x)[:16] for x in (it.get("entities") or [])][:4],
            "start_ms": ms,
            "raw": raw[:400],
        })
        if len(kept) >= 8:
            break
    return kept or None


STRUCT_SYSTEM = """你是中文商业播客的内容主编。先理解整期节目，再给出结构、主题和思考题。
只输出 JSON：
{"chapters":[{"title":"","summary":"","start_ms":0,"end_ms":0,"nodes":[""],"kind":"news|feature|intro|outro"}],
 "topics":[{"term":"","weight":1,"kind":"theme|concept|entity"}],
 "questions":[{"q":"","why":""}],
 "methods":[{"title":"","content":"","start_ms":0,"raw":""}]}

章节要求：
1. 该期若含「资讯速览 + 主专题」，必须分开成不同章节，资讯章节的 title 写「商业资讯速览」，summary 里列出各条新闻（一句话一条）。
2. 章节按内容切，不按固定时长切；每章 start_ms/end_ms 取原文里真实出现过的时间码。
3. nodes 是 2–4 个内容节点，每个不超过 24 字，描述该章讲了什么，不要复述整段原文。
4. 章节标题必须是一句能读通的中文短语（如「方便面销量下滑但巨头利润增长」），
   严禁写成「比亚迪 · 沃尔玛」「零食 · 合作」这种两个名词用间隔号拼接；
5. 章节的 summary 与 nodes 必须是整理过的简体中文，带标点，不要直接抄 ASR 原句。

主题词云要求：
6. 8–14 个主题，weight 1–5（5 最重要）；kind 分 theme（主主题）、concept（概念）、entity（品牌/公司/人名）。
6. 同义词合并（汉堡/漢堡、Pizza/披萨）；"品牌""产品""消费者"这类泛词权重低或不要。
7. 资讯板块的实体与主专题的实体不要混成一个平面，主专题的词权重更高。

思考题要求：
8. 2–5 个，必须扣住本期具体事实或判断（提到具体品牌、模式、数字），不能是可以套用到任何节目的通用问题。
9. 每题配 why（一句背景，说明为什么值得想）。

方法与行动要求：
10. 只收真正可执行的方法/策略/步骤；行业现象、新闻、市场数据不算。没有就返回空数组。
"""


def build_structure_with_llm(title, segments):
    """一次调用，产出章节结构 / 主题词云 / 思考题 / 方法建议。"""
    refresh_llm_config()
    if not LLM_KEY or not segments:
        return None
    lines = "\n".join(f"[{int(s['start_ms'])}] {s['text']}" for s in segments)
    try:
        out = _llm_chat(
            [{"role": "system", "content": STRUCT_SYSTEM},
             {"role": "user", "content": f"节目：《{title}》\n\n逐字稿（[毫秒] 正文）：\n{lines}"}],
            temperature=0.3,
            max_tokens=4000,
        )
        st, en = out.find("{"), out.rfind("}")
        data = json.loads(out[st : en + 1])
    except Exception as e:  # noqa: BLE001
        print(f"[struct] llm failed: {e}", flush=True)
        return None

    chapters = []
    for c in data.get("chapters") or []:
        title_ = str(c.get("title", "")).strip()
        if not title_:
            continue
        chapters.append({
            "title": title_[:30],
            "summary": str(c.get("summary", ""))[:220],
            "start_ms": _norm_ms(c.get("start_ms", 0)),
            "end_ms": _norm_ms(c.get("end_ms", 0)),
            "nodes": [str(x)[:24] for x in (c.get("nodes") or [])][:4],
            "kind": c.get("kind") if c.get("kind") in ("news", "feature", "intro", "outro") else "feature",
        })

    topics = []
    for t in data.get("topics") or []:
        term = str(t.get("term", "")).strip()
        if not term or len(term) > 10:
            continue
        topics.append({
            "term": term,
            "weight": max(1, min(5, int(t.get("weight") or 3))),
            "kind": t.get("kind") if t.get("kind") in ("theme", "concept", "entity") else "concept",
        })

    questions = []
    for q in data.get("questions") or []:
        text = str(q.get("q", "")).strip()
        if len(text) < 12:
            continue
        questions.append({"q": text[:120], "why": str(q.get("why", ""))[:120]})

    methods = []
    for m in data.get("methods") or []:
        mt = str(m.get("title", "")).strip()
        mc = str(m.get("content", "")).strip()
        ms = _norm_ms(m.get("start_ms", 0))
        if len(mt) < 6 or len(mc) < 20 or not ms:
            continue
        methods.append({"title": mt[:40], "content": mc[:300], "start_ms": ms,
                        "raw": str(m.get("raw", ""))[:300]})

    return {"chapters": chapters, "topics": topics, "questions": questions, "methods": methods}


def _merge_window_results(results):
    """把分窗结果合成一期：章节接续、文章合并、观点/金句去重、主题加权取前 12。"""
    merged = {
        "chapters": [], "takeaways": [], "quotes": [], "actions": [], "examples": [],
        "questions": [], "insights": [], "keywords": [], "article": None,
        "overview": None, "mindmap": None, "llm": True,
        "quality_note": f"由大模型分窗整理（{len(results)} 段分析后合并）",
    }
    secs = []
    qset, tset, iset = set(), set(), set()
    kw = {}
    qs = []

    for r in results:
        for c in r.get("chapters") or []:
            merged["chapters"].append(c)
        for t in r.get("takeaways") or []:
            key = (t.get("title") or "")[:12]
            if key and key not in tset:
                tset.add(key)
                merged["takeaways"].append(t)
        for q in r.get("quotes") or []:
            key = (q.get("text") or "")[:12]
            if key and key not in qset:
                qset.add(key)
                merged["quotes"].append(q)
        for a in r.get("actions") or []:
            merged["actions"].append(a)
        for e in r.get("examples") or []:
            merged["examples"].append(e)
        for q in r.get("questions") or []:
            txt = q.get("q") if isinstance(q, dict) else q
            if txt and txt not in " ".join(qs):
                qs.append(q)
        for i in r.get("insights") or []:
            key = (i.get("title") or "")[:12]
            if key and key not in iset:
                iset.add(key)
                merged["insights"].append(i)
        for k in r.get("keywords") or []:
            term = k.get("term")
            if not term:
                continue
            cur = kw.get(term)
            w = int(k.get("weight") or 3)
            if cur:
                cur["weight"] = min(5, max(cur["weight"], w))
            else:
                kw[term] = {"term": term, "brief": k.get("brief", ""), "weight": w, "kind": k.get("kind", "concept")}
        art = r.get("article")
        if art and art.get("sections"):
            secs.extend(art["sections"])

    if secs:
        for i, sec in enumerate(secs):
            sec["id"] = f"sec-{i + 1}"
        merged["article"] = {
            "title": secs[0].get("title") or "这一期",
            "intro": (results[0].get("article") or {}).get("intro", ""),
            "sections": secs[:24],
        }
    merged["questions"] = qs[:5]
    merged["keywords"] = sorted(kw.values(), key=lambda x: -x["weight"])[:12]
    merged["overview"] = next((r.get("overview") for r in results if r.get("overview")), None)
    merged["chapters"].sort(key=lambda c: int(c.get("start_ms") or 0))
    merged["takeaways"].sort(key=lambda t: int(t.get("start_ms") or 0))
    merged["quotes"].sort(key=lambda q: int(q.get("start_ms") or 0))
    merged["insights"].sort(key=lambda i: int(i.get("start_ms") or 0))
    merged["mindmap"] = mindmap_from_article(merged["article"])
    return merged


def analyze_windowed(title, segments, window_ms=None):
    """长稿必须分窗：一次塞 400 段，模型的 JSON 会被截断，结果是全军覆没。"""
    total = int(segments[-1].get("start_ms", 0)) if segments else 0
    # 自适应窗口：40 分钟内 10 分钟一窗；1–2 小时 15 分钟；2 小时以上 20 分钟
    if window_ms is None:
        if total > 120 * 60 * 1000:
            window_ms = 15 * 60 * 1000
        elif total > 60 * 60 * 1000:
            window_ms = 15 * 60 * 1000
        else:
            window_ms = 10 * 60 * 1000
    results = []
    for start in range(0, total + 1, window_ms):
        chunk = [x for x in segments if start <= int(x.get("start_ms", 0)) < start + window_ms]
        if len(chunk) < 5:
            continue
        base = analyze(title, chunk)
        try:
            results.append(analyze_with_llm(title, chunk, base))
            print(f"[window] {start // 60000}-{(start + window_ms) // 60000} 分钟：{len(chunk)} 段 OK", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[window] {start // 60000} 分钟失败: {e}", flush=True)
    if not results:
        return None
    return _merge_window_results(results)


ENTITY_SYSTEM = """你是中文播客的校对。任务：找出逐字稿里同一个专有名词的不同写法（同音/近音误识别）。
只输出 JSON：{"entities":[{"canonical":"正确写法","variants":["错写1","错写2"],"type":"company|brand|person|product|term"}]}

规则：
1. 只处理专有名词（公司、品牌、产品、人名、机构、专有术语），不要动普通词语。
2. 同一实体在文中有多种写法时才输出；只有一种写法就不用列。
3. canonical 取文中出现次数最多、且最像正确名称的那个；拿不准就整条不要输出。
4. variants 必须真的在原文里出现过（逐字），不要臆造。
5. 最多 12 组；宁可少，不要错。
"""


def build_entity_map(title, segments, max_chars=12000):
    """找出同一实体的不同写法，返回 {variant: canonical}。"""
    refresh_llm_config()
    if not LLM_KEY or not segments:
        return {}
    text = "".join(x["text"] for x in segments)[:max_chars]
    try:
        out = _llm_chat(
            [{"role": "system", "content": ENTITY_SYSTEM},
             {"role": "user", "content": f"节目：《{title}》\n\n逐字稿：\n{text}"}],
            temperature=0.1,
            max_tokens=1500,
        )
        st, en = out.find("{"), out.rfind("}")
        data = json.loads(out[st : en + 1])
    except Exception as e:  # noqa: BLE001
        print(f"[entity] llm failed: {e}", flush=True)
        return {}

    mapping = {}
    for ent in data.get("entities") or []:
        canon = str(ent.get("canonical", "")).strip()
        if len(canon) < 2:
            continue
        for v in ent.get("variants") or []:
            v = str(v).strip()
            if len(v) < 2 or v == canon:
                continue
            # 只替换长度接近、且原文确实出现过的写法
            if abs(len(v) - len(canon)) > 1:
                continue
            if v not in text:
                continue
            mapping[v] = canon
    return mapping


def apply_entity_map(segments, mapping):
    """把错写统一成规范写法；原始文本仍保留在调用方传入的副本里。"""
    if not mapping:
        return segments, 0
    n = 0
    out = []
    for s in segments:
        t = s["text"]
        for bad, good in mapping.items():
            if bad in t:
                n += t.count(bad)
                t = t.replace(bad, good)
        out.append({**s, "text": t})
    return out, n


def mindmap_from_article(article):
    """导图与文章同构：一级=章节，二级=该节的标签/要点，时间码取该节出处。"""
    if not article or not article.get("sections"):
        return None
    GREET = re.compile(r"^(大家好|各位好|你好|欢迎|我是|这里是|早上好|晚上好|哈喽|hello|hi\b)", re.I)
    kids = []
    for sec in article["sections"][:6]:
        if GREET.search(sec["title"].strip()) or GREET.search(sec["content"].strip()[:8]):
            continue
        src = (sec.get("sources") or [{}])[0]
        start = int(src.get("start_ms") or 0)
        leaves = [t for t in (sec.get("tags") or []) if t][:3]
        if not leaves:
            leaves = [x.strip()[:12] for x in re.split(r"[，、；]", sec.get("summary", "")) if 2 <= len(x.strip()) <= 14][:3]
        node = {"name": sec["title"][:18], "start_ms": start}
        if leaves:
            node["children"] = [{"name": t, "start_ms": start} for t in leaves]
        kids.append(node)
    if len(kids) < 2:
        return None
    return {"name": (article.get("title") or "这一期")[:14], "start_ms": 0, "children": kids}


def mindmap_from_chapters(title, chapters):
    """没有逐字稿级导图时，用章节 + 要点拼一张两层图，保证页面上一定有东西看"""
    if not chapters:
        return None
    branches = []
    for c in chapters[:6]:
        kids = [{"name": p[:22], "start_ms": c.get("start_ms", 0)} for p in (c.get("points") or [])[:3] if p]
        branches.append({"name": c["title"][:20], "start_ms": c.get("start_ms", 0), "children": kids} if kids
                        else {"name": c["title"][:20], "start_ms": c.get("start_ms", 0)})
    if len(branches) < 2:
        return None
    return {"name": first_clause(title, 14) or title, "start_ms": 0, "children": branches}


def _norm_cmp(t):
    return re.sub(r"[\s，。！？、；：,.;:!?\"'“”‘’]", "", t or "")


def evidence_at(segments, ms, n=2):
    """取该时间点之后 n 段原文，作为观点的真实依据。"""
    idx = 0
    for i, s in enumerate(segments):
        if int(s.get("start_ms", 0)) <= ms:
            idx = i
        else:
            break
    return "".join(x["text"] for x in segments[idx : idx + n])[:200]


QUOTE_HINT = re.compile(r"(其实|本质|关键|真正的|反而|意味着|不是.*而是|才会|才能|说白了|说到底|问题是|原因)")


def quotes_from_edited(edited, segments):
    """金句只从「编辑版」里整句挑选：完整、有标点、能逐字对回原文。"""
    if not edited or not edited.get("chapters"):
        return None
    raw = _norm_cmp("".join(x["text"] for x in segments))
    picks = []
    seen = set()
    for ch in edited["chapters"]:
        for para in ch["paragraphs"]:
            base = int(para.get("t") or 0)
            parts = re.split(r"(?<=[。！？])", para["text"])
            offset = 0
            for sent in parts:
                txt = sent.strip()
                if len(txt) < 18 or len(txt) > 70:
                    offset += len(sent)
                    continue
                if not re.search(r"[。！？]$", txt):
                    offset += len(sent)
                    continue
                if not QUOTE_HINT.search(txt):
                    offset += len(sent)
                    continue
                key = _norm_cmp(txt)[:16]
                if key in seen:
                    offset += len(sent)
                    continue
                # 逐字校验：去掉标点后必须原样出现在 ASR 里
                if key not in raw:
                    offset += len(sent)
                    continue
                # 严格：这句话必须完整落在某个原始片段内（不是跨段拼出来的）
                if not any(key in _norm_cmp(x["text"]) and len(_norm_cmp(x["text"])) - len(key) <= 30
                           for x in segments):
                    offset += len(sent)
                    continue
                seen.add(key)
                # 粗粒度时间：段落起点 + 按字数比例估算（明确标注为段落级）
                est = base + int(len(para["text"][:offset]) / max(len(para["text"]), 1) * 40000)
                picks.append({"text": txt, "start_ms": est, "level": "paragraph"})
                offset += len(sent)
    if not picks:
        return []
    # 句尾校验：以这些词收尾的一定是被截断的半句，直接丢弃
    DANGLING = ("表示", "因为", "但是", "而", "的", "和", "在", "是", "就", "也", "还",
                "比如", "以及", "如果", "虽然", "然后", "所以", "这种", "这个", "一个",
                "我们", "他们", "可以", "就是", "依然", "仍然", "并且", "而且")
    clean = [p for p in picks if not p["text"].rstrip("。！？").endswith(DANGLING)]
    if not clean:
        return []
    clean.sort(key=lambda x: x["start_ms"])
    step = max(1, len(clean) // 6)
    return clean[::step][:6]


TRAD2SIMP = str.maketrans({
    "態": "态", "緊": "紧", "偽": "伪", "貴": "贵", "亞": "亚", "當": "当", "為": "为",
    "這": "这", "個": "个", "們": "们", "說": "说", "時": "时", "後": "后", "裡": "里",
    "來": "来", "對": "对", "會": "会", "實": "实", "際": "际", "開": "开", "關": "关",
    "麼": "么", "過": "过", "還": "还", "現": "现", "經": "经", "從": "从", "問": "问",
    "題": "题", "醫": "医", "產": "产", "務": "务", "場": "场", "點": "点", "總": "总",
    "體": "体", "發": "发", "現": "现", "眾": "众", "學": "学", "樂": "乐", "國": "国",
    "設": "设", "團": "团", "開": "开", "運": "运", "業": "业", "績": "绩", "競": "竞",
    "營": "营", "佈": "布", "網": "网", "產": "产", "銷": "销", "價": "价", "漲": "涨",
    "購": "购", "費": "费", "額": "额", "億": "亿", "萬": "万", "賺": "赚", "虧": "亏",
    "財": "财", "報": "报", "據": "据", "數": "数", "據": "据", "標": "标", "準": "准",
    "範": "范", "圍": "围", "準": "准", "確": "确", "認": "认", "識": "识", "類": "类",
    "際": "际", "與": "与", "將": "将", "於": "于", "僅": "仅", "從": "从", "隨": "随",
    "著": "着", "顯": "显", "較": "较", "變": "变", "動": "动", "態": "态", "勢": "势",
    "場": "场", "層": "层", "級": "级", "統": "统", "織": "织", "構": "构", "組": "组",
    "織": "织", "機": "机", "構": "构", "熱": "热", "門": "门", "題": "题", "價": "价",
    "貴": "贵", "鑽": "钻", "飾": "饰", "項": "项", "鏈": "链", "虛": "虚", "擬": "拟",
    "據": "据", "預": "预", "測": "测", "溫": "温", "跌": "跌",
    "雞": "鸡", "鴨": "鸭", "貓": "猫", "豬": "猪", "鳥": "鸟", "龍": "龙", "鳳": "凤",
})


def normalize_evidence(res, segments, edited):
    """依据/金句统一成简体 + 用编辑版里带标点的段落替换裸 ASR。"""
    paras = []
    if edited and edited.get("chapters"):
        for ch in edited["chapters"]:
            for p in ch["paragraphs"]:
                paras.append((int(p.get("t") or 0), p["text"]))
    paras.sort(key=lambda x: x[0])

    def clean(txt):
        return (txt or "").translate(TRAD2SIMP)

    def punctuated_at(ms):
        if not paras:
            return None
        best = None
        for t, text in paras:
            if t <= ms + 3000:
                best = text
            else:
                break
        return best

    for t in res.get("takeaways") or []:
        seg = punctuated_at(int(t.get("start_ms") or 0))
        t["evidence"] = clean(seg or t.get("evidence"))
        t["title"] = clean(t.get("title"))
        t["explain"] = clean(t.get("explain"))

    for q in res.get("quotes") or []:
        q["text"] = clean(q.get("text"))

    # 章节与要点：同样清繁简、去残句
    for ch in res.get("chapters") or []:
        ch["title"] = clean(ch.get("title"))
        if ch.get("core"):
            ch["core"] = clean(ch.get("core"))
        pts = []
        for pt in ch.get("points") or []:
            t = clean(str(pt)).strip(" ·，,。；;")
            if len(t) < 4:
                continue
            # 结尾是悬空词就丢掉这半句
            if t.endswith(("的", "而", "和", "在", "是", "也", "就", "还", "但", "因为", "所以")):
                continue
            pts.append(t)
        ch["points"] = pts[:4]

    art = res.get("article")
    if art:
        art["title"] = clean(art.get("title"))
        art["intro"] = clean(art.get("intro"))
        for sec in art.get("sections") or []:
            sec["title"] = clean(sec.get("title"))
            sec["summary"] = clean(sec.get("summary"))
            sec["content"] = clean(sec.get("content"))

    for i in res.get("insights") or []:
        i["title"] = clean(i.get("title"))
        i["content"] = clean(i.get("content"))
        i["raw"] = clean(i.get("raw"))

    return res


def fix_citations(segments, res):
    """观点/金句的来源校验：依据必须落在原文里，金句必须逐字存在。"""
    raw = _norm_cmp("".join(x["text"] for x in segments))
    takes = []
    for t in res.get("takeaways") or []:
        ms = int(t.get("start_ms") or 0)
        ev = str(t.get("evidence") or "")
        if not ms:
            continue
        if not ev or _norm_cmp(ev)[:16] not in raw:
            ev = evidence_at(segments, ms)
        takes.append({**t, "evidence": ev, "start_ms": ms})
    res["takeaways"] = takes

    # 原始 ASR 没有标点时，"整句"其实都是被切开的半句——这时宁可不给金句
    punctuated = sum(1 for x in segments if re.search(r"[。！？；，,]", x["text"]))
    if segments and punctuated / len(segments) < 0.4:
        res["quotes"] = []
        res["quotes_status"] = "needs_proofread"
        return res

    quotes = []
    for q in res.get("quotes") or []:
        txt = str(q.get("text") or "").strip()
        ms = int(q.get("start_ms") or 0)
        if len(txt) < 10 or not ms:
            continue
        probe = _norm_cmp(txt)[:18]
        if probe not in raw:
            continue  # 不是原话，宁可不展示
        # 必须是完整收尾的句子，半句/被截断的一律不要
        if not re.search(r"[。！？!?]$", txt):
            continue
        # 长句必须有内部标点，否则就是把一段话硬切成一句
        if len(txt) > 22 and len(re.findall(r"[，、；：,;]", txt)) < 1:
            continue
        # 必须能对回该时间点附近的原文，防止"引用一段别处的话"
        near = "".join(x["text"] for x in segments if abs(int(x.get("start_ms", 0)) - ms) <= 6000)
        if _norm_cmp(txt)[:10] not in _norm_cmp(near):
            continue
        quotes.append({**q, "text": txt, "start_ms": ms})
    res["quotes"] = quotes
    return res


def analyze(title, segments):
    items = []
    for s in segments:
        text = clean_text(s.get("text", ""))
        if len(text) < 2:
            continue
        items.append({
            "start_ms": int(s.get("start_ms", 0)),
            "end_ms": int(s.get("end_ms", 0)) or None,
            "text": _strip_loops(text),
            "gist": first_clause(text, 18),
        })
    texts = [i["text"] for i in items]
    weights = keyword_weights(texts)
    scored = score_sentences(texts, weights)

    units = _sentence_units(items)
    paragraphs = build_paragraphs(units)
    chapters = build_chapters(paragraphs, title or "")
    overview = build_overview(title or "", units, chapters, weights)

    # 给段落补上所属章节的标题，逐字稿里就能看到「这一段在讲什么」
    for p in paragraphs:
        ch = next((c for c in chapters if c["start_ms"] <= p["start_ms"] <= c["end_ms"]), None)
        if ch:
            p["topic"] = ch["title"]

    article_fallback = None
    if chapters:
        article_fallback = {
            "title": title or "这一期",
            "intro": (overview or {}).get("one_line", ""),
            "sections": [
                {
                    "id": f"sec-{i + 1}",
                    "title": c["title"],
                    "summary": c.get("core", ""),
                    "content": "\n\n".join(
                        [p["text"] for p in paragraphs if c["start_ms"] <= p["start_ms"] <= c["end_ms"]][:4]
                    ) or c.get("core", ""),
                    "tags": [],
                    "sources": [{"start_ms": c["start_ms"], "end_ms": c.get("end_ms") or c["start_ms"] + 60000}],
                }
                for i, c in enumerate(chapters[:6])
            ],
        }

    return {
        "article": article_fallback,
        "items": paragraphs,
        "chapters": chapters,
        "overview": overview,
        "takeaways": build_takeaways(units, weights, chapters),
        "quotes": _pick_quotes(units, weights),
        "actions": build_actions(units),
        "examples": build_examples(units),
        "questions": build_questions(units, weights, title or ""),
        # 兼容旧字段
        "summary": (overview or {}).get("one_line", ""),
        "keywords": keywords_of(texts, weights, 8),
        "highlights": [
            {"start_ms": units[h["idx"]]["start_ms"], "text": h["text"]}
            for h in build_highlights(scored)[:5]
            if h["idx"] < len(units)
        ],
        "mindmap": build_mindmap(title or "", items, weights) or mindmap_from_chapters(title or "", chapters),
    }


# ────────────────────────── 转写入口 ──────────────────────────

def _strip_loops(text: str) -> str:
    """去掉 ASR 常见的复读：同一短语连续出现 4 次以上只留一次。"""
    if not text:
        return text
    t = re.sub(r"(.{2,8}?)\1{3,}", r"\1", text)
    return t

def _group_segments(segs):
    """没有逐词时间码时，用句读把字幕片段合成「一句完整的话」。"""
    out = []
    buf = ""
    start = None
    end = None
    for s in segs:
        t = s["text"].strip()
        if not t:
            continue
        if start is None:
            start = s["start"]
        buf += t
        end = s["end"]
        if len(buf) >= 12 and (t[-1] in "。！？!?；;" or len(buf) >= 42):
            out.append({"start": start, "end": end, "text": buf})
            buf, start = "", None
    if buf:
        if out and len(buf) < 10:
            out[-1]["text"] += buf
            out[-1]["end"] = end
        else:
            out.append({"start": start or 0, "end": end or 0, "text": buf})
    return out


def _group_words(words, max_chars=56):
    """把词级时间戳拼成句：遇到句末标点或长度够了就断句，时间戳取首词与末词。"""
    out = []
    buf = []
    for w in words:
        t = (w.get("word") or "").strip()
        if not t:
            continue
        buf.append(w)
        joined = "".join((x.get("word") or "").strip() for x in buf)
        if len(joined) >= max_chars or re.search(r"[。！？!?…]$", t):
            out.append(
                {
                    "start": float(buf[0].get("start", 0)),
                    "end": float(buf[-1].get("end", buf[-1].get("start", 0))),
                    "text": joined,
                }
            )
            buf = []
    if buf:
        joined = "".join((x.get("word") or "").strip() for x in buf)
        out.append({"start": float(buf[0].get("start", 0)), "end": float(buf[-1].get("end", 0)), "text": joined})
    return [o for o in out if o["text"]]


def _read_pcm(path):
    """读 16k 单声道 wav → float32 ndarray。这样 mlx 不需要外部 ffmpeg。"""
    import wave
    import numpy as np

    with wave.open(path, "rb") as w:
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe_wav(wav, lang="zh"):
    global _backend
    if _backend == "mlx":
        import mlx_whisper

        r = mlx_whisper.transcribe(
            _read_pcm(wav),
            path_or_hf_repo=MLX_MODEL,
            language=lang,
            word_timestamps=False,  # 逐词时间戳要多跑一遍对齐，慢 3 倍；句级时间码够用
            condition_on_previous_text=False,
            verbose=False,
        )
        segs = [
            {"start": float(s["start"]), "end": float(s["end"]), "text": s["text"].strip()}
            for s in r.get("segments", [])
            if s.get("text", "").strip()
        ]
        return _group_segments(segs)

    segs, _info = _model.transcribe(
        wav,
        language=lang,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        beam_size=1,
        condition_on_previous_text=False,
    )
    return [{"start": float(s.start), "end": float(s.end), "text": (s.text or "").strip()} for s in segs if (s.text or "").strip()]


# ────────────────────────── 可选：大模型整理 ──────────────────────────
LLM_KEY = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("PM_LLM_API_KEY") or ""
LLM_BASE = os.environ.get("PM_LLM_BASE", "https://api.deepseek.com")
LLM_MODEL = os.environ.get("PM_LLM_MODEL", "deepseek-chat")
_ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local")
_env_mtime = 0.0


def refresh_llm_config():
    """每次整理前看一眼 .env.local：改完 key 不用重启任何服务，下一次点击就生效。"""
    global LLM_KEY, LLM_BASE, LLM_MODEL, _env_mtime
    try:
        mtime = os.path.getmtime(_ENV_PATH)
    except OSError:
        return
    if mtime == _env_mtime:
        return
    _env_mtime = mtime
    try:
        with open(_ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'").lstrip("=").strip()
                if k in ("DEEPSEEK_API_KEY", "PM_LLM_API_KEY") and v:
                    LLM_KEY = v
                elif k == "PM_LLM_BASE" and v:
                    LLM_BASE = v
                elif k == "PM_LLM_MODEL" and v:
                    LLM_MODEL = v
    except OSError:
        pass

SYSTEM_PROMPT = """你是中文播客的编辑。用户会给你一整期的逐字稿（带 [分:秒] 时间码的段落）。
请严格按下面的结构与要求，只输出 JSON，不要解释、不要代码围栏。

{
 "article":{"title":"专题文章标题（可脱离原节目标题）","intro":"导语，2-3 句，说清这期在讲什么、为什么值得读",
   "sections":[{"title":"章节标题","summary":"一句话概括这一节","content":"这一节的正文，2-5 段，段与段之间用 \\n\\n 分隔","tags":["主题标签"],"sources":[{"start_ms":毫秒,"end_ms":毫秒}]}]},
 "chapters":[{"title":"章节标题","start_ms":秒*1000,"end_ms":秒*1000,"core":"这一章讲了什么（一句话）","points":["关键点"],"quotes":["本章的一句原话"]}],
 "overview":{"one_line":"一句话总结整期核心主题","background":["讨论缘起/背景"],"core":[{"title":"话题模块","point":"这一模块讲了什么","start_ms":毫秒}],"conclusion":"节目最后真正想传达的观点","audience":"适合什么人、什么场景听"},
 "takeaways":[{"title":"观点标题（有信息量的判断句）","explain":"2-4 句解释","evidence":"嘉宾原话或案例作依据","start_ms":毫秒}],
 "quotes":[{"text":"必须逐字来自原文的原话","start_ms":毫秒}],
 "actions":[{"text":"具体方法/步骤","start_ms":毫秒,"declared":true}],
 "examples":[{"text":"具体案例/故事","start_ms":毫秒}],
 "questions":["值得听众结合自己经历思考的具体问题"],
 "keywords":[{"term":"术语/人名/概念","brief":"用一句话解释它在节目里的意思"}]
}

硬性要求：
00. article 是这一期的「知识文章」：先理解整期，再按**知识主题**重新组织（不是按说话顺序），
   4-6 节；每节写 2-5 段连贯的书面文章，能脱离音频独立阅读；
   不要用「主播提到」「嘉宾表示」「节目中聊到」这类转述句式，直接写内容本身；
   不要写成摘要或提纲，要保留事实、数字、人物、地点、故事和因果；
   每节必须给 sources（该节内容来自哪几段时间，必须是原文里真实出现过的时间码），
   跨段落整合的内容可以把多个时间段都列上；没有外部检索能力时不得补充节目之外的事实。
0. transcript 是「编辑版逐字稿」：先把整期按话题切成 4–8 个章节，
   每章写 2–6 个自然段，每段 2–5 句；段首的 t 必须取原文里真实出现过的时间码（就近取，不要自己算）。
   规则：补全标点（，。、；：？！""）、按语义断句；修正明显的同音错字与专有名词（如「方面面」→「方便面」、
   「康氏符合」→「康师傅和统一」），但只在上下文足够确定时改，把握不准就保留原文；
   数字、金额、年份、百分比一律照抄，不许换算或改写；
   只清理纯噪声的重复语气词，保留有表达意义的停顿、强调和口语；
   不得增删事实、不得把 AI 自己的话写进嘉宾嘴里。
0. segments 是把逐字稿按**语义**重新断句的结果：一句一个完整意思（一般 12–45 字），
   必须在句号/问号/感叹号处断开；不要把半句话、口头语碎片单独成句；
   text 必须**逐字照抄**原文（只能调整断句位置和标点，不许改写、合并不同段落的内容）；
   start_ms 取这句话在原文里出现的那一行的时间码。整期输出 30–120 条，覆盖全部内容，不要漏段。
1. 只能依据逐字稿内容，绝不编造没有出现的信息；听不清或不确定的地方原样保留，不要猜测。
2. 章节按话题变化切，3-6 个，标题要有信息量（不要「第一部分」「深入讨论」这种空标题）。
3. 观点 3-7 条，必须是原文支持的判断，禁止「保持积极心态」「坚持长期主义」这类空话。
4. 金句 3-8 条，必须逐字来自原文，保持原话，不要改写成你的话。
5. 方法/案例/问题：原文没有就不给空数组，不要硬造。
6. 时间码必须取自逐字稿里真实出现过的段落起点。
7. 全部用简体中文。"""


def _llm_chat(messages, temperature=0.3, max_tokens=4000):
    import json as _json
    import urllib.request

    body = _json.dumps({
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")
    req = urllib.request.Request(
        LLM_BASE.rstrip("/") + "/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {LLM_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = _json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def _stamp_lines(items, limit_chars=14000):
    lines = []
    used = 0
    for it in items:
        s = (it.get("start_ms") or 0) // 1000
        line = f"[{s // 60}:{s % 60:02d}] {it.get('text', '')}"
        if used + len(line) > limit_chars:
            break
        lines.append(line)
        used += len(line)
    return "\n".join(lines)


def analyze_with_llm(title, segments, fallback):
    """有 key 就走大模型；失败或没 key 就回退到规则版，并如实标注。"""
    refresh_llm_config()
    if not LLM_KEY:
        return {**fallback, "llm": False, "quality_note": "本地规则整理（未配置大模型 key）"}
    try:
        import json as _json
        import re as _re

        transcript = _stamp_lines(segments)
        user = f"节目名：《{title}》\n\n逐字稿：\n{transcript}"
        out = _llm_chat(
            [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}],
            temperature=0.3,
            max_tokens=8000,
        )
        start = out.find("{")
        end = out.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("no json")
        data = _json.loads(out[start : end + 1])

        def norm_ts(v):
            try:
                v = float(v)
            except Exception:  # noqa: BLE001
                return 0
            return int(v * 1000) if v < 100000 else int(v)

        edited = None
        raw_tr = data.get("transcript") or {}
        tr_chapters = []
        for ci, ch in enumerate(raw_tr.get("chapters") or []):
            paras = []
            for p in (ch.get("paragraphs") or []):
                txt = str(p.get("text", "")).strip()
                if len(txt) < 8:
                    continue
                paras.append({"t": _norm_ms(p.get("t", 0)), "text": txt[:1200]})
            if not paras:
                continue
            tr_chapters.append({
                "index": ci + 1,
                "title": str(ch.get("title", ""))[:30] or f"第 {ci + 1} 段",
                "summary": str(ch.get("summary", ""))[:120],
                "start_ms": norm_ts(ch.get("start_ms", 0)) or paras[0]["t"],
                "end_ms": norm_ts(ch.get("end_ms", 0)) or paras[-1]["t"],
                "paragraphs": paras,
            })
        if len(tr_chapters) >= 2:
            edited = {"chapters": tr_chapters[:10]}

        raw_article = data.get("article") or {}
        article_sections = []
        for idx, sec in enumerate(raw_article.get("sections") or []):
            title = str(sec.get("title", "")).strip()
            content = str(sec.get("content", "")).strip()
            if not title or len(content) < 40:
                continue
            srcs = []
            for src in (sec.get("sources") or [])[:4]:
                st = norm_ts(src.get("start_ms", 0))
                en = norm_ts(src.get("end_ms", 0)) or st + 60000
                if st > 0 and en > st:
                    srcs.append({"start_ms": st, "end_ms": en})
            article_sections.append({
                "id": f"sec-{idx + 1}",
                "title": title[:40],
                "summary": str(sec.get("summary", ""))[:120],
                "content": content[:3000],
                "tags": [str(t)[:12] for t in (sec.get("tags") or [])][:5],
                "sources": srcs,
            })
        article = None
        if article_sections:
            article = {
                "title": str(raw_article.get("title", ""))[:60] or title,
                "intro": str(raw_article.get("intro", ""))[:300],
                "sections": article_sections[:6],
            }

        segs_out = []
        for sgm in (data.get("segments") or []):
            t = str(sgm.get("text", "")).strip()
            if len(t) < 4:
                continue
            segs_out.append({"start_ms": norm_ts(sgm.get("start_ms", 0)), "text": t})
        segs_out = segs_out[:400]

        chapters = [
            {
                "title": str(c.get("title", ""))[:28],
                "start_ms": norm_ts(c.get("start_ms", 0)),
                "end_ms": norm_ts(c.get("end_ms", 0)) or None,
                "core": str(c.get("core", ""))[:120],
                "points": [str(p)[:80] for p in (c.get("points") or [])][:4],
                "quotes": [str(q)[:80] for q in (c.get("quotes") or [])][:2],
            }
            for c in (data.get("chapters") or []) if c.get("title")
        ]

        ov = data.get("overview") or {}
        overview = {
            "one_line": str(ov.get("one_line", ""))[:160],
            "background": [str(x)[:160] for x in (ov.get("background") or [])][:3],
            "core": [
                {"title": str(x.get("title", ""))[:28], "point": str(x.get("point", ""))[:160], "start_ms": norm_ts(x.get("start_ms", 0))}
                for x in (ov.get("core") or []) if x.get("title")
            ][:6],
            "conclusion": str(ov.get("conclusion", ""))[:220],
            "audience": str(ov.get("audience", ""))[:160],
            "incomplete": False,
        }

        takeaways = [
            {
                "title": str(t.get("title", ""))[:40],
                "explain": str(t.get("explain", ""))[:220],
                "evidence": str(t.get("evidence", ""))[:160],
                "start_ms": norm_ts(t.get("start_ms", 0)),
            }
            for t in (data.get("takeaways") or []) if t.get("title")
        ][:7]

        quotes = [
            {"text": str(q.get("text", ""))[:160], "start_ms": norm_ts(q.get("start_ms", 0))}
            for q in (data.get("quotes") or []) if q.get("text")
        ][:8]

        actions = [
            {"text": str(a.get("text", ""))[:160], "start_ms": norm_ts(a.get("start_ms", 0)), "declared": bool(a.get("declared", True))}
            for a in (data.get("actions") or []) if a.get("text")
        ][:6]

        examples = [
            {"text": str(e.get("text", ""))[:200], "start_ms": norm_ts(e.get("start_ms", 0))}
            for e in (data.get("examples") or []) if e.get("text")
        ][:5]

        questions = [str(q)[:120] for q in (data.get("questions") or [])][:4]
        keywords = [
            {"term": str(k.get("term", ""))[:20], "brief": str(k.get("brief", ""))[:120]}
            for k in (data.get("keywords") or []) if k.get("term")
        ][:8]

        merged = {
            **fallback,
            "article": article,
            "edited_transcript": edited,
            "mindmap": mindmap_from_article(article) or fallback.get("mindmap"),
            "segments": segs_out or None,
            "chapters": chapters or fallback.get("chapters", []),
            "overview": overview if overview.get("one_line") else fallback.get("overview"),
            "takeaways": takeaways or fallback.get("takeaways", []),
            "quotes": quotes or fallback.get("quotes", []),
            "actions": actions,
            "examples": examples,
            "questions": questions or fallback.get("questions", []),
            "keywords": keywords or fallback.get("keywords", []),
            "summary": (overview or {}).get("one_line") or fallback.get("summary", ""),
            "llm": True,
            "quality_note": f"由大模型 {LLM_MODEL} 依据完整逐字稿整理",
        }
        return fix_citations(segments, merged)
        return merged
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"[llm] failed: {e}\n")
        return {**fallback, "llm": False, "quality_note": f"大模型调用失败，已回退本地规则：{str(e)[:80]}"}


# ────────────────────────── HTTP ──────────────────────────
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 安静点，别把 Next 的日志刷满
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            refresh_llm_config()
            self._json(200, {"ok": True, "ready": _ready, "model": MLX_MODEL if _backend == "mlx" else MODEL_SIZE, "backend": _backend, "llm": bool(LLM_KEY), "error": _load_error})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:  # noqa: BLE001
            return self._json(400, {"error": "bad json"})

        if self.path == "/asr":
            wav = payload.get("wav") or ""
            if not wav or not os.path.exists(wav):
                return self._json(400, {"error": "wav missing"})
            if not _ready or _model is None:
                return self._json(503, {"error": _load_error or "model not ready"})
            lang = payload.get("language") or "zh"
            if lang == "auto":
                lang = None  # 交给 whisper 自己判断
            try:
                with _model_lock:
                    out = transcribe_wav(wav, lang)
                return self._json(200, {"segments": out})
            except Exception as e:  # noqa: BLE001
                return self._json(500, {"error": str(e)})

        if self.path == "/analyze":
            try:
                title = payload.get("title", "")
                segments = payload.get("segments", [])
                ent_map = {}
                ent_map = build_entity_map(title, segments)
                if ent_map:
                    segments, fixed = apply_entity_map(segments, ent_map)
                    print(f"[entity] 修正 {fixed} 处：{ent_map}", flush=True)

                if len(segments) > 120:
                    res = analyze_windowed(title, segments)
                    if not res:
                        base = analyze(title, segments)
                        res = analyze_with_llm(title, segments, base)
                    else:
                        # 分窗只做了章节/文章/观点；编辑版、金句、知识点要单独补
                        if not res.get("edited_transcript"):
                            res["edited_transcript"] = edit_transcript_with_llm(title, segments)
                        res = fix_citations(segments, res)
                        qts = quotes_from_edited(res.get("edited_transcript"), segments)
                        if qts is not None:
                            res["quotes"] = qts
                        ins = build_insights_with_llm(title, segments)
                        if ins:
                            res["insights"] = ins
                else:
                    base = analyze(title, segments)
                    res = analyze_with_llm(title, segments, base)
                if not res.get("edited_transcript"):
                    res["edited_transcript"] = edit_transcript_with_llm(title, segments)
                st_res = build_structure_with_llm(title, segments)
                if st_res:
                    if st_res["chapters"]:
                        res["chapters"] = [
                            {"title": c["title"], "start_ms": c["start_ms"], "end_ms": c["end_ms"],
                             "core": c["summary"], "points": c["nodes"]}
                            for c in st_res["chapters"]
                        ]
                    if st_res["topics"]:
                        res["keywords"] = [
                            {"term": t["term"], "brief": "", "weight": t["weight"], "kind": t["kind"]}
                            for t in st_res["topics"]
                        ]
                    if st_res["questions"]:
                        res["questions"] = st_res["questions"]
                    res["actions"] = st_res["methods"]

                qt = quotes_from_edited(res.get("edited_transcript"), segments)
                if qt is not None:
                    res["quotes"] = qt
                    res["quotes_status"] = "from_edited" if qt else "none_found"
                ins = build_insights_with_llm(title, segments)
                if ins:
                    res["insights"] = ins
                    # 用检验过的知识点替换规则版观点，避免"正文说 A、依据说 B"和没标点的问题
                    from_ins = [
                        {
                            "title": x["title"],
                            "explain": x["content"],
                            "evidence": x["raw"],
                            "start_ms": x["start_ms"],
                            "chapter": "",
                            "from_insight": True,
                        }
                        for x in ins
                        if x["category"] in ("takeaway", "case")
                    ]
                    if len(from_ins) >= 2:
                        res["takeaways"] = from_ins[:6]
                res["entity_map"] = ent_map or {}
                res = normalize_evidence(res, segments, res.get("edited_transcript"))
                return self._json(200, res)
            except Exception as e:  # noqa: BLE001
                return self._json(500, {"error": str(e)})

        self._json(404, {"error": "not found"})


if __name__ == "__main__":
    sys.stderr.write(f"[asr] starting on {HOST}:{PORT} model={MODEL_SIZE}\n")
    # 先把端口开起来，模型在后台线程里加载：首次要下模型（几百 MB），
    # 这段时间 /health 会如实回 ready:false，前端就能显示「正在准备模型」。
    threading.Thread(target=load_model, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
