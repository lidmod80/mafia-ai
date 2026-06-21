// submit_action — ثبت اقدام شب یا رأیِ یک بازیکن انسانی.
// اعتبارسنجی سمت‌سرور: نقش، زنده‌بودن، و فاز درست.
import { admin, getUser, json, preflight } from "../_shared/util.ts";
import { teamOf } from "../_shared/game.ts";

// نقش مجاز برای هر اقدام شبانه
const NIGHT_ROLE: Record<string, (role: string) => boolean> = {
  kill:  (r) => teamOf(r) === "mafia",
  save:  (r) => r === "doctor",
  check: (r) => r === "detective",
  guard: (r) => r === "bodyguard",
  shoot: (r) => r === "sniper",
};

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const user = await getUser(req);
    if (!user) return json({ error: "auth required" }, 401);
    const { room_id, action_type, target_seat } = await req.json().catch(() => ({}));
    if (!room_id || !action_type) return json({ error: "bad request" }, 400);
    const db = admin();

    const { data: room } = await db.from("rooms").select("status,phase,round").eq("id", room_id).maybeSingle();
    if (!room || room.status !== "playing") return json({ error: "not in play" }, 409);

    const { data: seat } = await db.from("room_seats")
      .select("seat_index,role,alive").eq("room_id", room_id).eq("user_id", user.id).maybeSingle();
    if (!seat) return json({ error: "not in room" }, 403);
    if (!seat.alive) return json({ error: "eliminated" }, 403);

    // ── رأی ──
    if (action_type === "vote") {
      if (room.phase !== "day-vote") return json({ error: "not voting phase" }, 409);
      await db.from("votes").upsert(
        { room_id, round: room.round, voter_seat: seat.seat_index, target_seat: target_seat ?? null },
        { onConflict: "room_id,round,voter_seat" },
      );
      return json({ ok: true });
    }

    // ── اقدام شب ──
    if (room.phase !== "night") return json({ error: "not night phase" }, 409);
    const allowed = NIGHT_ROLE[action_type];
    if (!allowed || !allowed(seat.role)) return json({ error: "action not allowed for your role" }, 403);
    if (target_seat == null) return json({ error: "target required" }, 400);

    await db.from("night_actions").upsert(
      { room_id, round: room.round, actor_seat: seat.seat_index, action_type, target_seat },
      { onConflict: "room_id,round,actor_seat" },
    );

    // کارآگاه: نتیجهٔ بررسی فوری (فقط به خودِ کارآگاه)
    if (action_type === "check") {
      const { data: tgt } = await db.from("room_seats")
        .select("role,display_name").eq("room_id", room_id).eq("seat_index", target_seat).maybeSingle();
      const team = tgt ? teamOf(tgt.role) : "city";
      return json({ ok: true, result: { seat: target_seat, name: tgt?.display_name, team, isMafia: team === "mafia" } });
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
