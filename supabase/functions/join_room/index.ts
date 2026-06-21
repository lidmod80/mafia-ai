// join_room — ساخت/پیوستن به اتاق و تخصیص صندلی.
// وقتی تعداد انسان‌ها به حد نصاب رسید، شمارش معکوس شروع می‌شود.
import { admin, getUser, json, preflight, PHASE_SECS, deadline } from "../_shared/util.ts";

// min = حداقل انسان برای شروعِ شمارش معکوس؛ بعد از پایان شمارش، صندلی‌های
// خالی تا max با بات پر می‌شوند. min کوچک تا حتی یک بازیکن هم گیر نکند.
const MODE_SIZE: Record<string, { min: number; max: number }> = {
  classic:  { min: 2, max: 7 },
  ranked:   { min: 2, max: 8 },
  quick:    { min: 1, max: 6 },
  beginner: { min: 1, max: 5 },
  custom:   { min: 1, max: 10 },
};

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const user = await getUser(req);
    if (!user) return json({ error: "auth required" }, 401);
    const { mode = "classic", room_id, name } = await req.json().catch(() => ({}));
    const db = admin();
    const display = (name ?? user.user_metadata?.name ?? user.email?.split("@")[0] ?? "بازیکن").toString().slice(0, 24);

    // پروفایل بازیکن (برای ELO) — client_id = شناسهٔ کاربر
    await db.from("players").upsert(
      { user_id: user.id, client_id: user.id, name: display },
      { onConflict: "user_id" },
    );

    const size = MODE_SIZE[mode] ?? MODE_SIZE.classic;

    // اتاق هدف
    let room;
    if (room_id) {
      const { data } = await db.from("rooms").select("*").eq("id", room_id).maybeSingle();
      if (!data) return json({ error: "room not found" }, 404);
      if (data.status !== "waiting" && data.status !== "countdown")
        return json({ error: "room not joinable" }, 409);
      room = data;
    } else {
      // یک اتاق بازِ هم‌مود پیدا کن، وگرنه بساز
      const { data: open } = await db.from("rooms")
        .select("*, room_seats(count)").eq("mode", mode).eq("status", "waiting")
        .order("created_at").limit(5);
      room = (open ?? []).find((r: any) => (r.room_seats?.[0]?.count ?? 0) < r.max_players);
      if (!room) {
        const { data: created, error } = await db.from("rooms").insert({
          name: `اتاق ${mode} #${Math.floor(Math.random() * 900 + 100)}`,
          mode, min_players: size.min, max_players: size.max, host_id: user.id,
        }).select().single();
        if (error) throw error;
        room = created;
      }
    }

    // آیا قبلاً نشسته‌ام؟
    const { data: mine } = await db.from("room_seats")
      .select("seat_index").eq("room_id", room.id).eq("user_id", user.id).maybeSingle();
    if (mine) return json({ room_id: room.id, seat_index: mine.seat_index, rejoined: true });

    // صندلی آزاد بعدی
    const { data: seats } = await db.from("room_seats").select("seat_index").eq("room_id", room.id);
    const used = new Set((seats ?? []).map((s: any) => s.seat_index));
    if (used.size >= room.max_players) return json({ error: "room full" }, 409);
    let seat = 0; while (used.has(seat)) seat++;

    const { error: insErr } = await db.from("room_seats").insert({
      room_id: room.id, seat_index: seat, user_id: user.id, display_name: display, is_bot: false, avatar: "😎",
    });
    if (insErr) {
      // رقابت هم‌زمان: اگر بین‌مان جا گرفته شد، دوباره صندلی‌ام را بخوان
      const { data: again } = await db.from("room_seats")
        .select("seat_index").eq("room_id", room.id).eq("user_id", user.id).maybeSingle();
      if (again) return json({ room_id: room.id, seat_index: again.seat_index, rejoined: true });
      throw insErr;
    }

    // حد نصاب → شمارش معکوس
    const humanCount = (used.size) + 1; // فقط انسان‌ها (هنوز باتی اضافه نشده)
    if (humanCount >= room.min_players && room.status === "waiting") {
      await db.from("rooms").update({ status: "countdown", start_deadline: deadline(PHASE_SECS.countdown) }).eq("id", room.id);
    }

    return json({ room_id: room.id, seat_index: seat });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
