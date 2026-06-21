-- ════════════════════════════════════════════════════════════════
--  کرونِ پیشروی فاز را بدون نیاز به رازِ Vault بازنویسی می‌کنیم.
--  resolve_phase با verify_jwt=true است؛ کلید anon یک JWT معتبر است و
--  از گیت‌وی عبور می‌کند. خودِ تابع داخلاً با service_role می‌نویسد، پس
--  امن است. (کلید anon عمومی است و در js/config.js هم هست.)
-- ════════════════════════════════════════════════════════════════
create or replace function public.tick_overdue_rooms()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xbnlwamdpYmNjYXJtbXdud3lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNzg4ODMsImV4cCI6MjA5Njk1NDg4M30.1shBjEbLzITZjJFIsuGIcaeI7jbKpTBHYaBy5TTb-RI';
  v_base text := 'https://oqnypjgibccarmmwnwyl.supabase.co/functions/v1/resolve_phase';
begin
  for r in
    select id from public.rooms
    where status in ('countdown','playing')
      and phase_deadline is not null
      and phase_deadline <= now()
      and resolving = false
  loop
    perform net.http_post(
      url := v_base,
      headers := jsonb_build_object(
                   'Content-Type','application/json',
                   'Authorization','Bearer ' || v_anon,
                   'apikey', v_anon),
      body := jsonb_build_object('room_id', r.id, 'source', 'cron')
    );
  end loop;
end;
$$;
