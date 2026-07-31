-- ============================================================
--  FocusDo — Supabase schema
--  Run this once in your project's SQL Editor (New query → paste → Run).
--  Safe to re-run: it drops and recreates the tables/policies.
-- ============================================================

-- Clean slate (comment these out if you want to keep existing data)
drop table if exists public.steps cascade;
drop table if exists public.tasks cascade;
drop table if exists public.lists cascade;

-- ---------- LISTS ----------
create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  emoji       text default '📋',
  color       text default '#4b57c4',
  is_default  boolean not null default false,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- TASKS ----------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  list_id       uuid references public.lists on delete cascade,
  title         text not null,
  notes         text default '',
  is_completed  boolean not null default false,
  completed_at  timestamptz,
  is_important  boolean not null default false,
  my_day_date   date,               -- set to a date = shown in "My Day" that day
  due_date      date,
  remind_at     timestamptz,
  repeat        text default 'none', -- none | daily | weekdays | weekly | monthly
  position      int not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------- STEPS (sub-tasks) ----------
create table public.steps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  task_id     uuid not null references public.tasks on delete cascade,
  title       text not null,
  is_done     boolean not null default false,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

-- Helpful indexes
create index on public.tasks (user_id, list_id);
create index on public.tasks (user_id, my_day_date);
create index on public.tasks (user_id, due_date);
create index on public.steps (user_id, task_id);

-- ============================================================
--  Row Level Security — each user only ever sees their own rows
-- ============================================================
alter table public.lists enable row level security;
alter table public.tasks enable row level security;
alter table public.steps enable row level security;

create policy "own lists"  on public.lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tasks"  on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own steps"  on public.steps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
--  Data API grants (so the logged-in role can reach the tables)
-- ============================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.lists, public.tasks, public.steps to authenticated;
