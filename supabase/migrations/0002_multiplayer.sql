-- ════════════════════════════════════════════════════════════════
--  Mafia AI — چندنفرهٔ بلادرنگ (MVP)
--  جدول‌های اتاق/صندلی/اقدام/رأی/رویداد + RLS سخت‌گیرانه + کرون.
--
--  اصل امنیتی (همان الگوی 0001): کلاینت هیچ‌گاه مستقیم نمی‌نویسد و
--  هرگز نقش بازیکنان دیگر را نمی‌خواند. تنها مسیر نوشتن، Edge
--  Functionها با service_role هستند (که RLS را دور می‌زنند).
--
--  این فایل را در Supabase → SQL Editor اجرا کن (یا supabase db push).
-- ════════════════════════════════════════════════════════════════

-- ── 0) هویت واقعی: اتصال players به auth.users ────────────────────
-- ستون user_id کنار client_id فعلی اضافه می‌شود (مهاجرت نرم؛ ردیف‌های
-- ناشناس قبلی دست‌نخورده می‌مانند).
alter table public.players
  add column if not exists user_id uuid unique references auth.users (id) on delete set null;

create index if not exists players_user_idx on public.players (user_id);

-- ── 1) اتاق‌ها ────────────────────────────────────────────────────
create table if not exists public.rooms (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  mode            text not null default 'classic',     -- classic | ranked | quick | beginner | custom
  status          text not null default 'waiting',     -- waiting | countdown | playing | finished
  min_players     int  not null default 4,
  max_players     int  not null default 7,
  host_id         uuid references auth.users (id) on delete set null,
  settings        jsonb not null default '{}'::jsonb,   -- نقش‌های اضافی و... (فاز بعد)
  round           int  not null default 0,
  phase           text not null default 'lobby',        -- lobby | reveal | night | day | day-vote | resolved | finished
  winner          text,                                 -- city | mafia | joker | null
  start_deadline  timestamptz,                          -- پایان شمارش معکوس لابی
  phase_deadline  timestamptz,                          -- پایان مهلت فاز جاری
  resolving       boolean not null default false,       -- قفل idempotency برای resolve_phase
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists rooms_status_idx   on public.rooms (status);
create index if not exists rooms_deadline_idx  on public.rooms (phase_deadline);

-- ── 2) صندلی‌ها (نقش ستون محرمانه است) ────────────────────────────
create table if not exists public.room_seats (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms (id) on delete cascade,
  seat_index    int  not null,
  user_id       uuid references auth.users (id) on delete set null,
  display_name  text not null default 'بازیکن',
  avatar        text,
  is_bot        boolean not null default false,
  role          text,                                   -- 🔒 محرمانه — هرگز به کلاینت نمی‌رود
  alive         boolean not null default true,
  det_known     jsonb not null default '{}'::jsonb,     -- 🔒 دانش کارآگاهیِ این صندلی
  meta          jsonb not null default '{}'::jsonb,     -- 🔒 وضعیت داخلی بات (suspicion و...)
  joined_at     timestamptz not null default now(),
  unique (room_id, seat_index),
  unique (room_id, user_id)
);

create index if not exists seats_room_idx on public.room_seats (room_id);
create index if not exists seats_user_idx on public.room_seats (user_id);

-- ── 3) اقدامات شب (کاملاً محرمانه) ────────────────────────────────
create table if not exists public.night_actions (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  round        int  not null,
  actor_seat   int  not null,
  action_type  text not null,                            -- kill | save | check | guard | shoot
  target_seat  int,
  created_at   timestamptz not null default now(),
  unique (room_id, round, actor_seat)
);

create index if not exists nactions_room_round_idx on public.night_actions (room_id, round);

-- ── 4) رأی‌ها ─────────────────────────────────────────────────────
create table if not exists public.votes (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  round        int  not null,
  voter_seat   int  not null,
  target_seat  int,                                      -- null = انصراف
  created_at   timestamptz not null default now(),
  unique (room_id, round, voter_seat)
);

create index if not exists votes_room_round_idx on public.votes (room_id, round);

-- ── 5) رویدادهای عمومی (منبع Realtime برای همه) ────────────────────
-- فقط اطلاعات غیرمحرمانه اینجا نوشته می‌شود (مرگ، نتیجهٔ رأی، چت، تغییر فاز).
create table if not exists public.game_events (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.rooms (id) on delete cascade,
  round       int  not null default 0,
  phase       text,
  type        text not null,                             -- phase | death | save | vote_result | chat | system | end
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_room_idx on public.game_events (room_id, id);

-- ════════════════════════════════════════════════════════════════
--  RLS — همه‌جا روشن. هیچ سیاست INSERT/UPDATE/DELETE برای کلاینت
--  تعریف نمی‌شود؛ پس فقط service_role (Edge Functions) می‌نویسد.
-- ════════════════════════════════════════════════════════════════
alter table public.rooms          enable row level security;
alter table public.room_seats     enable row level security;
alter table public.night_actions  enable row level security;
alter table public.votes          enable row level security;
alter table public.game_events    enable row level security;

-- اتاق‌ها: لیست عمومی است (برای صفحهٔ rooms).
drop policy if exists "rooms readable by anyone" on public.rooms;
create policy "rooms readable by anyone" on public.rooms for select using (true);

-- رویدادها: عمومی (محرمانه‌ای داخلشان نیست).
drop policy if exists "events readable by anyone" on public.game_events;
create policy "events readable by anyone" on public.game_events for select using (true);

-- room_seats / night_actions / votes: هیچ سیاست SELECTی نداریم → کلاینت
-- مستقیم نمی‌تواند بخواند. صندلی‌ها فقط از طریق ویوی امن زیر دیده می‌شوند.

-- ── ویوی عمومی صندلی‌ها (بدون ستون‌های محرمانه) ───────────────────
create or replace view public.seats_public
  with (security_invoker = false) as
  select id, room_id, seat_index, user_id, display_name, avatar, is_bot, alive, joined_at
  from public.room_seats;

grant select on public.seats_public to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
--  Realtime — فقط جدول‌های بی‌خطر منتشر می‌شوند.
--  room_seats عمداً منتشر نمی‌شود (تا نقش از طریق replication لو نرود)؛
--  کلاینت با هر رویداد، seats_public / get_my_state را دوباره می‌خواند.
-- ════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.game_events;

-- ════════════════════════════════════════════════════════════════
--  پیشروی خودکار فاز — شبکهٔ اطمینان با pg_cron + pg_net
--  اتاق‌هایی که مهلتشان گذشته را با POST به Edge Function resolve_phase
--  جلو می‌برد (حتی اگر هیچ انسانی آنلاین نباشد و بازی فقط بات‌ها باشد).
--
--  پیش‌نیاز (یک‌بار، از داشبورد یا SQL):
--    create extension if not exists pg_cron;
--    create extension if not exists pg_net;
--    -- کلید سرویس را در Vault بگذار تا داخل SQL هاردکد نشود:
--    select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
-- ════════════════════════════════════════════════════════════════
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.tick_overdue_rooms()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  r          record;
  v_key      text;
  v_base     text := 'https://oqnypjgibccarmmwnwyl.supabase.co/functions/v1/resolve_phase';
begin
  -- کلید سرویس از Vault (اگر تنظیم نشده باشد، تابع بی‌سروصدا خارج می‌شود)
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then return; end if;

  for r in
    select id from public.rooms
    where status in ('countdown','playing')
      and phase_deadline is not null
      and phase_deadline <= now()
      and resolving = false
  loop
    perform net.http_post(
      url     := v_base,
      headers := jsonb_build_object(
                   'Content-Type','application/json',
                   'Authorization','Bearer ' || v_key),
      body    := jsonb_build_object('room_id', r.id, 'source', 'cron')
    );
  end loop;
end;
$$;

-- هر ۵ ثانیه (اگر job با همین نام بود، دوباره ساخته نمی‌شود)
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'mafia_tick') then
    perform cron.schedule('mafia_tick', '5 seconds', $cron$ select public.tick_overdue_rooms(); $cron$);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════
--  پاک‌سازی اتاق‌های مرده (اختیاری) — اتاق‌های قدیمیِ تمام‌شده/متروک.
-- ════════════════════════════════════════════════════════════════
create or replace function public.cleanup_stale_rooms()
returns void language sql security definer set search_path = public as $$
  delete from public.rooms
  where (status = 'finished' and updated_at < now() - interval '1 hour')
     or (status = 'waiting'  and created_at < now() - interval '30 minutes'
         and not exists (select 1 from public.room_seats s
                         where s.room_id = rooms.id and s.is_bot = false));
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'mafia_cleanup') then
    perform cron.schedule('mafia_cleanup', '*/10 * * * *', $cron$ select public.cleanup_stale_rooms(); $cron$);
  end if;
end $$;
