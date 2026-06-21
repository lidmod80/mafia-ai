// resolve_phase — جلو بردن فاز اتاق (idempotent).
// فراخوان‌ها: کلاینت‌ها وقتی تایمر محلی صفر شد، و pg_cron به‌عنوان شبکهٔ اطمینان.
import { admin, json, preflight } from "../_shared/util.ts";
import { resolveRoom } from "../_shared/engine.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const { room_id } = await req.json().catch(() => ({}));
    if (!room_id) return json({ error: "room_id required" }, 400);
    const db = admin();
    const res = await resolveRoom(db, room_id, {});
    return json({ ok: true, ...res });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
