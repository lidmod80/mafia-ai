-- ════════════════════════════════════════════════════════════════
--  Mafia AI — اسکیمای دیتابیس (Supabase / PostgreSQL)
--  این فایل را در Supabase → SQL Editor اجرا کن (یا با supabase CLI).
-- ════════════════════════════════════════════════════════════════

-- ── جدول بازیکنان (یک ردیف برای هر بازیکن ناشناس) ──────────────────
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  client_id   text unique not null,          -- شناسهٔ تولیدشده در مرورگر
  name        text not null default 'مهمان',
  elo         int  not null default 1000,
  games       int  not null default 0,
  wins        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── جدول لاگ بازی‌ها ──────────────────────────────────────────────
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null,
  role        text,
  won         boolean,
  winner      text,
  rounds      int,
  players     int,
  mode        text,
  created_at  timestamptz not null default now()
);

create index if not exists matches_client_idx on public.matches (client_id);
create index if not exists players_elo_idx on public.players (elo desc);

-- ── RLS: فعال‌سازی روی هر دو جدول ─────────────────────────────────
alter table public.players enable row level security;
alter table public.matches enable row level security;

-- لیدربورد عمومی است: خواندن جدول بازیکنان برای همه مجاز.
drop policy if exists "players readable by anyone" on public.players;
create policy "players readable by anyone"
  on public.players for select
  using (true);

-- هیچ سیاست INSERT/UPDATE/DELETE برای anon تعریف نمی‌شود؛ پس کلاینت
-- نمی‌تواند مستقیم بنویسد. تنها راه نوشتن، تابع امن record_match است.
-- (جدول matches هم هیچ سیاست خواندن/نوشتنی برای anon ندارد.)

-- ── تابع امن ثبت بازی (SECURITY DEFINER) ──────────────────────────
-- ELO سمت سرور محاسبه می‌شود تا کلاینت نتواند امتیاز دلخواه ثبت کند.
create or replace function public.record_match(
  p_client_id text,
  p_name      text,
  p_role      text,
  p_won       boolean,
  p_winner    text,
  p_rounds    int,
  p_players   int,
  p_mode      text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta int;
  v_name  text;
begin
  if p_client_id is null or length(p_client_id) < 8 then
    raise exception 'invalid client_id';
  end if;

  v_name  := coalesce(nullif(left(trim(p_name), 24), ''), 'مهمان');
  v_delta := case when p_won then 15 else -8 end;

  insert into public.matches (client_id, role, won, winner, rounds, players, mode)
  values (p_client_id, p_role, p_won, p_winner,
          greatest(0, coalesce(p_rounds, 0)),
          greatest(0, coalesce(p_players, 0)),
          p_mode);

  insert into public.players (client_id, name, elo, games, wins)
  values (p_client_id, v_name, greatest(0, 1000 + v_delta), 1,
          case when p_won then 1 else 0 end)
  on conflict (client_id) do update set
    games      = public.players.games + 1,
    wins       = public.players.wins + (case when p_won then 1 else 0 end),
    elo        = greatest(0, public.players.elo + v_delta),
    name       = coalesce(nullif(left(trim(p_name), 24), ''), public.players.name),
    updated_at = now();
end;
$$;

-- اجرای تابع توسط کاربر ناشناس (کلاینت) مجاز است.
grant execute on function public.record_match(text, text, text, boolean, text, int, int, text) to anon;
