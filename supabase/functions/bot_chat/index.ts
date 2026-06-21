// bot_chat — تولید چند خط بحثِ روزِ درون‌نقش با Claude (بخش «AI» از بات ترکیبی).
// یک‌بار در هر دور فاز روز اجرا می‌شود؛ خروجی به‌صورت رویداد chat پخش می‌شود.
// اگر کلید Anthropic نباشد، به قالب‌های آماده برمی‌گردد (پورت genDiscussion).
import { admin, json, preflight } from "../_shared/util.ts";
import { rand, shuffle } from "../_shared/game.ts";

const MODEL = "claude-haiku-4-5-20251001";

function templateLines(names: string[]): string[] {
  if (names.length < 2) return ["بحثی باقی نمانده."];
  const [a, b] = shuffle(names);
  return [
    `${a}: من به ${b} مشکوکم، دیشب خیلی ساکت بود.`,
    `${b}: من بی‌گناهم! بهتره دنبال کسی باشیم که زیادی شلوغش می‌کنه.`,
    `${a}: رفتار ${b} طبیعی نیست...`,
  ];
}

async function aiLines(names: string[], round: number, lastDeath: string | null): Promise<string[] | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  const sys =
    "تو راویِ یک بازی مافیای فارسی هستی. چند خط کوتاهِ بحثِ روز بین بازیکنان تولید کن: " +
    "اتهام، دفاع، و استدلال. هر خط به شکل «نام: جمله». نقش هیچ‌کس را فاش نکن. " +
    "فقط فارسیِ محاوره‌ایِ طبیعی. بین ۳ تا ۴ خط. خروجی فقط خطوط، بدون توضیح اضافه.";
  const ctx =
    `بازیکنان زنده: ${names.join("، ")}. دور ${round}.` +
    (lastDeath ? ` دیشب ${lastDeath} کشته شد.` : " دیشب کسی نمرد.");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 400, system: sys,
        messages: [{ role: "user", content: ctx }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? "";
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.includes(":")).slice(0, 4);
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const { room_id } = await req.json().catch(() => ({}));
    if (!room_id) return json({ error: "room_id required" }, 400);
    const db = admin();

    const { data: room } = await db.from("rooms").select("status,phase,round").eq("id", room_id).maybeSingle();
    if (!room || room.phase !== "day") return json({ ok: true, skipped: "not day" });

    // یک‌بار در هر دور
    const { data: existing } = await db.from("game_events")
      .select("id").eq("room_id", room_id).eq("round", room.round).eq("type", "chat").limit(1);
    if (existing && existing.length) return json({ ok: true, skipped: "already" });

    const { data: seats } = await db.from("room_seats")
      .select("display_name,alive").eq("room_id", room_id).eq("alive", true);
    const names = (seats ?? []).map((s: any) => s.display_name);

    // آخرین مرگ این دور (برای زمینه)
    const { data: deaths } = await db.from("game_events")
      .select("payload").eq("room_id", room_id).eq("round", room.round).eq("type", "death").limit(1);
    const lastDeath = deaths?.[0]?.payload?.name ?? null;

    const lines = (await aiLines(names, room.round, lastDeath)) ?? templateLines(names);
    await db.from("game_events").insert({
      room_id, round: room.round, phase: "day", type: "chat", payload: { lines },
    });
    return json({ ok: true, lines });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
