// start_or_fill — شروع دستی بازی (host) یا اجبار به پُرشدن با بات.
// منطق واقعی در engine.resolveRoom (شاخهٔ countdown) است.
import { admin, getUser, json, preflight } from "../_shared/util.ts";
import { resolveRoom } from "../_shared/engine.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const user = await getUser(req);
    if (!user) return json({ error: "auth required" }, 401);
    const { room_id } = await req.json().catch(() => ({}));
    if (!room_id) return json({ error: "room_id required" }, 400);
    const db = admin();

    // فقط host می‌تواند زودتر از موعد شروع کند
    const { data: room } = await db.from("rooms").select("host_id,status").eq("id", room_id).maybeSingle();
    if (!room) return json({ error: "room not found" }, 404);
    const force = room.host_id === user.id;

    const res = await resolveRoom(db, room_id, { force });
    return json({ ok: true, ...res });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
