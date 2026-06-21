# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Mafia AI** — a Persian (RTL) single-player Mafia game played against AI bots, fronted by a premium esports-style landing page. It is a **zero-build static site**: plain HTML/CSS/vanilla JS, no framework, no bundler, no transpile step. Persistence (global leaderboard + ELO) is optional and provided by Supabase.

Live: https://mafia-ai-lidamoda.vercel.app · Repo is public (MIT).

## Commands

```bash
npm run dev        # = npx serve .  (any static server works)
python -m http.server 8080   # alternative; then open http://localhost:8080/
```

There is **no build, lint, or test step**. To test a change, open `index.html` (or `mafia-game.html`) directly in a browser — `file://` double-click works because of the routing choice below.

```bash
npx vercel deploy . --prod --yes     # deploy (Vercel project "mafia-ai", team "lidamoda")
```

Database schema lives in `supabase/migrations/` (`0001_init.sql` = players/ELO, `0002_multiplayer.sql` = rooms/seats/events + RLS + pg_cron). Apply by pasting into the Supabase **SQL Editor** (or `supabase db push`). Supabase project ref: `oqnypjgibccarmmwnwyl`.

```bash
# Edge Functions (online multiplayer) — deploy each function dir under supabase/functions/
supabase functions deploy join_room start_or_fill submit_action resolve_phase get_my_state bot_chat
# Only the Claude key is a manual secret — SUPABASE_URL/ANON/SERVICE_ROLE are auto-injected into functions:
supabase secrets set ANTHROPIC_API_KEY=...   # optional; bot_chat falls back to templates without it
```
Online play also needs: Email + Google providers enabled in Auth, `pg_cron`/`pg_net` extensions on, and the service-role key stored in Supabase Vault as `service_role_key` (so the cron `tick_overdue_rooms()` can call `resolve_phase`).

## Architecture

**Two self-contained HTML entry points**, linked by anchor hrefs:
- `index.html` — marketing landing page. Anchor-scroll nav, IntersectionObserver scroll-reveal, canvas particle background. Its CTAs link into the game.
- `mafia-game.html` — the entire game. One big inline `<script>` is the whole engine; there are no modules or components.

**The game is a screen state machine, not a SPA router.** Every "page" is a `.sc` div; `goM(key)` looks up `SC[key]` and toggles the `.on` class. Game state is the single object `G` (players, roles, round, phase, selection). Roles are defined once in the `R` map. Flow: `startReveal → beginGame → nightPhase → (resolveNight) → dayPhase → doVote → tallyVotes → nextRound`, with `checkWin`/`endGame` between rounds. Night actions are submitted via `confirmMafia` / `confirmDoctor` / `confirmDetective`, which all funnel into `resolveNight()`. Bots act inside the night/vote resolution functions; the timer (`startTimer`) auto-picks if the human stalls.

**Deep-linking:** an IIFE at the end of the script reads `?screen=<key>` and calls `goM` for it. Valid keys are whatever exists in `SC` (e.g. `tournament`, `leaderboard`, `lobby`, `rooms`, `profile`, `tutorial`, `custom`). The landing page's "Join Tournament" buttons rely on `mafia-game.html?screen=tournament`.

**Persistence is a graceful dual-mode layer.** `js/supabase-client.js` exposes `window.MafiaDB`. If `js/config.js` has real Supabase values it runs in **ONLINE** mode (writes via Supabase); otherwise it falls back to **LOCAL** mode (localStorage). The game integrates at exactly two guarded touch points:
- `endGame()` calls `MafiaDB.recordMatch(...)`
- `lbTab()` calls `MafiaDB.getLeaderboard()` and overlays results onto the `global` tab
Both are wrapped in `if (window.MafiaDB)` / readiness checks, so the game stays fully playable even if the Supabase scripts fail to load. An anonymous `client_id` (localStorage UUID) is the player identity — there is no auth.

**Server-authoritative ELO.** Clients never write tables directly: RLS denies all anon writes. The only write path is the `record_match` Postgres function (`SECURITY DEFINER`, granted to `anon`), which computes ELO server-side (+15 win / −8 loss) and upserts. `players` is publicly readable (leaderboard); `matches` has no read policy. This means the two Supabase advisor WARNs about an anon-executable `SECURITY DEFINER` function are **intentional** — that is the design.

**Real-time multiplayer (online mode) is server-authoritative.** Because roles are secret, the online game logic does **not** live in the client. There are two parallel engines:
- **Offline/practice** — the original single-player `G`/`launch()` engine in `mafia-game.html` (unchanged; bots only, no auth).
- **Online** — `js/online.js` exposes `window.MafiaOnline`. It handles Supabase **Auth** (email magic-link + Google), joins rooms, subscribes to **Realtime** (`game_events` + `rooms`), and renders server state into the *same* game-screen DOM (`gpArea`, `gActT/D/B`, `sidePl`, etc.) without ever touching `G`. It computes nothing about the game — it only displays what the server returns.

The authority is six **Edge Functions** in `supabase/functions/` over shared logic in `_shared/` (`game.ts` = TS port of `R`/`buildPlayers`/`resolveNight`/`botVoteChoice`/`checkWin`; `engine.ts` = DB-aware start/fill/resolve; `util.ts`). Flow: `join_room` (seat + quorum→countdown) → `start_or_fill` / cron (fill empty seats with **bots**, assign roles, start) → phases advance via `resolve_phase` (idempotent, deadline-driven; called by clients when their local timer hits 0 **and** by `pg_cron` as a safety net) → `submit_action` (night action / vote, validated) → `get_my_state` (per-player filtered view — never leaks others' roles) → `bot_chat` (day discussion via Claude `claude-haiku-4-5`, with a template fallback). The **`role` column in `room_seats` is never client-readable**: clients read the `seats_public` view (no role) and `get_my_state` reveals a role only for the caller, dead players, mafia teammates, or at game end.

## Conventions & gotchas

- **All UI text is hardcoded Persian inline** — there is no i18n dictionary. The site is RTL (`dir="rtl" lang="fa"`). Use the `fa()` helper (defined in `mafia-game.html`) to render Persian digits.
- **Keep `cleanUrls: false` in `vercel.json`.** Links use explicit `.html` so the exact same file opens locally via `file://` and on Vercel. Enabling clean URLs reintroduces a 308 redirect and breaks local double-click parity.
- **`js/config.js` is committed with the public `anon` key on purpose** — it is RLS-protected and safe in a public repo. Never put `service_role` or `ANTHROPIC_API_KEY` client-side; those belong only in Vercel env / Edge Function secrets (see `.env.example`).
- The **leaderboard shows the static `LB` demo object until real games populate `players`**; the `global` tab then replaces it with DB data on first fetch.
- Forkers get a working LOCAL-mode game out of the box; to enable online play they only swap `js/config.js` with their own Supabase project URL + anon key.
- When editing the game, expect to work inside the single large inline script — search for the function names above rather than looking for separate files.
