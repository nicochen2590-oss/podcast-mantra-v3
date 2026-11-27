-- ============================================================
-- Podcast Mantra · 补齐字段（一次性执行，可重复运行，不会破坏已有数据）
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query → 整段粘贴 → Run
-- 作用：让「评分 / 余音 / 登记时间 / 新建专辑 / 双语逐字稿」真正存到云端，
--       这样换手机、换电脑也能看到。不跑的话界面仍能用，但只存在当前浏览器。
-- 说明：全部语句都做了容错，重复运行或字段已存在都不会报错中断。
-- ============================================================

-- 1) 单期内容：评分、余音、登记时间、概要、作者
alter table public.episodes add column if not exists rating  integer check (rating between 1 and 5);
alter table public.episodes add column if not exists note    text;
alter table public.episodes add column if not exists added_at timestamptz not null default now();
alter table public.episodes add column if not exists summary text;
alter table public.episodes add column if not exists summary_status text not null default 'pending';
alter table public.episodes add column if not exists author  text;

-- 2) 逐字稿：英文（双语切换用）
alter table public.transcript_segments add column if not exists text_en text;

-- 3) 专辑：颜色
alter table public.topics add column if not exists color text default '#7d6bab';

-- 4) 预置专辑：给已有账号补齐（用 not exists 判重，不依赖唯一约束，重复运行安全）
insert into public.topics (user_id, name, color)
select p.id, v.name, v.color
from public.profiles p
cross join (values
  ('人间闲谈',   '#9a8bc4'),
  ('远方与路',   '#6f8fa8'),
  ('商业洞察',   '#b98a86'),
  ('品牌出海',   '#c07f62'),
  ('消费观察',   '#c0a06a'),
  ('字里行间',   '#a97b93'),
  ('心事与人',   '#8aa387'),
  ('科技与新知', '#6f94a8'),
  ('声色与审美', '#b0873e'),
  ('拾光杂记',   '#8d8b96')
) as v(name, color)
where not exists (
  select 1 from public.topics t where t.user_id = p.id and t.name = v.name
);

-- 5) 同名唯一约束（防止以后重复插入；若历史已有重名数据则跳过，不影响上面结果）
do $$
begin
  create unique index if not exists topics_user_name_uniq on public.topics (user_id, name);
exception when others then
  raise notice '唯一索引未建立（可能已有重名专辑），不影响使用：%', sqlerrm;
end $$;

-- 6) 验证（可选）：应能看到 10 张预置专辑
-- select name, color from public.topics order by name;
