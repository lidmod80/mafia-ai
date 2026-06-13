/* ─────────────────────────────────────────────────────────────
   MafiaDB — لایهٔ دیتابیس بازی
   ─────────────────────────────────────────────────────────────
   اگر Supabase تنظیم شده باشد: نتایج بازی روی سرور ثبت و لیدربورد
   جهانی خوانده می‌شود. در غیر این صورت همه‌چیز در localStorage
   ذخیره می‌شود تا بازی همیشه (حتی بدون دیتابیس) کار کند.
   ───────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var cfg = window.MAFIA_CONFIG || {};
  var url = (cfg.supabaseUrl || "").trim();
  var key = (cfg.supabaseAnonKey || "").trim();
  var LS = window.localStorage;

  function uid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  var clientId = LS.getItem("mafia_cid");
  if (!clientId) { clientId = uid(); LS.setItem("mafia_cid", clientId); }
  var name = LS.getItem("mafia_name") || "مهمان_" + clientId.slice(0, 4);

  var client = null, ready = false;
  if (url && key && window.supabase && typeof window.supabase.createClient === "function") {
    try { client = window.supabase.createClient(url, key); ready = true; }
    catch (e) { console.warn("[MafiaDB] init failed:", e); }
  }

  function localStats() { try { return JSON.parse(LS.getItem("mafia_stats") || "{}"); } catch (e) { return {}; } }
  function saveLocal(s) { LS.setItem("mafia_stats", JSON.stringify(s)); }

  var MafiaDB = {
    ready: ready,
    clientId: clientId,
    get name() { return name; },

    /** نام نمایشی بازیکن را تغییر می‌دهد (در بازی بعدی روی سرور هم به‌روز می‌شود). */
    setName: function (n) {
      n = (n || "").toString().slice(0, 24).trim();
      if (n) { name = n; LS.setItem("mafia_name", name); }
      return name;
    },

    /** آمار محلی (همیشه در دسترس، مستقل از Supabase). */
    stats: function () {
      var s = localStats();
      return {
        games: s.games || 0,
        wins: s.wins || 0,
        elo: s.elo || 1000,
        winRate: s.games ? Math.round((s.wins / s.games) * 100) : 0,
        roles: s.roles || {}
      };
    },

    /** نتیجهٔ یک بازی را ثبت می‌کند: هم محلی، هم (در صورت اتصال) روی سرور. */
    recordMatch: function (m) {
      m = m || {};
      var s = localStats();
      s.games = (s.games || 0) + 1;
      if (m.won) s.wins = (s.wins || 0) + 1;
      s.elo = Math.max(0, (s.elo || 1000) + (m.won ? 15 : -8));
      s.roles = s.roles || {};
      if (m.role) s.roles[m.role] = (s.roles[m.role] || 0) + 1;
      saveLocal(s);

      if (!ready) return Promise.resolve(false);
      return client.rpc("record_match", {
        p_client_id: clientId,
        p_name: name,
        p_role: m.role || null,
        p_won: !!m.won,
        p_winner: m.winner || null,
        p_rounds: m.rounds || 0,
        p_players: m.players || 0,
        p_mode: m.mode || null
      }).then(function (res) {
        if (res && res.error) console.warn("[MafiaDB] record_match:", res.error.message);
        return !res || !res.error;
      }).catch(function (e) { console.warn("[MafiaDB] record_match failed:", e); return false; });
    },

    /** ۲۰ بازیکن برتر بر اساس ELO. اگر Supabase تنظیم نباشد null برمی‌گرداند. */
    getLeaderboard: function () {
      if (!ready) return Promise.resolve(null);
      return client.from("players")
        .select("name,elo")
        .order("elo", { ascending: false })
        .limit(20)
        .then(function (res) {
          if (res.error) { console.warn("[MafiaDB] leaderboard:", res.error.message); return null; }
          return (res.data || []).map(function (r) { return [r.name, r.elo]; });
        })
        .catch(function (e) { console.warn("[MafiaDB] leaderboard failed:", e); return null; });
    }
  };

  window.MafiaDB = MafiaDB;
  console.info("[MafiaDB] mode:", ready ? "ONLINE (Supabase)" : "LOCAL (localStorage)");
})();
