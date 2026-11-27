-- ============================================================
-- Podcast Mantra · 第二批补丁（在 patch.sql 之后执行）
-- 用法：Supabase 控制台 → SQL Editor → New query → 整段粘贴 → Run
-- 作用：
--   1) 逐字稿每段多存一句「概括」，详情页先看概括、下拉看全文
--   2) 确保思维导图表存在（AI 导图存在这里，页面直接读）
-- 全部语句可重复运行，不会破坏已有数据。
-- ============================================================

-- 1) 逐字稿：每段的一句话概括（gist）
alter table public.transcript_segments add column if not exists gist text;

-- 按起点排序的索引：转写靠它推算「下一片从哪开始」，也加速详情页读取
create index if not exists idx_segments_episode_start
  on public.transcript_segments (episode_id, start_ms);

-- 2) 思维导图（若首版 schema 未建过则补上）
create table if not exists public.mindmaps (
  id          uuid primary key default gen_random_uuid(),
  episode_id  uuid not null unique references public.episodes(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  data        jsonb not null,
  model       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.mindmaps enable row level security;
drop policy if exists "own_select" on public.mindmaps;
create policy "own_select" on public.mindmaps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) 验证（可选）
-- select count(*) from public.transcript_segments where gist is not null;
