// get_my_state — «نمای من»: وضعیت اتاق + نقش خودم + لیست صندلی‌ها
// (نقش دیگران فقط وقتی مرده‌اند یا بازی تمام شده آشکار می‌شود) + لاگ عمومی.
import { admin, getUser, json, preflight } from "../_shared/util.ts";
import { ROLES, teamOf } from "../_shared/game.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const user = await getUser(req);
    if (!user) return json({ error: "auth required" }, 401);
    const { room_id, since } = await req.json().catch(() => ({}));
    if (!room_id) return json({ error: "room_id required" }, 400);
    const db = admin();

    const { data: room } = await db.from("rooms")
      .select("id,name,mode,status,phase,round,winner,min_players,max_players,host_id,phase_deadline,start_deadline")
      .eq("id", room_id).maybeSingle();
    if (!room) return json({ error: "room not found" }, 404);

    const { data: rows } = await db.from("room_seats").select("*").eq("room_id", room_id).order("seat_index");
    const seats = rows ?? [];
    const finished = room.status === "finished";
    const mySeat = seats.find((s: any) => s.user_id === user.id);

    // لیست عمومی صندلی‌ها — نقش فقط در شرایط مجاز
    const isMafiaPeer = (r: string) => mySeat && teamOf(mySeat.role) === "mafia" && teamOf(r) === "mafia";
    const publicSeats = seats.map((s: any) => {
      const reveal = finished || !s.alive || s.user_id === user.id || isMafiaPeer(s.role);
      return {
        seat: s.seat_index, name: s.display_name, avatar: s.avatar, is_bot: s.is_bot, alive: s.alive,
        is_me: s.user_id === user.id,
        role: reveal ? s.role : null,
        role_name: reveal ? ROLES[s.role]?.n : null,
        mafia_peer: !!isMafiaPeer(s.role) && s.user_id !== user.id,
      };
    });

    const me = mySeat ? {
      seat: mySeat.seat_index, role: mySeat.role, role_name: ROLES[mySeat.role]?.n,
      team: teamOf(mySeat.role), alive: mySeat.alive, det_known: mySeat.det_known ?? {},
      is_host: room.host_id === user.id,
    } : null;

    // رویدادهای عمومی (افزایشی با since)
    let q = db.from("game_events").select("*").eq("room_id", room_id).order("id");
    if (since) q = q.gt("id", since);
    const { data: events } = await q.limit(60);

    return json({ room, me, seats: publicSeats, events: events ?? [] });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
