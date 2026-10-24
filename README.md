# NEON RECKONING

A free-to-play, browser-based arena shooter set in a bright, toy-like city at night, with real authoritative multiplayer. No accounts, no trackers, no paid advantages. Everything you see and hear (map, textures, models, sound, music) is generated procedurally in code. There are no external assets.

- **Modes:** Team Deathmatch, Free-for-All, **Gun Game**, Domination, Payload (escort), Battle Royale, plus offline **Practice** (any mode vs AI) and a **Training Range** tutorial.
- **Party sizes:** Solo, Duo, Trio, Squad, with party codes, invite links, ready checks, leader controls, an opt-in "Fill squad" option for Battle Royale and opt-in, clearly labelled AI fill.
- **Match sizes:** online TDM, Domination and Payload are always 6v6 (your party stays together on one team), FFA has 12 players and Battle Royale 24. Practice defaults to a full 6v6 and goes up to 8v8.
- **Bots fill the gaps (AI fill on by default, always labelled `BOT`):** when nobody else is online, a queued match starts in about 2 s, filled with bots. When other players are online it waits 8 s for them first. Players who queue while a public match of the same mode is running drop straight into it, taking a bot's slot, and a bot takes over the slot of anyone who leaves, so teams stay full. Private matches never take drop-ins.
- **World:** *Neon Frontier*, a 384 m × 384 m region with 8 districts (Neon City, Rusthaven, Eclipse Harbor, Sector Zero, Chrome Valley, The Outlands, Blacklight Market, Skyrail Station) and an electrified bay. Each district is a dense, Krunker-style street grid: a 4 × 4 grid of 23 m city blocks separated by 7 m streets, with an 11 m central boulevard running east–west. There is almost no open ground. Blocks are packed with buildings whose floors are split into furnished rooms with doorways, plus inside and outdoor staircases, rooftops, ladders and rooftop bridges across the side streets. Each district has its own landmark: an elevated highway, an elevated railway, an underground lab, a container maze, docks and a cargo ship, a radio tower, and more. The whole map is ~28,500 axis-aligned boxes. Arena modes use one district; Battle Royale uses the whole region.
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
│  └─ src/state/       # store, settings, session-only challenges and progression (XP, levels, camos)
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
| `AI_FILL_WAIT` | Seconds a queued party waits for other players before AI fill starts the match (default 8) |
| `AI_FILL_WAIT_ALONE` | Same, when no other player is online and free to join (default 2) |
| `NODE_ENV` | `production` |

**Render:** the included `render.yaml` is a Blueprint. Create a new Blueprint from your repo and set `ALLOWED_ORIGINS`. It uses the **free** plan, whose instances sleep when idle, so the first connection can take ~30–60 s; the client shows "waking up" errors honestly and offers Practice. Change `plan: free` to `plan: starter` (paid) for an always-on server.
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

### 3. Earning from the game (optional)

Your own site stays **ad-free and tracker-free**. Money comes from two optional, separate things:

**a) A "Support the game" link on your own site.**
1. Create a free page on Ko-fi or Buy Me a Coffee.
2. In Netlify, go to **Site configuration → Environment variables** and add `VITE_SUPPORT_URL` = your page's `https://` address.
3. Redeploy: **Deploys → Trigger deploy → Deploy site**.

What players see and what's sent:
- A "♥ Support the game" button on the main menu and the results screen, and a short note on the Privacy page.
- It's a plain link: nothing is sent anywhere unless the player clicks it.
- It never appears in the portal builds, because the portals don't allow outside links.

**b) Game portals (CrazyGames, Poki) that show their own ads and share the money with you.**

There's a separate build for each portal. It loads only that portal's toolkit (SDK) and tells the portal when loading finishes and when a match starts and stops. It requests an ad only at a natural break: when the player leaves the results screen. The game is muted while an ad plays. If an ad is skipped, blocked or fails, the game carries on, and a timeout makes sure it can never freeze.

1. **Point the build at your server.** Create a file `client/.env.local` containing the line `VITE_GAME_SERVER_URL=wss://your-game-server.onrender.com`. The file isn't uploaded to GitHub.
2. **Build:**
   - CrazyGames: `npm run build:crazygames` → `client/dist-crazygames/`
   - Poki: `npm run build:poki` → `client/dist-poki/`
3. **Zip** the *contents* of that folder, so that `index.html` sits at the top of the zip.
4. **Submit:**
   - CrazyGames: upload the zip in the CrazyGames developer portal (developer.crazygames.com) and test it with their preview and QA tools before submitting.
   - Poki: Poki is curated, so apply through Poki for Developers. They'll have you upload the zip to their Inspector to test.
5. **Allow the portal on your game server.** On Render, add the portal's domain to `ALLOWED_ORIGINS` with a wildcard. Separate entries with commas, for example `https://your-site.netlify.app,https://*.crazygames.com`.
   - If online play doesn't connect from the portal, open your server's **Logs** on Render. Rejected connections are logged as `rejected upgrade from disallowed origin "https://…"`. Add that address, or a wildcard covering it.

The portal builds' Privacy page says plainly that the portal shows ads and may use cookies under its own privacy policy.

---

## Privacy

- No accounts, emails, passwords, analytics, ad trackers, cookies, fingerprinting, chat or database. This applies to your own site. In the optional portal builds, the portal (CrazyGames/Poki) shows ads and may use cookies under its own policy, and the in-game Privacy page says so.
- **Callsign:** random (e.g. `NeonRaven742`), rerollable or editable, held only in the tab's memory. It's sent to the game server only while you play online so others can see it.
- **Server memory:** names, parties, team assignments, positions and scores exist in RAM only while the party or room exists. Rooms are freed when everyone leaves, 60 s after a match ends, or after 40 minutes at most. Disconnected slots are held for 30 s for reconnection.
- **Server logs** contain only operational events (start, room opened/closed with mode and counts, the website address of rejected connections, errors). They never contain names, IPs or message contents.
- **Browser storage:** nothing by default. There are two separate opt-ins, both in *Settings → Storage* and both off by default:
  - *Remember these settings* saves only control/graphics/audio/accessibility preferences in `localStorage` (`neon-reckoning:prefs`).
  - *Remember my level, XP and weapon finish* saves exactly two values, `{ v: 1, xp, camo }`, in `localStorage` (`neon-reckoning:progress`). Your level is recomputed from total XP on load, and malformed or out-of-range data is ignored. Turning the option off deletes the key.

  Neither is ever sent to the server, and neither contains your callsign, match history or per-match stats.
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

- **Movement:** acceleration-based walk/sprint, crouch, slide (with slide-jumps and **slide-hopping**: land with crouch held to flow straight into another slide and keep your speed), **double jump**, Quake-style air control, step-up for stairs (with camera smoothing so steps don't jolt the view), ladders, **jump pads** (64 on the map: rooftop launchers that always land you on the roof, plus bounce pads in squares), fall damage (cancelled after a pad launch), BR glide insertion. Speed is hard-capped.
- **Loot crates:** 120 breakable crates in rooms and on streets. Shoot or blast one open and it pops (with confetti) into a random pickup; crates respawn in arena modes. All crate and pad logic is server-authoritative and predicted on the client.
- **Look & feel:** toon-shaded bright city, candy-coloured buildings and props, and a fixed night setting (there is no day cycle): a moonlit sky with stars and drifting clouds, cool neutral moonlight bright enough to read the whole street, and lit windows, shop signs, lanterns and street lamps. Hits show floating damage numbers; eliminations burst into confetti.
- **Combat:** 100 health + up to 100 armor (absorbs first), headshot multipliers, range falloff, bloom/spread, recoil patterns, out-of-combat regeneration in arena modes, 2.2 s spawn protection (cancelled by firing), fair spawn selection (distance and enemy line of sight), and assists within 8 s.
- **Strategic layer:** power weapons with limited ammo at contested central spots (they drop on death); dynamic *Data Cache* objectives (Overdrive buff + score); kill streaks with a HUD meter showing the next reward (3 = team radar sweep, 5 = Overdrive + bounty, 8 = full restock of health, armor and ammo plus a long Overdrive); bounty shutdowns reward ending streaks (a skill-based comeback); rotating overclocked point in Domination (owned points score every 2 s, first to 250); BR downed/revive (4 s hold, 30 s bleed-out, squad wipe finishes downed players); explosive barrels; electrified water; optional match modifiers (Low Gravity, Headhunter, Overcharge, Glass Cannon, Power Surge, Neon Storm event).
- **Battle Royale:** 24 players glide in over the whole region and fight as the storm closes in five phases (about 6 minutes if it runs to the last circle).
  - **Second chance:** anyone eliminated in the first 90 s glides back in once over the safe zone, with a fresh pistol.
  - **Supply drops:** from 70 s on, one lands inside the next safe zone about every 55 s. It's announced, marked as DROP on the map and lit by a tall beam, and contains a power weapon, armor, a plate and ammo.
  - **Ammo:** the starting pistol comes with 3 spare magazines, and guns picked up in Battle Royale come with 2.
  - **Countdown:** the game announces when 10, 5 and 3 players or squads are left, and the final two.
  - **Bots:** they only go for loot they can use, fetch ammo or a gun when they run dry instead of fighting empty-handed, and fight on the move into the safe zone. Once looted, they rotate toward the next circle and hunt nearby opponents.
  - **Pacing (deliberate, practice-friendly):** bots prefer real players as targets, and for the first 150 s they only start fights with other bots up close. Bot-vs-bot damage is also scaled to 40%, so the field is still busy when you're ready to fight. In simulated 24-player matches, 13–17 bots are still alive after one minute and 9–12 after two.
- **Payload:** attackers (team 0) escort a data-core cart along a track through the district; defenders (team 1) stop it. The cart moves while at least one attacker is within 5 m and no defender is (a little faster with more escorts), stalls when contested, and rolls back after 8 s alone, never past the last checkpoint. Attackers start with 3:00; each of the two checkpoints (at ⅓ and ⅔ of the track) adds 60 s. Attackers win on delivery; defenders win when time runs out, with up to 60 s of overtime while attackers are on the cart. Each district's track is derived deterministically by A* on the walkability grid (west end of the central boulevard → A → B → C → east end, restricted to flat cells with room for the cart, then string-pulled) and is unit-tested to never intersect geometry. Attackers spawn on the street a short way behind the cart (outdoor spawn points only), defenders ahead of it; the cart moves at 1.4 m/s for one escort.
- **Gun Game:** 12-player free-for-all on a 10-weapon ladder (Arcstorm → Titan Drum → Pulse-9 → Helix-47 → Viper SMG → Breachmaker → Railspike → Longshot-X → Nova Cannon → Phantom pistol). Every elimination instantly swaps you to the next weapon, and the first kill with the final pistol wins. A self-inflicted death knocks you back one weapon. There are no weapon pickups or grenades, so everyone fights with their ladder weapon. The HUD shows your ladder position and the next weapon, and announces when someone reaches the final weapon. Available in Practice and online, with the same bot fill and drop-in as FFA.
- **Getting back into the action:**
  - **Quick Play** on the main menu drops you into a 6v6 against AI in one click, or repeats your last practice setup.
  - **Play again** after an online match puts you straight back in the same queue.
  - **Death card:** shows how much health your killer had left and how far away they were ("so close!").
  - **Revenge marker:** after you respawn, the player who got you is marked for your team for 5 s.
- **Touch devices:** phones and tablets without a mouse see a note on the main menu that matches need a keyboard and mouse.
- **Score pop-ups:** every point you earn pops up beside the crosshair ("+100 Elimination", "+25 Headshot", "+50 Double Kill", "+50 Assist"…), with a running combo total and a rising tick sound. Medal values come from one shared table, so the pop-ups always match the server's scoring.
- **Medals:** First Blood, Double/Triple Kill, Rampage, Headshot, Long Shot, Revenge, **Nemesis** (eliminate the player who has eliminated you 3+ times), **Slide Kill**, Bounty Collected, Demolition, Clutch, Airborne, streaks, Capture, Defender, Revive, Data Heist, Checkpoint Reached, Payload Delivered.
- **Session-only progression:** XP from every point you score, plus bonuses for winning (+300), finishing a match (+150) and completing a daily challenge (+500). Levels come quickly (600 XP for level 2, then 250 more per level), and each one unlocks something:
  - **Titles:** Rookie, Brawler, Sharpshooter, Street Legend, Night Owl, Golden Gun, Neon Royalty.
  - **Weapon camos:** Bubblegum, Mint Chip, Tiger, Arcade, Lava, Galaxy, Gold and an animated Prism. Pick a finish on the main menu; it's applied to your first-person weapon.
  - **Feedback:** the HUD shows your level bar and pops a toast on level-ups and completed challenges. The results screen shows the XP breakdown, the level bar filling up and everything you unlocked.
  - **Also kept:** three daily-style challenges generated locally from the date, "this session" stats and per-match improvement feedback.

  All of it lives in memory only and is gone when the tab closes, unless you opt in to *Remember my level, XP and weapon finish* (see Privacy). Challenges and session stats are never saved.
- **AI:** Rookie/Standard/Veteran/Elite bots with limited FOV and range, hearing, smoke and flash awareness, reaction delays, aim error, strafing, cover-seeking at low health, healing, reloading, grenades, tactical use, objective play, looting, revives and stuck recovery. Bots use the same input pipeline as humans (no cheating) and are always named `BOT …` (humans can't register that prefix).
- **Audio:** everything is synthesized with Web Audio.
  - **Your sounds always play:** your own gun, footsteps and UI sounds are never dropped.
  - **Other players' and world sounds** share separate voice pools: 14 gunfire, 8 footstep, 6 impact and 10 effect voices. When a pool is full, a closer or louder sound replaces the weakest one, and inaudible distant sounds are skipped.
  - **Positioning:** nearby sounds get HRTF 3D panning. Distant ones get cheaper panning plus air absorption (they lose their highs with distance).
  - **Cleanup:** finished voices are disconnected right away, so long matches don't build up unused audio work.
  - **Mix:** a fast limiter keeps explosions from ducking gunfire for long, and gunshots get slight per-shot pitch variation.
  - **Recovery:** if the browser suspends audio mid-match, the next key press, click or return to the tab resumes it.
- **Accessibility:** key rebinding, toggle crouch/aim, colour-blind team palette, reduce-motion, head bob/camera shake toggles, visual sound cues for gunfire and footsteps, crosshair style/colour/size, HUD scale, clean competitive HUD, FPS/latency display.
- **Graphics presets:** Low/Medium/High (bloom, rain, shadows, particles, resolution scale). Low is auto-selected on ≤ 4-core machines.

---

## Test results (actually run)

Automated (`npm test`): **94 tests passing.**

- `shared/test` (68): death feedback (kill events carry the killer's health and distance; the killer is marked for the victim's team after respawn), battle royale (in a 23-bot match, 95 s in, at least 10 bots are alive, over 40% moved in the last 15 s, almost none are out of ammo, and route searches stay throttled; early eliminations redeploy once and later ones are final; supply drops land inside the next safe zone and spill a power weapon, armor, plate and ammo; bots only target loot they can use and go for ammo or a gun when dry), stairways and jump pads on the real map (no solid geometry, ladder, jump pad, crate or barrel in any of the 450 stair flights' walk space; every flight can be walked and sprinted up and down without snagging or bobbing, and jumped from mid-flight; every outdoor rooftop staircase lets you walk onto the roof; all 64 jump pads launch to full height without hitting anything and land without fall damage), Gun Game (a 10-bot Gun Game always arms each player with exactly their ladder weapon and ends on a final-weapon kill; arenas have no weapon or power pickups), slide-hop (landing with crouch held starts a second slide and keeps clearly more speed than a plain landing), the shared medal-score table, match sizes (online team modes 6v6, FFA 12, BR 24 for every squad size; a full 8v8 bot match fights and runs under 5 ms per tick), play features (double jump; jump pads launch and cancel fall damage; **every rooftop jump pad on the real map lands its rider on the roof without fall damage**; shooting a loot crate breaks it and drops a pickup), payload (every district's track is deterministic and clear of geometry; the cart advances only with uncontested escorts, extends the clock at checkpoints and rolls back to the last one; bot attackers deliver it and win; bot defenders run the clock out and win; a full bot-filled 4v4 reaches an end condition), movement (gravity, walk/sprint speeds, no wall tunnelling at 400 m/s, step-up limits, jump height, slide, bounds, determinism), weapons (fire rate, semi/burst/pellets, reload, empty mag, swap delay, falloff, power-weapon ammo, distinct handling), map (determinism, 8 districts, every spawn free of geometry, objectives/pickups present, BR loot), match (bot-filled TDM runs to its score limit; FFA/DOM/BR run to completion; server-side hitscan applies armor-first damage; input flooding can't speed-hack; snapshots serialize under 20 KB), protocol validation and name sanitization.
- `client/test` (14): portal integration with fake SDKs (the regular build has no portal; loading and gameplay are reported once each; the game is muted only while an ad plays; skipped or crashing ads and a blocked SDK never hang the game; the real CrazyGames and Poki call sequences), audio voices against a fake Web Audio graph (your own gunshots keep playing while 900 other sounds compete; other players' gunfire is capped per kind and closer shots take over from distant ones; inaudible sounds are skipped; finished voices are disconnected; a suspended context resumes on the next key press), opt-in progress saving (nothing stored by default; only total XP and camo saved when opted in, and the level is restored from them; opting out deletes the saved copy; malformed or out-of-range data is ignored).
- `server/test` (12): allowed-origin matching (exact addresses and `https://*.domain` wildcards; look-alike domains, other schemes and bare domains are rejected), health endpoint, an online Gun Game queue that starts as a full 12-player solo match on the first ladder weapon, name sanitization, invalid room codes, party-size enforcement (solo can't queue a BR Squad without Fill), a solo TDM queue that starts within seconds as a full 6v6 with 11 labelled bots, a second player who drops into that running match in place of a bot, and a bot that takes over their slot when they leave, a two-client private match with synchronized movement and server acks, reconnect with token, labelled AI fill after the wait, disconnection of clients spamming invalid frames, and rejection of a disallowed origin.

Manual browser testing (built-in Chromium pane, Intel HD 530 integrated GPU):

- Boot → menu → Practice TDM: the world renders, movement and sprint (~8.1 m/s) work, and the server acked every input. Weapon swap, reload, frag throw, grenade cycling, tactical cooldown, slide (11.6 m/s) and jump all work. Hits are confirmed by the authority, with assists and the kill feed.
- Online: an invite link joined a party, a ready check and private TDM put 2 humans on opposite teams with labelled bot fill, and positions synchronized across clients. **Public matchmaking:** two separate solo players queued FFA with AI fill off; the queue showed honest counts and matched them together (2 humans, 0 bots). Player 1 then pathed to player 2 and eliminated them through server-authoritative combat; both clients showed the kill, damage indicators, First Blood and a Data Cache event.
- Practice Battle Royale (glide insertion, storm, power weapon markers), forced match end → results → Rematch, and online Domination on the **production builds** (`vite preview` + bundled `server/dist`) with zero console errors.
- Practice Payload in Neon City on both sides (production preview and dev build): the cart, rails, checkpoint gates and escort ring render; the HUD progress bar, minimap and full-map track update; bots push and contest; the match ends on the clock with "Defenders held the line" and the results screen shows how far the payload got. Zero console errors.
- Performance: ~60 FPS on the Low preset at 1024×768 (≈5 ms CPU per frame), ~30 FPS on Medium with bloom, on that integrated GPU.

Not tested here: the Dockerfile (Docker isn't installed in the dev environment), real deployments to Netlify/Render, Firefox/Safari, load beyond 2 human clients + bots, and high-latency networks.

---

## Known limitations

- **Payload:** the cart isn't a physical obstacle (players and bullets pass through it), each district has a single west-to-east track, and there's no Extraction mode.
- **Capacity is unmeasured.** Rooms tick at 30 Hz and send per-player snapshots (~20–40 KB/s per player, interest-managed at 140 m). A small instance should handle a handful of 8–16-player rooms, but this hasn't been load-tested.
- **Not cheat-proof:** aim is client-controlled (as in every shooter), so aim-assist or no-recoil cheats aren't prevented. Nearby enemies are sent even without line of sight (no anti-wallhack culling).
- **High latency:** lag compensation rewinds at most 300 ms; players above ~250 ms ping will see more corrections.
- **Mobile:** menus are responsive, but gameplay requires keyboard and mouse. There are no touch controls.
- **Visuals:** avatars are procedural box-built models with simple procedural animation (no skeletal animation or ragdolls). Destructibility is limited to barrels, shields, mines and charges.
- **Bots** navigate a ground-level grid: they use stairs and slopes, but rarely ladders or rooftops. Long trips are routed through stepping stones about 40 m apart.
  - **Starting cell:** a bot's route always starts from a cell it can walk to in a straight line, so a bot in a room corner isn't routed from the street outside.
  - **Getting unstuck:** stuck bots only jump when there's standing room above the obstacle. Otherwise they crouch, back off and strafe before re-planning, which stops them wedging in window frames.
- **Embedded frames:** where pointer lock is unavailable (some iframes or preview panes), the game falls back to free-cursor mouse look.

## Troubleshooting

- **"Server unreachable" on Play:** check that `VITE_GAME_SERVER_URL` uses `wss://` for HTTPS sites, that the server's `/health` responds, and that your site's origin is in `ALLOWED_ORIGINS` (a 403 on the upgrade means it isn't). Free hosts may need ~1 minute to wake up.
- **"Client out of date":** the client and server protocol versions differ (`PROTOCOL_VERSION`). Redeploy both from the same commit.
- **Black screen or renderer error:** enable hardware acceleration, update the browser, or pick the Low preset. The error panel offers a one-click switch.
- **Low FPS:** use the Low preset, lower the resolution scale, disable rain and shadows.
- **Mouse not captured:** click the game view. Esc releases the mouse and opens the menu.
