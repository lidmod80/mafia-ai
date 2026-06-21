// ════════════════════════════════════════════════════════════════
//  موتورِ DB-aware بازی: شروع/پُرکردن با بات و حل فازها.
//  این تنها جایی است که نقش‌ها و اقدامات محرمانه لمس می‌شوند.
// ════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as G from "./game.ts";
import { PHASE_SECS, deadline } from "./util.ts";

export interface Room {
  id: string;
  name: string;
  mode: string;
  status: string;
  min_players: number;
  max_players: number;
  host_id: string | null;
  settings: { extras?: string[] };
  round: number;
  phase: string;
  winner: string | null;
  start_deadline: string | null;
  phase_deadline: string | null;
  resolving: boolean;
}

const BOT_AVATARS = ["🤖", "👾", "🦊", "🐼", "🦉", "🐯", "🐸", "🐵"];

// ── خواندن صندلی‌ها به‌صورت Seat ───────────────────────────────────
export async function loadSeats(db: SupabaseClient, roomId: string): Promise<G.Seat[]> {
  const { data, error } = await db
    .from("room_seats").select("*").eq("room_id", roomId).order("seat_index");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    seat_index: r.seat_index,
    user_id: r.user_id,
    display_name: r.display_name,
    is_bot: r.is_bot,
    role: r.role,
    alive: r.alive,
    det_known: r.det_known ?? {},
    meta: r.meta ?? {},
  }));
}

// ── انتشار رویداد عمومی (بدون اطلاعات محرمانه) ─────────────────────
export async function emit(
  db: SupabaseClient, roomId: string, round: number, phase: string,
  type: string, payload: Record<string, unknown> = {},
) {
  await db.from("game_events").insert({ room_id: roomId, round, phase, type, payload });
}

// ── پُرکردن با بات + شروع بازی ─────────────────────────────────────
export async function fillAndStart(db: SupabaseClient, room: Room) {
  const seats = await loadSeats(db, room.id);
  const target = room.max_players;

  // صندلی‌های خالی را با بات پر کن
  const used = new Set(seats.map((s) => s.seat_index));
  const usedNames = new Set(seats.map((s) => s.display_name));
  const botNames = G.shuffle(G.NAMES.filter((n) => !usedNames.has(n)));
  const newBots: Record<string, unknown>[] = [];
  let bi = 0;
  for (let i = 0; i < target; i++) {
    if (used.has(i)) continue;
    const nm = botNames[bi] ?? `بات ${i + 1}`;
    newBots.push({
      room_id: room.id, seat_index: i, user_id: null,
      display_name: nm, avatar: BOT_AVATARS[bi % BOT_AVATARS.length],
      is_bot: true, alive: true,
      meta: { suspicion: Math.random() * 20, correctVotes: 0, guard: null },
    });
    bi++;
  }
  if (newBots.length) await db.from("room_seats").insert(newBots);

  // تخصیص نقش به همهٔ صندلی‌ها
  const all = await loadSeats(db, room.id);
  const count = all.length;
  const roles = G.assignRoles(count, room.settings?.extras ?? []);
  for (let i = 0; i < all.length; i++) {
    all[i].role = roles[i];
    if (all[i].meta.suspicion == null) all[i].meta.suspicion = Math.random() * 20;
    all[i].meta.correctVotes = 0;
  }
  await Promise.all(all.map((s) =>
    db.from("room_seats").update({ role: s.role, meta: s.meta }).eq("room_id", room.id).eq("seat_index", s.seat_index)
  ));

  await db.from("rooms").update({
    status: "playing", round: 1, phase: "reveal", winner: null,
    start_deadline: null, phase_deadline: deadline(PHASE_SECS.reveal),
    resolving: false, updated_at: new Date().toISOString(),
  }).eq("id", room.id);

  await emit(db, room.id, 1, "reveal", "system", { msg: "بازی شروع شد", bots: newBots.length });
  await emit(db, room.id, 1, "reveal", "phase", { phase: "reveal", round: 1 });
}

// ── جمع‌آوری اقدامات شب (انسانی + بات) ─────────────────────────────
async function collectNightActions(db: SupabaseClient, room: Room, seats: G.Seat[]): Promise<G.NightAction[]> {
  const { data } = await db.from("night_actions").select("*").eq("room_id", room.id).eq("round", room.round);
  const actions: G.NightAction[] = (data ?? []).map((a) => ({
    actor_seat: a.actor_seat, action_type: a.action_type, target_seat: a.target_seat,
  }));
  const has = (seat: number) => actions.some((a) => a.actor_seat === seat);

  // مافیا: اگر هیچ kill ثبت نشده، یک بات مافیا تصمیم می‌گیرد
  if (!actions.some((a) => a.action_type === "kill")) {
    const mafBots = G.mafiaAlive(seats).filter((s) => s.is_bot);
    if (mafBots.length) { const a = G.botNightAction(G.rand(mafBots), seats); if (a) actions.push(a); }
  }
  // دکتر/کارآگاه/محافظِ بات‌هایی که هنوز اقدام نکرده‌اند
  for (const s of G.aliveSeats(seats)) {
    if (!s.is_bot || has(s.seat_index)) continue;
    if (s.role === "doctor" || s.role === "detective" || s.role === "bodyguard") {
      const a = G.botNightAction(s, seats); if (a) actions.push(a);
    }
  }
  return actions;
}

// ── ذخیرهٔ وضعیت صندلی‌ها بعد از تغییر ─────────────────────────────
async function persistSeats(db: SupabaseClient, roomId: string, seats: G.Seat[]) {
  await Promise.all(seats.map((s) =>
    db.from("room_seats").update({ alive: s.alive, det_known: s.det_known, meta: s.meta })
      .eq("room_id", roomId).eq("seat_index", s.seat_index)
  ));
}

// ── پایان بازی: ثبت نتیجه + رویداد نهایی ──────────────────────────
async function finishGame(db: SupabaseClient, room: Room, seats: G.Seat[], winner: G.Team | "joker", jokerSeat?: number) {
  await db.from("rooms").update({
    status: "finished", phase: "finished", winner, phase_deadline: null, resolving: false,
    updated_at: new Date().toISOString(),
  }).eq("id", room.id);

  // افشای همهٔ نقش‌ها (پایان بازی)
  const roster = seats.map((s) => ({
    seat: s.seat_index, name: s.display_name, role: s.role,
    team: G.teamOf(s.role), alive: s.alive, is_bot: s.is_bot,
  }));
  await emit(db, room.id, room.round, "finished", "end", { winner, jokerSeat: jokerSeat ?? null, roster });

  // ثبت ELO برای بازیکنان انسانی (تابع موجودِ record_match)
  for (const s of seats) {
    if (s.is_bot || !s.user_id) continue;
    const meWon =
      winner === "joker" ? s.seat_index === jokerSeat :
      G.teamOf(s.role) === winner;
    const { data: pl } = await db.from("players").select("client_id,name").eq("user_id", s.user_id).maybeSingle();
    if (pl?.client_id) {
      await db.rpc("record_match", {
        p_client_id: pl.client_id, p_name: pl.name ?? s.display_name,
        p_role: s.role, p_won: meWon, p_winner: winner,
        p_rounds: room.round, p_players: seats.length, p_mode: room.mode,
      });
    }
  }
}

// ── هستهٔ حل فاز (idempotent) ──────────────────────────────────────
export async function resolveRoom(db: SupabaseClient, roomId: string, opts: { force?: boolean } = {}) {
  // قفل: فقط یک اجرا هم‌زمان
  const { data: locked } = await db.from("rooms")
    .update({ resolving: true }).eq("id", roomId).eq("resolving", false).select().maybeSingle();
  if (!locked) return { skipped: true };
  const room = locked as Room;

  const release = (extra: Record<string, unknown> = {}) =>
    db.from("rooms").update({ resolving: false, ...extra }).eq("id", roomId);

  try {
    // اتاق در حال شمارش معکوس → شروع بازی
    if (room.status === "countdown" || (room.status === "waiting" && opts.force)) {
      const due = room.start_deadline ? Date.now() >= Date.parse(room.start_deadline) : false;
      if (!due && !opts.force) { await release(); return { early: true }; }
      await fillAndStart(db, room); // resolving را خودش false می‌کند
      return { started: true };
    }

    if (room.status !== "playing") { await release(); return { noop: true }; }

    // مهلت فاز نرسیده و اجبار نشده → کاری نکن
    const due = room.phase_deadline ? Date.now() >= Date.parse(room.phase_deadline) - 300 : true;
    if (!due && !opts.force) { await release(); return { early: true }; }

    const seats = await loadSeats(db, roomId);

    // ── reveal → night ──
    if (room.phase === "reveal") {
      await release({ phase: "night", phase_deadline: deadline(PHASE_SECS.night) });
      await emit(db, roomId, room.round, "night", "phase", { phase: "night", round: room.round });
      return { phase: "night" };
    }

    // ── night → day (حل شب) ──
    if (room.phase === "night") {
      const actions = await collectNightActions(db, room, seats);
      const { killedSeat, saved } = G.resolveNight(seats, actions);
      await persistSeats(db, roomId, seats);

      if (saved) await emit(db, roomId, room.round, "day", "save", {});
      else if (killedSeat != null) {
        const v = seats.find((s) => s.seat_index === killedSeat)!;
        await emit(db, roomId, room.round, "day", "death", { seat: killedSeat, name: v.display_name });
      } else await emit(db, roomId, room.round, "day", "system", { msg: "شب آرامی بود" });

      const win = G.checkWin(seats);
      if (win) { await finishGame(db, room, seats, win); return { ended: win }; }

      await release({ phase: "day", phase_deadline: deadline(PHASE_SECS.day) });
      await emit(db, roomId, room.round, "day", "phase", { phase: "day", round: room.round });
      return { phase: "day" };
    }

    // ── day → day-vote ──
    if (room.phase === "day") {
      await release({ phase: "day-vote", phase_deadline: deadline(PHASE_SECS["day-vote"]) });
      await emit(db, roomId, room.round, "day-vote", "phase", { phase: "day-vote", round: room.round });
      return { phase: "day-vote" };
    }

    // ── day-vote → night (حل رأی) ──
    if (room.phase === "day-vote") {
      const { data: vrows } = await db.from("votes").select("*").eq("room_id", roomId).eq("round", room.round);
      const allVotes: G.Vote[] = (vrows ?? []).map((v) => ({ voter_seat: v.voter_seat, target_seat: v.target_seat }));
      const voted = new Set(allVotes.map((v) => v.voter_seat));
      // رأی بات‌ها
      for (const s of G.aliveSeats(seats)) {
        if (!s.is_bot || voted.has(s.seat_index)) continue;
        allVotes.push({ voter_seat: s.seat_index, target_seat: G.botVote(s, seats) });
      }
      const { outSeat, counts } = G.tallyVotes(seats, allVotes);

      let jokerSeat: number | undefined;
      if (outSeat != null) {
        const out = seats.find((s) => s.seat_index === outSeat)!;
        out.alive = false;
        await persistSeats(db, roomId, seats);
        await emit(db, roomId, room.round, "day-vote", "vote_result", {
          out: outSeat, name: out.display_name, role: out.role, team: G.teamOf(out.role), counts,
        });
        if (out.role === "joker") jokerSeat = outSeat;
      } else {
        await persistSeats(db, roomId, seats);
        await emit(db, roomId, room.round, "day-vote", "vote_result", { out: null, counts });
      }

      if (jokerSeat != null) { await finishGame(db, room, seats, "joker", jokerSeat); return { ended: "joker" }; }
      const win = G.checkWin(seats);
      if (win) { await finishGame(db, room, seats, win); return { ended: win }; }

      const nextRound = room.round + 1;
      await release({ round: nextRound, phase: "night", phase_deadline: deadline(PHASE_SECS.night) });
      await emit(db, roomId, nextRound, "night", "phase", { phase: "night", round: nextRound });
      return { phase: "night", round: nextRound };
    }

    await release();
    return { noop: true };
  } catch (e) {
    await release();
    throw e;
  }
}
