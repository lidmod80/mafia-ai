/* ─────────────────────────────────────────────────────────────
   MafiaOnline — لایهٔ بازی آنلاین چندنفره (کنار موتور تک‌نفره)
   • احراز هویت با Supabase Auth (ایمیل magic-link + گوگل)
   • پیوستن به اتاق، حد نصاب، و پُرشدن خودکار با بات (سمت‌سرور)
   • وضعیت بازی server-authoritative است؛ این‌جا فقط رندر می‌شود.
   منطق امن در Edge Functions اجرا می‌شود؛ این فایل هیچ نقشی را
   محاسبه نمی‌کند — فقط آنچه سرور مجاز بداند نمایش می‌دهد.
   ───────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  const cfg = window.MAFIA_CONFIG || {};
  const hasSB = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = hasSB ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const FN = hasSB ? cfg.supabaseUrl.replace(/\/$/, "") + "/functions/v1" : "";

  // ابزارها (بازاستفاده از کمک‌کننده‌های موتور اصلی در صورت وجود)
  const $ = (id) => document.getElementById(id);
  const fa = window.fa || ((n) => String(n));
  const toast = window.toast_ || ((m) => console.log(m));
  const ICON = { mafia: "🔫", doctor: "💉", detective: "🔍", citizen: "👤", sniper: "🎯", mayor: "🏛️", bodyguard: "🛡️", joker: "🃏" };
  const RNAME = { mafia: "مافیا", doctor: "دکتر", detective: "کارآگاه", citizen: "شهروند", sniper: "تک‌تیرانداز", mayor: "شهردار", bodyguard: "محافظ", joker: "جوکر" };
  const rname = (r) => RNAME[r] || r;

  let user = null;
  let OG = null;             // وضعیت بازی آنلاین جاری
  let channel = null;        // کانال Realtime
  let poll = null;           // پولِ پشتیبان
  let busy = false;          // قفل جلوگیری از resolve هم‌زمان
  let curKey = "";           // کلید فاز برای تشخیص تغییر
  let pending = null;        // پیوستنِ معلق تا بعد از ورود (mode/roomId)

  // ── HTTP به Edge Function ───────────────────────────────────────
  async function call(fn, body) {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token || cfg.supabaseAnonKey;
    const res = await fetch(FN + "/" + fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "apikey": cfg.supabaseAnonKey },
      body: JSON.stringify(body || {}),
    });
    return res.json().catch(() => ({ error: "bad response" }));
  }

  // ── احراز هویت ──────────────────────────────────────────────────
  async function refreshUser() {
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    user = data?.user || null;
    updateAuthUI();
    return user;
  }
  function updateAuthUI() {
    const b = $("authBtn");
    if (b) b.textContent = user ? "👤 " + ((user.user_metadata?.name || user.email || "حساب").slice(0, 12)) : "ورود";
  }
  function openAuth() { if ($("authModal")) $("authModal").classList.remove("dn"); }
  function closeAuth() { if ($("authModal")) $("authModal").classList.add("dn"); }
  async function signInEmail() {
    const email = ($("authEmail")?.value || "").trim();
    if (!email) return toast("ایمیل را وارد کن");
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
    toast(error ? error.message : "لینک ورود به ایمیلت فرستاده شد ✉️");
  }
  async function signInGoogle() {
    await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } });
  }
  async function signOut() { await sb.auth.signOut(); user = null; updateAuthUI(); toast("خارج شدی"); }

  // ── شروع بازی آنلاین ─────────────────────────────────────────────
  async function playOnline(mode, roomId) {
    if (!sb) return toast("حالت آنلاین پیکربندی نشده است");
    await refreshUser();
    if (!user) { pending = { mode, roomId }; openAuth(); return toast("برای بازی آنلاین اول وارد شو"); }
    toast("در حال پیوستن به اتاق...");
    const r = await call("join_room", roomId ? { room_id: roomId } : { mode });
    if (r.error) return toast("خطا: " + r.error);
    OG = { room_id: r.room_id, seat: r.seat_index, mode: mode || r.mode || "classic", chat: {} };
    curKey = "";
    enterRoom();
  }
  // پیوستن به یک اتاقِ مشخص (از لیست یا لینک دعوت)
  const joinRoomById = (roomId) => playOnline(null, roomId);

  // لیست زندهٔ اتاق‌های قابل‌پیوستن (از جدول rooms که عمومی خواندنی است)
  async function listRooms() {
    const el = $("roomList");
    if (!el || !sb) return;
    const { data: rooms } = await sb.from("rooms")
      .select("id,name,mode,status,min_players,max_players")
      .in("status", ["waiting", "countdown"]).order("created_at", { ascending: false }).limit(30);
    const { data: seats } = await sb.from("seats_public").select("room_id");
    const cnt = {};
    (seats || []).forEach((s) => { cnt[s.room_id] = (cnt[s.room_id] || 0) + 1; });
    const list = (rooms || []).filter((r) => (cnt[r.id] || 0) < r.max_players);
    if (!list.length) {
      el.innerHTML = '<div class="gs" style="text-align:center;color:var(--tx2);font-size:12px">اتاق بازی نیست — یکی بساز! از لابی «بازی آنلاین» را بزن.</div>';
      return;
    }
    const modeFa = { classic: "کلاسیک", ranked: "رنکد", quick: "سریع", beginner: "مبتدی", custom: "سفارشی" };
    el.innerHTML = list.map((r) => {
      const c = cnt[r.id] || 0; const live = r.status === "countdown";
      return `<div class="gs fc g3g">
        <div style="flex:1">
          <div class="fc g2g">${live ? '<span class="ld"></span>' : ""}<span class="h4">${r.name}</span>${live ? '<span class="bx bx-gr">در حال شروع</span>' : ""}</div>
          <div style="font-size:10px;color:var(--tx2);margin-top:3px">${modeFa[r.mode] || r.mode} · ${fa(c)}/${fa(r.max_players)} بازیکن</div>
        </div>
        <button class="btn btn-p btn-xs" onclick="MafiaOnline.joinRoomById('${r.id}')">ورود</button>
      </div>`;
    }).join("");
  }

  // کپی لینک دعوت اتاق جاری
  function shareRoom() {
    if (!OG) return;
    const url = location.origin + location.pathname + "?room=" + OG.room_id;
    const done = () => toast("لینک دعوت کپی شد — برای دوستت بفرست ✉️");
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt("لینک دعوت:", url));
    else prompt("لینک دعوت:", url);
  }

  function enterRoom() {
    cleanup();
    channel = sb.channel("room:" + OG.room_id)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_events", filter: "room_id=eq." + OG.room_id }, () => sync())
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: "id=eq." + OG.room_id }, () => sync())
      .subscribe();
    poll = setInterval(sync, 2500);
    sync();
  }

  function cleanup() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (poll) { clearInterval(poll); poll = null; }
  }
  function leaveRoom() { cleanup(); OG = null; if (window.goM) goM("lobby"); }

  // ── همگام‌سازی وضعیت از سرور ─────────────────────────────────────
  async function sync() {
    if (!OG) return;
    const s = await call("get_my_state", { room_id: OG.room_id });
    if (s.error) return;
    OG.state = s;
    render(s);
    advance(s);
  }

  // پیشروی فاز (وقتی مهلت گذشت) + تریگر چت روز
  async function advance(s) {
    const r = s.room;
    const dl = r.phase_deadline || r.start_deadline;
    if (dl && Date.parse(dl) <= Date.now() + 200 && !busy && (r.status === "countdown" || r.status === "playing")) {
      busy = true;
      await call("resolve_phase", { room_id: OG.room_id });
      busy = false;
      sync();
    }
    if (r.status === "playing" && r.phase === "day" && !OG.chat[r.round]) {
      OG.chat[r.round] = true;
      call("bot_chat", { room_id: OG.room_id }).then(() => sync());
    }
  }

  // ── رندر ─────────────────────────────────────────────────────────
  function render(s) {
    const r = s.room;
    if (r.status === "waiting" || r.status === "countdown") return renderWaiting(s);
    if (r.status === "finished") return renderWin(s);
    if (r.status === "playing") {
      if (r.phase === "reveal") return renderReveal(s);
      return renderGame(s);
    }
  }

  // لابی انتظار + شمارش معکوس
  function renderWaiting(s) {
    if (window.goM) goM("waiting");
    const r = s.room;
    const seats = s.seats || [];
    $("wtName").textContent = r.name || "اتاق";
    $("wtCount").textContent = fa(seats.length) + "/" + fa(r.max_players) + " بازیکن (حداقل " + fa(r.min_players) + ")";
    $("wtSeats").innerHTML = seats.map((p) => `
      <div class="gs fc g2g">
        <span style="font-size:18px">${p.is_me ? "😎" : "🙂"}</span>
        <span style="flex:1${p.is_me ? ";color:var(--red);font-weight:700" : ""}">${p.name}${p.is_me ? " (تو)" : ""}</span>
        <span class="bx bx-gr">آماده</span>
      </div>`).join("");
    // شمارش معکوس
    if (r.status === "countdown" && r.start_deadline) {
      const left = Math.max(0, Math.round((Date.parse(r.start_deadline) - Date.now()) / 1000));
      $("wtTimer").textContent = "شروع تا " + fa(left) + " ثانیه (صندلی‌های خالی با بات پر می‌شوند)";
    } else {
      $("wtTimer").textContent = "در انتظار بازیکنان بیشتر...";
    }
    $("wtStart").style.display = s.me?.is_host ? "" : "none";
  }
  async function forceStart() { if (OG) { await call("start_or_fill", { room_id: OG.room_id }); sync(); } }

  // نمایش کارت نقش
  function renderReveal(s) {
    if (window.goM) goM("reveal");
    const role = s.me?.role;
    if (!role) return;
    $("revIc").textContent = ICON[role] || "?";
    $("revRN").textContent = s.me.role_name || role;
    $("revRD").textContent = "نقش مخفی تو";
    $("flipI").classList.add("done");
    $("revRoleInfo").classList.remove("dn");
    $("revRoleExtra").innerHTML = `<b>${s.me.role_name}</b> — نقشت را به خاطر بسپار. بازی به‌زودی شروع می‌شود.`;
    const left = s.room.phase_deadline ? Math.max(0, Math.round((Date.parse(s.room.phase_deadline) - Date.now()) / 1000)) : 0;
    $("revProgress").textContent = "شروع خودکار تا " + fa(left) + " ثانیه";
    $("revSt").classList.add("dn");
    $("revNxt").classList.add("dn");
  }

  // صفحهٔ بازی (شب/روز/رأی)
  function renderGame(s) {
    if (window.goM) goM("game");
    const r = s.room, me = s.me, seats = s.seats;
    const night = r.phase === "night";
    $("ptag").className = "ptag " + (night ? "pt-n" : "pt-d");
    $("ptag").textContent = (night ? "🌙 شب " : "☀️ روز ") + fa(r.round);
    $("phaseLbl").textContent = night ? "فاز شب" : "فاز روز";
    $("roundLbl").textContent = "دور " + fa(r.round);

    // پنل کناری بازیکنان
    $("sidePl").innerHTML = seats.map((p) => `
      <div class="fc g2g" style="padding:4px 6px;border-radius:6px;background:${p.alive ? "var(--bg3)" : "transparent"};opacity:${p.alive ? 1 : .4};font-size:11px">
        <span>${p.alive ? (p.role ? (ICON[p.role] || "🙂") : "🙂") : "💀"}</span>
        <span style="flex:1;${p.is_me ? "color:var(--red);font-weight:700" : ""}">${p.name}</span>
        ${p.is_me ? `<span style="font-size:9px;color:var(--gold)">${me.role_name}</span>` : (p.mafia_peer ? `<span style="font-size:9px;color:var(--red)">همدست</span>` : "")}
      </div>`).join("");

    renderLog(s);
    renderChat(s);
    renderTimer(s);

    const phaseKey = r.status + r.phase + r.round;
    // grid + action بسته به فاز و نقش
    if (!me || !me.alive) {
      netGrid(s, false);
      window.setAction?.("تو حذف شده‌ای 💀", "به‌عنوان تماشاگر منتظر بمان.", []);
      $("gVotes").classList.add("dn");
      curKey = phaseKey; return;
    }

    if (night) {
      $("gVotes").classList.add("dn");
      const act = nightActionType(me.role);
      if (act) {
        netGrid(s, true);
        window.setAction?.(nightTitle(me.role), nightDesc(me.role), [
          { label: "ثبت", cls: "btn-p", fn: () => submitNight(act) },
        ]);
      } else {
        netGrid(s, false);
        window.setAction?.("🌙 شب است", "نقش تو در شب اقدامی ندارد. منتظر بمان...", []);
      }
    } else if (r.phase === "day") {
      $("gVotes").classList.add("dn");
      netGrid(s, false);
      const btns = [];
      if (me.is_host) btns.push({ label: "شروع رأی‌گیری 🗳️", cls: "btn-p", fn: () => forceResolve() });
      window.setAction?.("☀️ بحث روز", "بازیکنان در حال صحبت‌اند. به‌زودی رأی‌گیری شروع می‌شود.", btns);
    } else if (r.phase === "day-vote") {
      netGrid(s, true);
      window.setAction?.("🗳️ رأی‌گیری", "به نظرت چه کسی مافیاست؟ یک نفر را انتخاب کن.", [
        { label: "ثبت رأی", cls: "btn-p", fn: () => submitVote(OG.sel) },
        { label: "رأی نمی‌دهم", cls: "btn-g", fn: () => submitVote(null) },
      ]);
      renderVotes(s);
    }
    curKey = phaseKey;
  }

  function nightActionType(role) {
    return role === "mafia" ? "kill" : role === "doctor" ? "save" : role === "detective" ? "check" : role === "bodyguard" ? "guard" : null;
  }
  const nightTitle = (r) => ({ mafia: "🔫 نوبت مافیا", doctor: "💉 نوبت دکتر", detective: "🔍 نوبت کارآگاه", bodyguard: "🛡️ نوبت محافظ" }[r] || "شب");
  const nightDesc = (r) => ({
    mafia: "یک شهروند را برای حذف انتخاب کن.",
    doctor: "یک نفر را برای نجات انتخاب کن (می‌توانی خودت را هم نجات دهی).",
    detective: "هویت یک بازیکن را بررسی کن.",
    bodyguard: "از یک بازیکن محافظت کن.",
  }[r] || "");

  // شبکهٔ هدف‌ها
  function netGrid(s, selectable) {
    const me = s.me;
    const canTargetSelf = me?.role === "doctor";
    $("gpArea").innerHTML = (s.seats || []).filter((p) => p.alive).map((p) => {
      const off = !selectable || (p.is_me && !canTargetSelf);
      const sel = OG.sel === p.seat;
      const ic = p.is_me ? "😎" : (p.mafia_peer ? "🔫" : "🙂");
      return `<div class="pcard ${off ? "off" : ""} ${sel ? "sel" : ""}" data-id="${p.seat}" ${off ? "" : `onclick="MafiaOnline._pick(${p.seat})"`}>
        <div style="font-size:22px;margin-bottom:4px">${ic}</div>
        <div class="h4" style="font-size:12px">${p.name}</div>
        ${p.is_me ? '<div style="font-size:9px;color:var(--red);margin-top:2px">شما</div>' : (p.mafia_peer ? '<div style="font-size:9px;color:var(--red);margin-top:2px">همدست</div>' : "")}
      </div>`;
    }).join("");
  }
  function pick(id) {
    OG.sel = id;
    document.querySelectorAll("#gpArea .pcard").forEach((c) => c.classList.toggle("sel", +c.dataset.id === id));
  }

  async function submitNight(action) {
    if (OG.sel == null) return toast("یک نفر را انتخاب کن");
    const r = await call("submit_action", { room_id: OG.room_id, action_type: action, target_seat: OG.sel });
    if (r.error) return toast(r.error);
    if (action === "check" && r.result) toast(`🔍 ${r.result.name}: ${r.result.isMafia ? "مافیاست! 🔫" : "بی‌گناه ✓"}`);
    else toast("ثبت شد ✓");
    window.setAction?.("✓ ثبت شد", "منتظر بقیه بمان...", []);
  }
  async function submitVote(target) {
    const r = await call("submit_action", { room_id: OG.room_id, action_type: "vote", target_seat: target });
    if (r.error) return toast(r.error);
    toast(target == null ? "رأی ندادی" : "رأی ثبت شد ✓");
    window.setAction?.("✓ رأیت ثبت شد", "منتظر نتیجهٔ رأی‌گیری بمان...", []);
  }
  async function forceResolve() { if (OG) { await call("resolve_phase", { room_id: OG.room_id }); sync(); } }

  // تایمر فاز (نمایش از روی phase_deadline)
  function renderTimer(s) {
    const dl = s.room.phase_deadline;
    if (!dl) { $("trN").textContent = "–"; return; }
    const left = Math.max(0, Math.round((Date.parse(dl) - Date.now()) / 1000));
    const total = 30, circ = 132;
    $("trN").textContent = fa(left);
    const fi = $("trFi");
    fi.style.strokeDashoffset = circ * (1 - Math.min(1, left / total));
    fi.style.stroke = left <= 5 ? "var(--red)" : left <= 10 ? "var(--gold)" : "var(--blue)";
  }

  // لاگ رویدادها (متن فارسی)
  function evtLine(e) {
    const p = e.payload || {};
    switch (e.type) {
      case "phase": return p.phase === "night" ? "🌙 شب " + fa(e.round) : p.phase === "day" ? "☀️ روز " + fa(e.round) : p.phase === "day-vote" ? "🗳️ رأی‌گیری" : "";
      case "death": return "💀 " + p.name + " کشته شد";
      case "save": return "🛡️ دکتر یک نفر را نجات داد";
      case "vote_result": return p.out != null ? "🗳️ " + p.name + " حذف شد (" + rname(p.role) + ")" : "🗳️ رأی برابر، حذفی نبود";
      case "system": return p.msg || "";
      default: return "";
    }
  }
  function renderLog(s) {
    const lines = (s.events || []).map(evtLine).filter(Boolean).slice(-8).reverse();
    $("gLog").innerHTML = lines.map((l) => `<div style="padding:3px 0;border-bottom:1px solid var(--bd)">${l}</div>`).join("");
    // روایتگر = آخرین رویداد مهم
    const last = (s.events || []).slice().reverse().find((e) => ["death", "save", "vote_result", "phase"].includes(e.type));
    if (last) window.setNar?.(narText(last));
  }
  function narText(e) {
    const p = e.payload || {};
    if (e.type === "death") return `☀️ <strong>سپیده دمید.</strong> جسد <b style="color:var(--red)">${p.name}</b> پیدا شد.`;
    if (e.type === "save") return "☀️ <strong>سپیده دمید.</strong> دکتر قربانی را نجات داد — کسی نمرد.";
    if (e.type === "vote_result") return p.out != null ? `🗳️ <b style="color:var(--red)">${p.name}</b> با رأی حذف شد. نقشش <b>${rname(p.role)}</b> بود.` : "🗳️ رأی‌ها برابر شد — کسی حذف نشد.";
    if (e.type === "phase" && p.phase === "night") return "🌙 <strong>شب فرا رسید.</strong> شهر به خواب می‌رود...";
    return "";
  }
  // چت روزِ AI
  function renderChat(s) {
    const chats = (s.events || []).filter((e) => e.type === "chat");
    const last = chats[chats.length - 1];
    if (!last) { $("aiH").innerHTML = '<span style="color:var(--tx3)">در حال تحلیل...</span>'; return; }
    $("aiH").innerHTML = (last.payload.lines || []).map((l) => `<div style="padding:2px 0">${l}</div>`).join("");
  }
  // رأی‌های زنده
  function renderVotes(s) {
    const vr = (s.events || []).filter((e) => e.type === "vote_result").pop();
    if (!vr) { $("gVotes").classList.add("dn"); return; }
    const counts = vr.payload.counts || {};
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map((e) => e[1]));
    const nameOf = (seat) => (s.seats.find((p) => p.seat === +seat)?.name) || "?";
    $("gVotes").classList.remove("dn");
    $("voteRows").innerHTML = entries.map(([seat, v]) =>
      `<div class="vrow"><span style="width:70px;font-size:11px">${nameOf(seat)}</span><div class="vm"><div class="vm-f" style="width:${v / max * 100}%"></div></div><span style="font-size:11px;font-weight:700;width:20px;text-align:left">${fa(v)}</span></div>`
    ).join("");
    $("voteSummary").textContent = vr.payload.out != null ? `${vr.payload.name} حذف شد.` : "رأی برابر — کسی حذف نشد.";
  }

  // صفحهٔ پایان
  function renderWin(s) {
    const end = (s.events || []).slice().reverse().find((e) => e.type === "end");
    const roster = end?.payload?.roster || s.seats.map((p) => ({ seat: p.seat, name: p.name, role: p.role, team: null, alive: p.alive, is_bot: p.is_bot }));
    const winner = end?.payload?.winner || s.room.winner;
    const meWon = winner === "joker" ? (s.me?.seat === end?.payload?.jokerSeat) : winner === s.me?.team;

    if (window.goM) goM("win");
    $("wEm").textContent = winner === "mafia" ? "🔫" : winner === "joker" ? "🃏" : "🏙️";
    $("wTi").textContent = winner === "mafia" ? "مافیا برنده شد!" : winner === "joker" ? "جوکر برنده شد!" : "شهروندان بردند!";
    $("wSu").textContent = winner === "mafia" ? "مافیا کنترل شهر را به دست گرفت" : winner === "joker" ? "جوکر با حذف‌شدن به هدفش رسید" : "تمام مافیاها حذف شدند";
    $("wR").textContent = fa(s.room.round);
    $("wE").textContent = fa(roster.filter((p) => !p.alive).length);
    $("wS").textContent = fa(roster.filter((p) => p.alive).length);
    $("wMvp").textContent = "—"; $("wBl").textContent = "—"; $("wBlS").textContent = "";
    $("wCh").innerHTML = ""; $("wChL").innerHTML = "";
    $("wRoles").innerHTML = roster.map((p) => {
      const rn = rname(p.role);
      return `<div class="gi" style="text-align:center;padding:8px 4px;${p.seat === s.me?.seat ? "border-color:var(--red)" : ""}">
        <div style="font-size:18px">${ICON[p.role] || "👤"}</div>
        <div class="h4" style="font-size:11px;margin-top:2px">${p.name}</div>
        <div style="font-size:9px;color:var(--tx2);margin-top:1px">${rn}</div>
        <div style="font-size:9px;color:var(--tx3)">${p.alive ? "زنده" : "حذف"}</div>
      </div>`;
    }).join("");
    $("wXP").classList.remove("dn");
    $("wXP").innerHTML = meWon ? `🏆 بردی! +${fa(50)} XP · +${fa(15)} ELO` : `💀 باختی. +${fa(10)} XP · -${fa(8)} ELO`;
    cleanup(); // بازی تمام شد، دیگر نیازی به subscription نیست
  }

  // بازی مجدد آنلاین (override کردن دکمهٔ موجود)
  const _restart = window.restartGame;
  window.restartGame = function () {
    if (OG) { const m = OG.mode; const old = OG; OG = null; if (window.MafiaOnline) MafiaOnline.playOnline(m); }
    else if (_restart) _restart();
  };

  // اگر بعد از ورود، پیوستنِ معلقی هست، ادامه بده
  function resumePending() {
    if (user && pending) { const p = pending; pending = null; closeAuth(); playOnline(p.mode, p.roomId); }
  }

  // تازه‌سازی زندهٔ لیست اتاق‌ها وقتی صفحهٔ «اتاق‌ها» باز می‌شود
  if (hasSB) {
    const sr = $("scRooms");
    if (sr) new MutationObserver(() => { if (sr.classList.contains("on")) listRooms(); })
      .observe(sr, { attributes: true, attributeFilter: ["class"] });
  }

  // راه‌اندازی auth + دیپ‌لینکِ دعوت (?room=<id>)
  if (sb) {
    sb.auth.onAuthStateChange((_e, session) => { user = session?.user || null; updateAuthUI(); resumePending(); });
    const roomParam = new URLSearchParams(location.search).get("room");
    refreshUser().then(() => {
      if (roomParam) { pending = { roomId: roomParam }; if (user) resumePending(); else { openAuth(); toast("برای پیوستن به اتاقِ دعوت، وارد شو"); } }
    });
  }

  window.MafiaOnline = {
    playOnline, joinRoomById, listRooms, shareRoom, openAuth, closeAuth,
    signInEmail, signInGoogle, signOut, leaveRoom, forceStart, _pick: pick, available: hasSB,
  };
})();
