// ════════════════════════════════════════════════════════════════
//  منطق مشترک بازی مافیا — پورتِ سمت‌سرورِ موتورِ کلاینت.
//  مرجعِ اصلی: mafia-game.html (R, buildPlayers, resolveNight,
//  botVoteChoice, tallyVotes, checkWin). اینجا «server-authoritative»
//  است؛ نقش‌ها هرگز از این مرز بیرون نمی‌روند مگر فیلترشده.
// ════════════════════════════════════════════════════════════════

export type Team = "mafia" | "city" | "neutral";

export interface RoleDef {
  n: string;
  ic: string;
  team: Team;
  d: string;
  tip: string;
}

// آینهٔ R در mafia-game.html
export const ROLES: Record<string, RoleDef> = {
  mafia:     { n: "مافیا",        ic: "🔫", team: "mafia",   d: "هر شب یک شهروند بکش",        tip: "هدف قوی‌ترین بازیکن شهر را انتخاب کن" },
  doctor:    { n: "دکتر",         ic: "💉", team: "city",    d: "هر شب یک نفر نجات بده",       tip: "اگر می‌دانی کارآگاه کیست، او را نجات بده" },
  detective: { n: "کارآگاه",      ic: "🔍", team: "city",    d: "هر شب هویت یک نفر بررسی کن",  tip: "مظنون‌ترین بازیکن روز گذشته را بررسی کن" },
  citizen:   { n: "شهروند",       ic: "👤", team: "city",    d: "مافیا را شناسایی و حذف کن",   tip: "در بحث‌ها فعال باش و سکوت را زیر نظر بگیر" },
  sniper:    { n: "تک‌تیرانداز",  ic: "🎯", team: "city",    d: "یک شلیک در کل بازی",          tip: "تنها یک بار می‌توانی شلیک کنی — مطمئن باش" },
  mayor:     { n: "شهردار",       ic: "🏛️", team: "city",    d: "رأی تو دو برابر است",          tip: "نقشت را در روز اعلام نکن" },
  bodyguard: { n: "محافظ",        ic: "🛡️", team: "city",    d: "هر شب از یک نفر محافظت کن",    tip: "اگر هدف مافیا باشد، به جای او می‌میری" },
  joker:     { n: "جوکر",         ic: "🃏", team: "neutral", d: "اگر با رأی حذف شوی، برنده‌ای!", tip: "کاری کن شهر به تو مشکوک شود تا حذفت کنند" },
};

export const NAMES = [
  "سارا","رضا","مریم","امیر","نازنین","حسین","زهرا","محمد","الناز","کیان",
  "پریسا","بابک","لیلا","آرش","نیلوفر","سهیل","مینا","کاوه","رؤیا","فرهاد",
  "شیرین","بهرام","یاسمن","پویا","مهسا",
];

export interface Seat {
  seat_index: number;
  user_id: string | null;
  display_name: string;
  is_bot: boolean;
  role: string;
  alive: boolean;
  det_known: Record<string, Team>; // target_seat -> team
  meta: { suspicion?: number; correctVotes?: number; guard?: number | null };
}

export interface NightAction {
  actor_seat: number;
  action_type: string; // kill | save | check | guard | shoot
  target_seat: number | null;
}

export interface Vote {
  voter_seat: number;
  target_seat: number | null;
}

// ── ابزارها ───────────────────────────────────────────────────────
export function rand<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
export function shuffle<T>(a: T[]): T[] {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const teamOf = (role: string): Team => ROLES[role]?.team ?? "city";
export const aliveSeats   = (s: Seat[]) => s.filter((p) => p.alive);
export const mafiaAlive   = (s: Seat[]) => s.filter((p) => p.alive && teamOf(p.role) === "mafia");
export const cityAlive    = (s: Seat[]) => s.filter((p) => p.alive && teamOf(p.role) !== "mafia");

// ── تخصیص نقش (پورت buildPlayers) ─────────────────────────────────
export function assignRoles(count: number, extras: string[] = []): string[] {
  const nMafia = count <= 5 ? 1 : count <= 8 ? 2 : 3;
  const pool: string[] = [];
  for (let i = 0; i < nMafia; i++) pool.push("mafia");
  pool.push("detective");
  pool.push("doctor");
  for (const r of extras) if (pool.length < count && ROLES[r]) pool.push(r);
  while (pool.length < count) pool.push("citizen");
  return shuffle(pool).slice(0, count);
}

// ── تصمیم شبانهٔ یک بات ────────────────────────────────────────────
export function botNightAction(seat: Seat, seats: Seat[]): NightAction | null {
  const role = seat.role;
  if (role === "mafia") {
    const targets = cityAlive(seats);
    return targets.length
      ? { actor_seat: seat.seat_index, action_type: "kill", target_seat: rand(targets).seat_index }
      : null;
  }
  if (role === "doctor") {
    const t = rand(aliveSeats(seats));
    return { actor_seat: seat.seat_index, action_type: "save", target_seat: t.seat_index };
  }
  if (role === "detective") {
    const opts = aliveSeats(seats).filter((p) => p.seat_index !== seat.seat_index && !(p.seat_index in seat.det_known));
    if (!opts.length) return null;
    return { actor_seat: seat.seat_index, action_type: "check", target_seat: rand(opts).seat_index };
  }
  if (role === "bodyguard") {
    const opts = aliveSeats(seats).filter((p) => p.seat_index !== seat.seat_index);
    if (!opts.length) return null;
    return { actor_seat: seat.seat_index, action_type: "guard", target_seat: rand(opts).seat_index };
  }
  return null; // citizen / mayor / sniper(passive in MVP)
}

// ── انتخاب رأی یک بات (پورت botVoteChoice) ────────────────────────
export function botVote(seat: Seat, seats: Seat[]): number | null {
  const cands = aliveSeats(seats).filter((p) => p.seat_index !== seat.seat_index);
  if (!cands.length) return null;
  const isMaf = teamOf(seat.role) === "mafia";
  const weights = cands.map((p) => {
    let w = 1 + (p.meta.suspicion ?? 0) * 0.1;
    if (isMaf) {
      if (teamOf(p.role) === "mafia") w = 0.05;
      else w += p.role === "detective" ? 2 : p.role === "doctor" ? 1.5 : 1;
    } else {
      if (seat.det_known[p.seat_index] === "mafia") w += 8;
      if (seat.det_known[p.seat_index] === "city") w = 0.1;
    }
    return Math.max(0.02, w);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < cands.length; i++) {
    r -= weights[i];
    if (r <= 0) return cands[i].seat_index;
  }
  return cands[cands.length - 1].seat_index;
}

// ── حل شب (پورت resolveNight) ─────────────────────────────────────
// seats را تغییر می‌دهد (alive و det_known). برمی‌گرداند چه کسی مرد.
export function resolveNight(
  seats: Seat[],
  actions: NightAction[],
): { killedSeat: number | null; saved: boolean } {
  const byActor = new Map<number, NightAction>();
  for (const a of actions) byActor.set(a.actor_seat, a);

  // کارآگاه‌ها: نتیجه را در det_known ذخیره کن
  for (const a of actions) {
    if (a.action_type === "check" && a.target_seat != null) {
      const actor = seats.find((s) => s.seat_index === a.actor_seat);
      const tgt = seats.find((s) => s.seat_index === a.target_seat);
      if (actor && tgt) actor.det_known[tgt.seat_index] = teamOf(tgt.role);
    }
  }

  // محافظ‌ها
  for (const a of actions) {
    if (a.action_type === "guard" && a.target_seat != null) {
      const actor = seats.find((s) => s.seat_index === a.actor_seat);
      if (actor) actor.meta.guard = a.target_seat;
    }
  }

  // هدف مافیا (اولین اقدام kill) و نجات دکتر
  const kill = actions.find((a) => a.action_type === "kill" && a.target_seat != null);
  const saveSeats = actions.filter((a) => a.action_type === "save").map((a) => a.target_seat);

  let killedSeat: number | null = null;
  let saved = false;
  if (kill && kill.target_seat != null) {
    if (saveSeats.includes(kill.target_seat)) {
      saved = true;
    } else {
      const victim = seats.find((s) => s.seat_index === kill.target_seat);
      // محافظت محافظ: اگر کسی هدف را guard کرده، به‌جایش می‌میرد
      const bg = seats.find(
        (s) => s.alive && s.role === "bodyguard" && s.meta.guard === victim?.seat_index,
      );
      if (bg) {
        bg.alive = false;
        killedSeat = bg.seat_index;
      } else if (victim) {
        victim.alive = false;
        killedSeat = victim.seat_index;
      }
    }
  }
  // پاک‌سازی guard برای شب بعد
  for (const s of seats) s.meta.guard = null;
  return { killedSeat, saved };
}

// ── شمارش رأی (پورت tallyVotes) ───────────────────────────────────
export function tallyVotes(
  seats: Seat[],
  votes: Vote[],
): { outSeat: number | null; counts: Record<number, number>; tie: boolean } {
  const counts: Record<number, number> = {};
  for (const v of votes) {
    if (v.target_seat == null) continue;
    const voter = seats.find((s) => s.seat_index === v.voter_seat);
    if (!voter || !voter.alive) continue;
    const weight = voter.role === "mayor" ? 2 : 1;
    counts[v.target_seat] = (counts[v.target_seat] ?? 0) + weight;
    // ردگیری رأی درست
    const tgt = seats.find((s) => s.seat_index === v.target_seat);
    if (tgt && teamOf(tgt.role) === "mafia") voter.meta.correctVotes = (voter.meta.correctVotes ?? 0) + 1;
  }
  let outSeat: number | null = null;
  let maxV = -1;
  let tie = false;
  for (const [id, v] of Object.entries(counts)) {
    if (v > maxV) { maxV = v; outSeat = +id; tie = false; }
    else if (v === maxV) tie = true;
  }
  if (outSeat == null || maxV <= 0 || tie) return { outSeat: null, counts, tie };
  return { outSeat, counts, tie };
}

// ── بررسی برد (پورت checkWin) ─────────────────────────────────────
export function checkWin(seats: Seat[]): Team | null {
  const maf = mafiaAlive(seats).length;
  const city = cityAlive(seats).length;
  if (maf === 0) return "city";
  if (maf >= city) return "mafia";
  return null;
}
