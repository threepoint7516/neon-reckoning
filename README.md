# NEON RECKONING

A free-to-play, browser-based cyberpunk arena shooter with real authoritative multiplayer. No accounts, no trackers, no paid advantages. Everything you see and hear (map, textures, models, sound, music) is generated procedurally in code. There are no external assets.

- **Modes:** Team Deathmatch, Free-for-All, Domination, Battle Royale, plus offline **Practice** (any mode vs AI) and a **Training Range** tutorial.
- **Party sizes:** Solo, Duo, Trio, Squad, with party codes, invite links, ready checks, leader controls, an opt-in "Fill squad" option and opt-in, clearly labelled AI fill.
- **World:** *Neon Frontier*, a 384 m × 384 m region with 8 districts (Neon City, Rusthaven, Eclipse Harbor, Sector Zero, Chrome Valley, The Outlands, Blacklight Market, Skyrail Station) and an electrified bay. It has interiors with stairs, rooftops, ladders, skybridges, an elevated highway, a tunnel, an underground lab, docks and a cargo ship. Arena modes use one district; Battle Royale uses the whole region.
- **Arsenal:** 10 distinct weapons (AR, SMG, shotgun, sniper, DMR with penetration, LMG, pistol, burst rifle, chain-lightning energy weapon, and an experimental plasma cannon), 4 grenades (frag, smoke, flash, EMP), 4 tactical abilities (recon pulse, deployable shield, proximity mine, remote charge), healing injectors and armor plates.

---

## Architecture

```
┌──────────────────────── Browser (Netlify static hosting) ────────────────────────┐
│ React UI (menus, HUD)  ·  Three.js renderer  ·  Web Audio synth                   │
│ Game runtime: fixed 60 Hz client prediction + server reconciliation,             │
│               interpolation of remote players (100 ms), lag-compensated aim      │
│      │ online: WebSocket (wss://)                │ offline: LocalConnection       │
└──────┼──────────────────────────────────────────┼─────────────────────────────────┘
       ▼                                           ▼
┌──────────── Node.js game server ────────────┐   Same `Match` simulation running
│ ws WebSocket server · lobby · parties ·     │   in the browser with AI bots
│ matchmaking queues · rooms (30 Hz ticks)    │   (Practice/Training, no network)
│ Authoritative `Match` simulation            │
└─────────────────────────────────────────────┘
            ▲ both import ▲
┌──────────────────────── shared/ (TypeScript) ───────────────────────────┐
│ deterministic map generator · AABB collision world · player movement     │
│ weapons & equipment · Match rules (all modes) · bots + A* nav · protocol │
└──────────────────────────────────────────────────────────────────────────┘
```

**Why these choices**

- **Netlify cannot run a persistent multiplayer server.** Static hosting and serverless functions can't hold long-lived WebSocket rooms. Netlify serves only the client; the game server runs on any host that supports persistent Node processes and WebSockets (Render, Fly.io, Railway, a VPS…).
- **Custom authoritative server on `ws` instead of Colyseus.** The shared package contains one deterministic simulation, used three ways: authoritatively on the server, for prediction on the client, and as the offline Practice host. This gives exact client prediction/reconciliation and lag compensation with fewer moving parts. The trade-off is that matchmaking and rooms are hand-written, which is a small amount of code in `server/src/lobby.ts`.
- **Custom AABB physics instead of Rapier.** All world geometry is axis-aligned boxes, so swept-AABB collision is exact, cheap, identical on client and server, and tunnelling-proof. It also avoids loading WASM.
- **Procedural everything.** The map is generated from fixed seeds, so the server and every client build byte-identical geometry without shipping map files.

### What the server is authoritative for

Movement (it simulates every input; clients never send positions), fire rate, ammo and reloads, spread (deterministic per-shot seeds), hit detection with lag compensation (rewind ≤ 300 ms), damage, armor, headshots, kills, assists, scores, objectives, cooldowns, pickups, grenades and gadgets, match timers and win conditions.

Anti-cheat measures: strict schema validation of every message (`shared/src/protocol.ts`), message-size limits, a token-bucket rate limit, a strike system that disconnects abusive clients, input credits that make speed-hacks impossible (a client can't run more simulation steps than real time allows), origin checks on WebSocket upgrades, and name sanitization. No invasive anti-cheat or fingerprinting.

---

## Project structure

```
neon-reckoning/
├─ shared/             # Simulation shared by client & server (no DOM/Node APIs)
│  ├─ src/map/         # frontier.ts (region generator), builder.ts, collision.ts
│  ├─ src/sim/         # player.ts (movement/weapons), match.ts (all game rules), config.ts
│  ├─ src/ai/          # bot.ts (perception, aim, tactics), nav.ts (grid + A*)
│  ├─ src/balance/     # weapons.ts, equipment.ts
│  ├─ src/protocol.ts  # message types + validation
│  └─ test/            # vitest unit tests
├─ server/             # Node WebSocket game server
│  ├─ src/index.ts     # HTTP (/health) + WebSocket, tick loop, graceful shutdown
│  ├─ src/lobby.ts     # sessions, parties, matchmaking, private matches
│  ├─ src/room.ts      # one running match, snapshots, reconnects, cleanup
│  ├─ test/            # end-to-end tests with real WebSocket clients
│  └─ Dockerfile
├─ client/             # Vite + React + Three.js
│  ├─ src/game/        # Game.ts (runtime), input.ts, render/* (world, effects, avatars, viewmodel, entities)
│  ├─ src/net/         # online.ts (WebSocket), local.ts (offline host), connection.ts
│  ├─ src/audio/       # audio.ts (synthesized SFX & music)
│  ├─ src/ui/          # screens + HUD
│  └─ src/state/       # store, settings, session-only challenges
├─ netlify.toml        # client deployment
└─ render.yaml         # example server deployment (Render Blueprint)
```

---

## Running locally

Requirements: Node.js 20+ (developed on Node 24 / npm 12).

```bash
npm install
```

Start the game server (port 2567) and the client (port 5173) in two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open http://localhost:5173. In development the client automatically connects to `ws://<host>:2567`. **Practice and Training need no server at all.**

To test multiplayer locally, open a second browser window, click **Play**, and either join with the party code or open the invite link (`/?party=CODE`).

> npm 12 blocks dependency install scripts by default. Everything here works without them, because esbuild and Vite ship prebuilt platform binaries.

### Build and test

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

`npm run build` produces `client/dist` (static site) and `server/dist/index.js` (bundled server; only runtime dependency is `ws`).

---

## Deployment

### 1. Deploy the game server (persistent Node host)

Any host that keeps a Node process running and supports WebSockets works. You need:

| Setting | Value |
|---|---|
| Build command | `npm ci --include=dev && npm run build:server` |
| Start command | `npm run start:server` (runs `node server/dist/index.js`) |
| Health check | `GET /health` → `{"ok":true,…}` |
| Port | the `PORT` env var (default 2567) |

Server environment variables (server-only, never exposed to browsers; see `server/.env.example`):

| Variable | Purpose |
|---|---|
| `PORT` | Listen port (most hosts set this automatically) |
| `ALLOWED_ORIGINS` | Comma-separated allowed browser origins, e.g. `https://neon-reckoning.netlify.app`. **Required in production**; with it empty, only localhost origins are accepted. |
| `MAX_ROOMS`, `MAX_SESSIONS` | Capacity limits (default 40 / 400) |
| `AI_FILL_WAIT` | Seconds before opt-in AI fill starts a match (default 20) |
| `NODE_ENV` | `production` |

**Render:** the included `render.yaml` is a Blueprint. Create a new Blueprint from your repo and set `ALLOWED_ORIGINS`. Free instances sleep when idle, so the first connection can take ~30–60 s; the client shows "waking up" errors honestly and offers Practice.
**Fly.io / Docker hosts:** build with `docker build -f server/Dockerfile -t neon-reckoning-server .` from the repo root.
**VPS:** run `npm ci && npm run build:server && NODE_ENV=production ALLOWED_ORIGINS=… node server/dist/index.js` behind a TLS proxy (Caddy/nginx) so browsers can use `wss://`.

Browsers on an HTTPS site require **`wss://`**, so the server must be reachable over TLS (all the managed hosts above provide this).

### 2. Deploy the client to Netlify

1. Create a Netlify site from this repository. `netlify.toml` already sets the base, build command (`npm run build:client`), publish directory (`client/dist`), SPA fallback and security headers.
2. In **Site settings → Environment variables** add:
   - `VITE_GAME_SERVER_URL` = `wss://your-game-server.example.com`

   It's a **public** build-time variable that ends up in the JavaScript bundle. Never put secrets in `VITE_*` variables.
3. Deploy. Then add the Netlify URL to the server's `ALLOWED_ORIGINS`.

Without `VITE_GAME_SERVER_URL` the build is still fully usable: Practice and Training work, and Play explains that no multiplayer server is configured. Production builds never fall back to `localhost`.

---

## Privacy

- No accounts, emails, passwords, analytics, ad trackers, cookies, fingerprinting, chat or database.
- **Callsign:** random (e.g. `NeonRaven742`), rerollable or editable, held only in the tab's memory. It's sent to the game server only while you play online so others can see it.
- **Server memory:** names, parties, team assignments, positions and scores exist in RAM only while the party or room exists. Rooms are freed when everyone leaves, 60 s after a match ends, or after 40 minutes at most. Disconnected slots are held for 30 s for reconnection.
- **Server logs** contain only operational events (start, room opened/closed with mode and counts, errors). They never contain names, IPs or message contents.
- **Browser storage:** nothing by default. If the player enables *Settings → Storage → Remember these settings*, only control/graphics/audio/accessibility preferences are saved in `localStorage` (`neon-reckoning:prefs`), never identity or stats.
- Hosting providers (Netlify and your server host) may keep their own standard access logs (IP, time). That is outside the game's control and the in-game Privacy screen says so.

---

## Controls (rebindable in Settings)

| Action | Default |
|---|---|
| Move / jump / sprint | WASD / Space / Left Shift |
| Crouch & slide (sprint then crouch) | C (Ctrl can be bound) |
| Fire / aim down sights | Left / right mouse |
| Reload / interact (pick up, revive) | R / E |
| Weapons | 1 primary · 2 sidearm · 3 power slot · mouse wheel |
| Grenade / cycle grenade type | G / 4 |
| Tactical ability | Q |
| Healing injector / armor plate | F / X |
| Scoreboard / map / pause | Tab (hold) / M / Esc |

Ladders: hold forward to climb, jump to kick off.

---

## Game systems at a glance

- **Movement:** acceleration-based walk/sprint, crouch, slide (with slide-jumps), Quake-style air control, step-up for stairs, ladders, fall damage, BR glide insertion. Speed is hard-capped.
- **Combat:** 100 health + up to 100 armor (absorbs first), headshot multipliers, range falloff, bloom/spread, recoil patterns, out-of-combat regeneration in arena modes, 2.2 s spawn protection (cancelled by firing), fair spawn selection (distance and enemy line of sight), and assists within 8 s.
- **Strategic layer:** power weapons with limited ammo at contested central spots (they drop on death); dynamic *Data Cache* objectives (Overdrive buff + score); kill streaks (3 = team radar sweep, 5 = Overdrive + bounty); bounty shutdowns reward ending streaks (a skill-based comeback); rotating overclocked point in Domination; BR downed/revive (4 s hold, 30 s bleed-out, squad wipe finishes downed players); explosive barrels; electrified water; optional match modifiers (Low Gravity, Headhunter, Overcharge, Glass Cannon, Power Surge, Neon Storm event).
- **Medals:** First Blood, Double/Triple Kill, Rampage, Headshot, Long Shot, Revenge, Bounty Collected, Demolition, Clutch, Airborne, streaks, Capture, Defender, Revive, Data Heist.
- **Session-only progression:** three daily-style challenges generated locally from the date, "this session" stats, and per-match improvement feedback. All of it is gone when the tab closes, and the game says so.
- **AI:** Rookie/Standard/Veteran/Elite bots with limited FOV and range, hearing, smoke and flash awareness, reaction delays, aim error, strafing, cover-seeking at low health, healing, reloading, grenades, tactical use, objective play, looting, revives and stuck recovery. Bots use the same input pipeline as humans (no cheating) and are always named `BOT …` (humans can't register that prefix).
- **Accessibility:** key rebinding, toggle crouch/aim, colour-blind team palette, reduce-motion, head bob/camera shake toggles, visual sound cues for gunfire and footsteps, crosshair style/colour/size, HUD scale, clean competitive HUD, FPS/latency display.
- **Graphics presets:** Low/Medium/High (bloom, rain, shadows, particles, resolution scale). Low is auto-selected on ≤ 4-core machines.

---

## Test results (actually run)

Automated (`npm test`): **49 tests passing.**

- `shared/test` (41): movement (gravity, walk/sprint speeds, no wall tunnelling at 400 m/s, step-up limits, jump height, slide, bounds, determinism), weapons (fire rate, semi/burst/pellets, reload, empty mag, swap delay, falloff, power-weapon ammo, distinct handling), map (determinism, 8 districts, every spawn free of geometry, objectives/pickups present, BR loot), match (bot-filled TDM runs to its score limit; FFA/DOM/BR run to completion; server-side hitscan applies armor-first damage; input flooding can't speed-hack; snapshots serialize under 20 KB), protocol validation and name sanitization.
- `server/test` (8): health endpoint, name sanitization, invalid room codes, party-size enforcement (solo can't queue Squad without Fill), a two-client private match with synchronized movement and server acks, reconnect with token, labelled AI fill after the wait, disconnection of clients spamming invalid frames, and rejection of a disallowed origin.

Manual browser testing (built-in Chromium pane, Intel HD 530 integrated GPU):

- Boot → menu → Practice TDM: the world renders, movement and sprint (~8.1 m/s) work, and the server acked every input. Weapon swap, reload, frag throw, grenade cycling, tactical cooldown, slide (11.6 m/s) and jump all work. Hits are confirmed by the authority, with assists and the kill feed.
- Online: an invite link joined a party, a ready check and private TDM put 2 humans on opposite teams with labelled bot fill, and positions synchronized across clients. **Public matchmaking:** two separate solo players queued FFA with AI fill off; the queue showed honest counts and matched them together (2 humans, 0 bots). Player 1 then pathed to player 2 and eliminated them through server-authoritative combat; both clients showed the kill, damage indicators, First Blood and a Data Cache event.
- Practice Battle Royale (glide insertion, storm, power weapon markers), forced match end → results → Rematch, and online Domination on the **production builds** (`vite preview` + bundled `server/dist`) with zero console errors.
- Performance: ~60 FPS on the Low preset at 1024×768 (≈5 ms CPU per frame), ~30 FPS on Medium with bloom, on that integrated GPU.

Not tested here: the Dockerfile (Docker isn't installed in the dev environment), real deployments to Netlify/Render, Firefox/Safari, load beyond 2 human clients + bots, and high-latency networks.

---

## Known limitations

- **Payload/Extraction mode isn't implemented** and isn't shown in the UI.
- **Capacity is unmeasured.** Rooms tick at 30 Hz and send per-player snapshots (~20–40 KB/s per player, interest-managed at 140 m). A small instance should handle a handful of 8–16-player rooms, but this hasn't been load-tested.
- **Not cheat-proof:** aim is client-controlled (as in every shooter), so aim-assist or no-recoil cheats aren't prevented. Nearby enemies are sent even without line of sight (no anti-wallhack culling).
- **High latency:** lag compensation rewinds at most 300 ms; players above ~250 ms ping will see more corrections.
- **Mobile:** menus are responsive, but gameplay requires keyboard and mouse. There are no touch controls.
- **Visuals:** avatars are procedural box-built models with simple procedural animation (no skeletal animation or ragdolls). Destructibility is limited to barrels, shields, mines and charges.
- **Bots** navigate a ground-level grid: they use stairs and slopes, but rarely ladders or rooftops.
- **Embedded frames:** where pointer lock is unavailable (some iframes or preview panes), the game falls back to free-cursor mouse look.

## Troubleshooting

- **"Server unreachable" on Play:** check that `VITE_GAME_SERVER_URL` uses `wss://` for HTTPS sites, that the server's `/health` responds, and that your site's origin is in `ALLOWED_ORIGINS` (a 403 on the upgrade means it isn't). Free hosts may need ~1 minute to wake up.
- **"Client out of date":** the client and server protocol versions differ (`PROTOCOL_VERSION`). Redeploy both from the same commit.
- **Black screen or renderer error:** enable hardware acceleration, update the browser, or pick the Low preset. The error panel offers a one-click switch.
- **Low FPS:** use the Low preset, lower the resolution scale, disable rain and shadows.
- **Mouse not captured:** click the game view. Esc releases the mouse and opens the menu.
