-- ============================================================
-- Podcast Mantra · 数据库 Schema v1
-- 目标：Supabase (Postgres 15+) 免费版
-- 用法：Supabase Dashboard → SQL Editor → 新建查询 → 粘贴全文 → Run
-- 特性：pgvector 向量检索 / RLS 多用户隔离 / 时间戳逐字稿 / 异步任务队列
-- ============================================================

-- 0. 扩展
create extension if not exists vector;        -- 向量检索（知识库核心）
create extension if not exists pgcrypto;      -- gen_random_uuid()

-- ============================================================
-- 1. 用户与白名单
-- ============================================================

-- 用户资料（与 auth.users 1:1）
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  display_name text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- 邀请白名单：只有 email 在表里的用户才能注册使用
create table if not exists public.allowlist (
  email       text primary key,
  note        text,
  added_by    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2. 主题归档（用户自建主题单元，如"品牌出海""AI 产品"）
-- ============================================================
create table if not exists public.topics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  description text,
  color       text default '#6C5CE7',
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- ============================================================
-- 3. 播客节目（show）与单期（episode）
-- ============================================================

-- 节目层面：同一档播客只存一份，避免封面/标题重复
create table if not exists public.shows (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  platform      text not null check (platform in ('xiaoyuzhou','bilibili','douyin','xiaohongshu','other')),
  platform_id   text,                         -- 平台侧节目 ID
  title         text not null,
  author        text,
  cover_url     text,
  description   text,
  feed_url      text,                         -- RSS 地址（小宇宙/通用播客）
  homepage_url  text,
  created_at    timestamptz not null default now(),
  unique (user_id, platform, platform_id)
);

-- 单期：用户真正"保存"的记录
create table if not exists public.episodes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  show_id       uuid references public.shows(id) on delete set null,
  topic_id      uuid references public.topics(id) on delete set null,
  platform      text not null check (platform in ('xiaoyuzhou','bilibili','douyin','xiaohongshu','other')),
  platform_id   text,
  source_url    text not null,                -- 用户粘贴的原始链接
  title         text not null,                -- 该期标题
  episode_no    text,                         -- 第几期 / E123
  cover_url     text,                         -- 该期封面（无则回退节目封面）
  audio_url     text,                         -- 音频直链（用于自建播放器）
  duration_sec  integer,
  published_at  timestamptz,
  transcript_status text not null default 'pending'
                check (transcript_status in ('pending','processing','ready','failed')),
  created_at    timestamptz not null default now(),
  unique (user_id, platform, platform_id)
);

-- 内容增强字段（幂等）：概要总结、作者、收藏来源
alter table public.episodes add column if not exists summary text;
alter table public.episodes add column if not exists summary_status text not null default 'pending'
  check (summary_status in ('pending','ready','failed'));
alter table public.episodes add column if not exists author text;
alter table public.episodes add column if not exists rating integer check (rating between 1 and 5);
alter table public.episodes add column if not exists note text;               -- 听后感想/当下心情
alter table public.episodes add column if not exists added_at timestamptz not null default now(); -- 登记/收藏时间

-- ============================================================
-- 4. 逐字稿片段（带时间戳，支撑"点击跳转到某点听"）
-- ============================================================
create table if not exists public.transcript_segments (
  id            bigint generated always as identity primary key,
  episode_id    uuid not null references public.episodes(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  seq           integer not null,             -- 片段顺序
  start_ms      integer not null,             -- 起始毫秒（毫秒级跳转）
  end_ms        integer,
  speaker       text,
  text          text not null,
  text_en       text,                         -- 英文译文（中英双语逐字稿）
  created_at    timestamptz not null default now(),
  unique (episode_id, seq)
);
create index if not exists idx_segments_episode_seq on public.transcript_segments(episode_id, seq);

-- 思维导图（每期一份 JSON 树，节点可携带 start_ms 用于跳转）
create table if not exists public.mindmaps (
  id            uuid primary key default gen_random_uuid(),
  episode_id    uuid not null unique references public.episodes(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  data          jsonb not null,               -- {name, children:[{name,start_ms,...}]}
  model         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- 5. 知识库：切片 + 向量（RAG 核心，bge-m3 = 1024 维）
-- ============================================================
create table if not exists public.knowledge_chunks (
  id            bigint generated always as identity primary key,
  episode_id    uuid not null references public.episodes(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  chunk_index   integer not null,
  content       text not null,
  source_type   text not null default 'transcript'
                check (source_type in ('transcript','annotation','summary')),
  start_ms      integer,                      -- 该切片对应音频起点（回答可跳回）
  embedding     vector(1024),
  created_at    timestamptz not null default now(),
  unique (episode_id, source_type, chunk_index)
);
create index if not exists idx_chunks_embedding
  on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_chunks_user on public.knowledge_chunks(user_id);

-- 向量检索函数：按用户隔离 + 相似度阈值
create or replace function public.match_chunks(
  query_embedding vector(1024),
  match_user_id   uuid,
  match_count     int default 8,
  similarity_threshold float default 0.35,
  filter_topic_id uuid default null
)
returns table (
  id          bigint,
  episode_id  uuid,
  content     text,
  source_type text,
  start_ms    integer,
  similarity  float
)
language sql stable
as $$
  select c.id, c.episode_id, c.content, c.source_type, c.start_ms,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks c
  join public.episodes e on e.id = c.episode_id
  where c.user_id = match_user_id
    and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > similarity_threshold
    and (filter_topic_id is null or e.topic_id = filter_topic_id)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- 6. 批注 / 高亮（进入知识库一起被搜到）
-- ============================================================
create table if not exists public.annotations (
  id            uuid primary key default gen_random_uuid(),
  episode_id    uuid not null references public.episodes(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  start_ms      integer,
  end_ms        integer,
  quote         text,
  note          text,
  color         text default '#FFE066',
  created_at    timestamptz not null default now()
);
create index if not exists idx_annotations_episode on public.annotations(episode_id);

-- ============================================================
-- 7. 稍后听队列 + 播放进度云端同步
-- ============================================================
create table if not exists public.listen_later (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  episode_id    uuid not null references public.episodes(id) on delete cascade,
  added_at      timestamptz not null default now(),
  unique (user_id, episode_id)
);

create table if not exists public.playback_progress (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  episode_id    uuid not null references public.episodes(id) on delete cascade,
  position_ms   integer not null default 0,
  completed     boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (user_id, episode_id)
);

-- ============================================================
-- 8. 异步转写任务队列（绕过 Vercel 300s 限制，分段可续传）
-- ============================================================
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  episode_id    uuid not null references public.episodes(id) on delete cascade,
  job_type      text not null check (job_type in ('parse','transcribe','mindmap','embed')),
  status        text not null default 'queued'
                check (status in ('queued','running','done','failed')),
  stage         text,                         -- 当前阶段：download/chunk/asr/merge...
  progress      integer not null default 0,   -- 0-100
  attempt       integer not null default 0,
  payload       jsonb not null default '{}',  -- 中间产物：音频地址/切片游标等
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_jobs_queue on public.jobs(status, created_at);

-- ============================================================
-- 9. 行级安全 RLS：每个用户只能读写自己的数据
-- ============================================================
alter table public.profiles            enable row level security;
alter table public.allowlist           enable row level security;
alter table public.topics              enable row level security;
alter table public.shows               enable row level security;
alter table public.episodes            enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.mindmaps            enable row level security;
alter table public.knowledge_chunks    enable row level security;
alter table public.annotations         enable row level security;
alter table public.listen_later        enable row level security;
alter table public.playback_progress   enable row level security;
alter table public.jobs                enable row level security;

-- 先删除旧策略，保证脚本可重复运行不报错
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "allowlist_select_own" on public.allowlist;
drop policy if exists "own_select" on public.topics;
drop policy if exists "own_select" on public.shows;
drop policy if exists "own_select" on public.episodes;
drop policy if exists "own_select" on public.transcript_segments;
drop policy if exists "own_select" on public.mindmaps;
drop policy if exists "own_select" on public.knowledge_chunks;
drop policy if exists "own_select" on public.annotations;
drop policy if exists "own_select" on public.listen_later;
drop policy if exists "own_select" on public.playback_progress;
drop policy if exists "own_select" on public.jobs;

-- profiles：本人可看可改
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- allowlist：仅本人可查自己是否在白名单（注册时校验用）；写入由 service_role 完成
create policy "allowlist_select_own" on public.allowlist for select using (auth.jwt()->>'email' = email);

-- 可靠版白名单校验：新版 Supabase 的 JWT 默认不含 email，上面的策略会失效。
-- 用 security definer 函数以函数所有者身份查询，绕过 RLS，登录/注册都调它。
create or replace function public.email_is_allowed(p_email text)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  return exists (select 1 from public.allowlist where lower(email) = lower(p_email));
end;
$$;
grant execute on function public.email_is_allowed(text) to anon, authenticated;

-- 其余表：统一按 user_id 隔离，增改查删都仅限本人
create policy "own_select" on public.topics              for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_select" on public.shows               for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_select" on public.episodes            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_select" on public.transcript_segments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_select" on public.mindmaps            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_select" on public.knowledge_chunks    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_select" on public.annotations         for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_select" on public.listen_later        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_select" on public.playback_progress   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_select" on public.jobs                for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- 10. 新用户自动建档（注册 profiles trigger）
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 11. 把管理员邮箱加入白名单（on conflict 保证重复运行不报错）
-- 要加其他人的邮箱，复制下面这行、换掉邮箱再跑即可
-- ============================================================
insert into public.allowlist (email, note)
values ('nicochen2590@163.com', '管理员')
on conflict (email) do nothing;

-- ============================================================
-- 完成。下一步在 SQL Editor 验证：
-- select tablename from pg_tables where schemaname='public';
-- 应看到 12 张表。
-- select * from public.allowlist;
-- 应看到管理员邮箱那一行。
-- ============================================================
