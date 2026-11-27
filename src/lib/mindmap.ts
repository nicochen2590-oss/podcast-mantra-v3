// 思维导图：多层树 + 宽松 JSON 解析 + 无 AI 时的兜底
export type MindNode = {
  name: string;
  /** 毫秒；由模型直接给出，或事后按文字对回逐字稿 */
  start_ms?: number;
  children?: MindNode[];
};

/** 从模型输出里抠出 JSON：容忍 ```json 围栏、前后废话 */
export function parseLooseJson(raw: string): unknown {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const openCh = s[start];
  const closeCh = openCh === "{" ? "}" : "]";
  const end = s.lastIndexOf(closeCh);
  if (end <= start) return null;
  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    // 常见毛病：中文引号、尾随逗号。做一次轻量修补再试
    try {
      return JSON.parse(
        slice
          .replace(/[“”]/g, '"')
          .replace(/[‘’]/g, "'")
          .replace(/,\s*([}\]])/g, "$1")
      );
    } catch {
      return null;
    }
  }
}

function cleanName(v: unknown, max = 40): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/^[\s"「『]+|[\s"」』]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, max)
    .trim();
}

const MAX_DEPTH = 4;   // 根 + 三级
const MAX_TOTAL = 96;  // 总节点上限，防止模型失控

/**
 * 校验并裁剪模型给的树：
 * 最多 4 层；一级 2-6 个分支，其余每层每节点 1-5 个。
 * 节点名允许模型直接带时间（t，单位秒）。
 */
export function normalizeMindmap(raw: unknown, fallbackRoot: string): MindNode | null {
  let total = 0;

  function walk(v: unknown, depth: number, limit: number): MindNode | null {
    if (!v || typeof v !== "object" || total >= MAX_TOTAL) return null;
    const o = v as Record<string, unknown>;
    const name = cleanName(o.name, depth === 0 ? 26 : depth === 1 ? 24 : 34);
    if (!name) return null;

    total += 1;
    const node: MindNode = { name };

    const t = Number(o.t ?? o.start ?? o.start_ms ?? NaN);
    if (Number.isFinite(t) && t >= 0) {
      // 大于 100000 视为已是毫秒
      node.start_ms = t > 100000 ? Math.round(t) : Math.round(t * 1000);
    }

    if (depth < MAX_DEPTH - 1) {
      const kids = Array.isArray(o.children) ? o.children : [];
      const children: MindNode[] = [];
      for (const k of kids.slice(0, limit)) {
        const c = walk(k, depth + 1, 5);
        if (c) children.push(c);
      }
      if (children.length) node.children = children;
    }
    return node;
  }

  const root = walk(raw, 0, 6);
  if (!root || !root.children || root.children.length < 2) return null;
  return { ...root, name: root.name || fallbackRoot };
}

function shortText(s: string, max: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const cut = t.search(/[。！？!?；;]/);
  const head = cut > 0 ? t.slice(0, cut) : t;
  return (head.length > max ? head.slice(0, max) + "…" : head).replace(/^[，、,]/, "");
}

/** 把一句口语压成更像标题的短语：去掉起头的连接词/口头语 */
function tighten(s: string, max: number): string {
  const t = shortText(s, max)
    .replace(/^(然后|就是|其实|所以|那么|这个|那个|他说|她说|我觉得|我认为|对吧|你看)[，,、\s]*/g, "")
    .trim();
  return t || shortText(s, max);
}

/**
 * 兜底导图：没有 AI 结果时，用逐字稿自带的「一句话概括」拼一张两层图。
 * 只到两层——没有模型时不做假装的三级，避免把逐字稿原句硬塞成"论点"。
 */
export function buildMindmapFromSegments(
  title: string,
  segments: { start_ms: number; text: string; gist?: string | null }[]
): MindNode | null {
  if (!segments || segments.length < 3) return null;
  const n = segments.length;
  const groupCount = Math.max(3, Math.min(5, Math.round(n / 4)));
  const per = Math.ceil(n / groupCount);

  const branches: MindNode[] = [];
  for (let i = 0; i < n; i += per) {
    const group = segments.slice(i, i + per);
    const head = group[0];
    const branchName = tighten(head.gist || head.text, 16);
    if (!branchName) continue;
    const children: MindNode[] = [];
    for (const seg of group.slice(1)) {
      const leaf = tighten(seg.gist || seg.text, 24);
      if (leaf && leaf !== branchName) {
        children.push({ name: leaf, start_ms: seg.start_ms });
      }
    }
    branches.push(
      children.length
        ? { name: branchName, start_ms: head.start_ms, children: children.slice(0, 4) }
        : { name: branchName, start_ms: head.start_ms }
    );
  }
  if (branches.length < 2) return null;
  return { name: tighten(title, 20) || title, start_ms: 0, children: branches.slice(0, 5) };
}

/**
 * 给每个节点补时间戳：模型给了就用模型的；没给就按文字去逐字稿里找；
 * 还找不到就继承父节点的时间——保证二级标题一定能点回一段有画面的位置。
 */
export function attachTimecodes(
  node: MindNode,
  segments: { start_ms: number; text: string }[],
  inherited?: number
): MindNode {
  const find = (name: string): number | undefined => {
    const probe = name.replace(/[，。、！？…\s"「」（）()]/g, "").slice(0, 8);
    if (probe.length < 3) return undefined;
    const hit = segments.find((s) =>
      s.text.replace(/[，。、！？…\s"「」（）()]/g, "").includes(probe)
    );
    return hit?.start_ms;
  };

  const own = node.start_ms ?? find(node.name) ?? inherited;
  return {
    ...node,
    start_ms: own,
    children: node.children?.map((c) => attachTimecodes(c, segments, own)),
  };
}
