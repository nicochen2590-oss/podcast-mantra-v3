// 把导出里的简介（summary / blurb）补写进 Supabase episodes.summary
import fs from "node:fs";
const env = fs.readFileSync(".env.local", "utf8");
const URL = (env.match(/^SUPABASE_URL=(.+)$/m) || [])[1].trim();
const KEY = (env.match(/^SUPABASE_SERVICE_KEY=(.+)$/m) || [])[1].trim();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" };

const rows = new Map();
// 1) 用户导出的 347/410 期
for (const f of process.argv.slice(2)) {
  const dump = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const e of dump.episodes ?? []) {
    const text = (e.summary ?? "").trim();
    if (text) rows.set(e.id, text);
  }
}
// 2) 公共索引的 blurb
try {
  const lib = JSON.parse(fs.readFileSync("src/data/featured-library.json", "utf8"));
  (lib.episodes ?? []).forEach((e, i) => {
    const id = `guest-e-${String(i + 1).padStart(3, "0")}`;
    const text = (e.blurb ?? e.summary ?? "").trim();
    if (text && !rows.has(id)) rows.set(id, text);
  });
} catch { /* 忽略 */ }

const list = [...rows.entries()].map(([id, summary]) => ({ id, summary }));
console.log("待补简介", list.length, "条");
let ok = 0;
// 逐条 PATCH：只改 summary，不会碰其它字段，也不会因为 title 非空约束失败
for (let i = 0; i < list.length; i += 10) {
  const batch = list.slice(i, i + 10);
  const res = await Promise.all(batch.map((row) =>
    fetch(`${URL}/rest/v1/episodes?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH", headers: H, body: JSON.stringify({ summary: row.summary }),
    }).then((r) => r.ok)
  ));
  ok += res.filter(Boolean).length;
}
console.log("已写入", ok, "条");
