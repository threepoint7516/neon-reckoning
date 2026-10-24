import { useEffect, useState } from "react";
import {
  getFrontierMap, randomCallsign, sanitizeName, NAME_MAX, GAME_TITLE, WEAPONS, WEAPON_IDS, GRENADES, GRENADE_IDS, TACTICALS, TACTICAL_IDS, INJECTOR, PLATE,
} from "@neon/shared";
import { go, store, toast, useStore } from "../../state/store";
import { settingsStore, useSettings } from "../../state/settings";
import { challenges, sessionStats } from "../../state/session";
import { audio } from "../../audio/audio";
import { online } from "../../net/online";
import { serverUrl } from "../../net/connection";
import { getTextures } from "../../game/render/textures";
import { startPractice } from "./Practice";
import { LevelPanel } from "../components/LevelPanel";

function Logo({ small = false }: { small?: boolean }) {
  const s = useSettings();
  return (
    <div className={`logo ${s.reduceMotion ? "" : "glitch"}`} style={small ? { fontSize: 40 } : undefined} aria-label={GAME_TITLE}>
      <span className="l1">Neon</span>
      <span className="l2">Reckoning</span>
    </div>
  );
}

/** Startup: generate the world + textures, then wait for a click (unlocks audio). */
export function BootScreen() {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Warming up");
  const [ready, setReady] = useState(false);
  const [webgl, setWebgl] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const steps: [string, () => void][] = [
      ["Checking graphics hardware", () => {
        const c = document.createElement("canvas");
        const gl = c.getContext("webgl2") ?? c.getContext("webgl");
        if (!gl) setWebgl(false);
      }],
      ["Generating Neon Frontier (8 districts)", () => void getFrontierMap()],
      ["Fabricating materials", () => void getTextures()],
      ["Calibrating weapons", () => {}],
    ];
    let i = 0;
    const run = () => {
      if (cancelled) return;
      if (i >= steps.length) {
        setProgress(1);
        setStage("Ready");
        setReady(true);
        return;
      }
      const [label, fn] = steps[i]!;
      setStage(label);
      setTimeout(() => {
        try {
          fn();
        } catch (e) {
          console.error(e);
        }
        i++;
        setProgress(i / steps.length);
        run();
      }, 60);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);
  const enter = () => {
    if (!ready || !webgl) return;
    audio.unlock();
    audio.uiClick();
    if (settingsStore.get().musicVol > 0) audio.playMusic("menu");
    const invite = store.get().pendingInvite;
    if (invite) go("play");
    else go("menu");
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") enter();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  return (
    <div className="screen boot" onClick={enter} style={{ cursor: ready ? "pointer" : "default" }}>
      <Logo />
      <div className="tagline">A free-to-play arena shooter in a toy-bright city that never sleeps</div>
      <div className="progress">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="small muted mono">{stage}…</div>
      {!webgl && (
        <div className="panel" style={{ marginTop: 24, maxWidth: 520 }}>
          <h3>WebGL unavailable</h3>
          <p className="muted">
            Your browser or graphics driver doesn't provide WebGL, which the game needs for 3D rendering. Try an up-to-date Chrome, Edge or Firefox with hardware
            acceleration enabled.
          </p>
        </div>
      )}
      {ready && webgl && (
        <div className="blink" style={{ marginTop: 30, letterSpacing: "0.2em", fontWeight: 900, fontSize: 20, color: "#fff", textShadow: "0 3px 0 #1f2a44" }}>
          CLICK OR PRESS ENTER TO PLAY
        </div>
      )}
      <div className="footer-note">No account. No tracking. Your callsign lives only in this tab.</div>
    </div>
  );
}

function Callsign() {
  const name = useStore((s) => s.name);
  const net = useStore((s) => s.net.status);
  const inMatchOrParty = useStore((s) => !!s.party);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const apply = (n: string) => {
    store.set({ name: n });
    if (net === "online") online.send({ t: "rename", name: n });
  };
  return (
    <div className="panel">
      <h3>Your callsign (this session only)</h3>
      {!editing ? (
        <div className="callsign">
          <span className="name glow-mag">{name}</span>
          <span className="spacer" />
          <button className="btn small" onClick={() => apply(randomCallsign())} title="Generate a new random callsign">
            ⟳ Reroll
          </button>
          <button
            className="btn small"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </div>
      ) : (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const clean = sanitizeName(draft);
            if (!clean) {
              toast("Callsigns need 3–16 letters, digits, _ or - (no reserved words).", "error");
              return;
            }
            apply(clean);
            setEditing(false);
          }}
        >
          <input className="input" autoFocus maxLength={NAME_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
          <button className="btn small primary" type="submit">
            Save
          </button>
          <button className="btn small" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
      <div className="small muted" style={{ marginTop: 8 }}>
        Never saved anywhere. Close the tab and it's gone.{inMatchOrParty ? " Party members see the change instantly." : ""}
      </div>
    </div>
  );
}

export function MainMenu() {
  const s = useSettings();
  const btn = (label: string, sub: string, onClick: () => void, primary = false) => (
    <button
      className={`btn ${primary ? "primary big" : ""}`}
      onMouseEnter={() => audio.uiHover()}
      onClick={() => {
        audio.uiClick();
        onClick();
      }}
    >
      {label}
      <span className="sub">{sub}</span>
    </button>
  );
  return (
    <div className="screen">
      <div className="menu-layout">
        <div>
          <Logo />
          <div className="tagline">Neon Frontier is waiting</div>
          <nav className="menu-nav">
            {btn("Play", "Online · Solo / Duo / Trio / Squad", () => go("play"), true)}
            {btn("Practice", "Offline vs AI · any mode", () => go("practice"))}
            {btn("Training Range", s.tutorialSeen ? "Controls refresher" : "Start here!", () => {
              settingsStore.set({ tutorialSeen: true });
              startPractice({ mode: "training", arena: "skyrail", teamSize: 1, bots: 4, difficulty: "rookie", modifiers: [], timeLimit: 3600 });
            })}
            {btn("Arsenal", "Weapons & equipment", () => go("arsenal"))}
            {btn("Settings", "Controls · graphics · audio", () => go("settings"))}
            {btn("Privacy", "What we keep (almost nothing)", () => go("privacy"))}
            {btn("Credits", "", () => go("credits"))}
          </nav>
          {!s.tutorialSeen && (
            <div className="panel" style={{ marginTop: 18, maxWidth: 420, borderColor: "var(--yellow)" }}>
              <h3 style={{ color: "var(--yellow)" }}>New here?</h3>
              <div className="small">Run the Training Range for a 3-minute walkthrough of movement, weapons and gadgets against passive target bots.</div>
            </div>
          )}
        </div>
        <div className="col" style={{ gap: 18 }}>
          <Callsign />
          <LevelPanel />
          <div className="panel">
            <h3>Today's challenges</h3>
            {challenges.map((c) => (
              <div key={c.id} className="challenge">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>{c.text}</span>
                  <span className="mono small">
                    {c.progress}/{c.goal} {c.progress >= c.goal ? "✔" : ""}
                  </span>
                </div>
                <div className="bar">
                  <i style={{ width: `${(c.progress / c.goal) * 100}%` }} />
                </div>
              </div>
            ))}
            <div className="small muted" style={{ marginTop: 8 }}>
              Generated locally from today's date. Progress counts in Practice and online, and resets when you close the tab.
            </div>
          </div>
          <div className="panel">
            <h3>This session</h3>
            <div className="row" style={{ gap: 26 }}>
              <Stat label="Matches" v={sessionStats.matches} />
              <Stat label="Wins" v={sessionStats.wins} />
              <Stat label="Eliminations" v={sessionStats.kills} />
              <Stat label="K/D" v={sessionStats.deaths ? (sessionStats.kills / sessionStats.deaths).toFixed(2) : sessionStats.kills} />
            </div>
          </div>
          <ServerBadge />
        </div>
      </div>
      <div className="footer-note" style={{ textAlign: "center" }}>
        Free to play forever · No accounts · No ads · No trackers · Original game — not affiliated with any other title
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number | string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>
        {v}
      </div>
      <div className="small muted" style={{ letterSpacing: "0.15em", textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

export function ServerBadge() {
  const net = useStore((s) => s.net);
  const url = serverUrl();
  let chip = <span className="chip">Not connected</span>;
  if (!url) chip = <span className="chip warn">No multiplayer server configured</span>;
  else if (net.status === "online")
    chip = (
      <span className="chip good">
        <span className="dot" /> Online · {net.online ?? "?"} connected · {net.ping ?? "—"} ms
      </span>
    );
  else if (net.status === "connecting") chip = <span className="chip warn">Connecting…</span>;
  else if (net.status === "error") chip = <span className="chip bad">Server unreachable</span>;
  return (
    <div className="panel">
      <h3>Multiplayer server</h3>
      <div className="row">{chip}</div>
      <div className="small muted" style={{ marginTop: 8 }}>
        {net.error ??
          (url
            ? "We only connect when you open Play. The player count is the real number of open connections to this server."
            : "This build has no game server URL. Practice and Training work fully offline.")}
      </div>
    </div>
  );
}

export function ArsenalScreen() {
  return <ArsenalInner />;
}

function ArsenalInner() {
  const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
  const max = {
    dps: Math.max(...WEAPON_IDS.map((id) => (WEAPONS[id].damage * WEAPONS[id].pellets * (WEAPONS[id].burstCount ?? 1)) / WEAPONS[id].fireInterval)),
    range: 300,
    mag: 100,
  };
  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn" onClick={() => go("menu")}>
          ← Back
        </button>
        <h2>Arsenal</h2>
        <span className="muted small">Every weapon is available to everyone. No unlocks, no purchases.</span>
      </div>
      <div className="grid3">
        {WEAPON_IDS.map((id) => {
          const w = WEAPONS[id];
          const dps = (w.damage * w.pellets * (w.burstCount ?? 1)) / w.fireInterval;
          const bar = (label: string, v: number, m: number, txt: string) => (
            <div className="stat">
              {label}
              <div className="bar">
                <i style={{ width: `${Math.min(100, (v / m) * 100)}%`, background: hex(w.color), boxShadow: `0 0 6px ${hex(w.color)}` }} />
              </div>
              <b>{txt}</b>
            </div>
          );
          return (
            <div key={id} className="panel">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h4 style={{ margin: 0, color: hex(w.color), letterSpacing: "0.15em", textTransform: "uppercase" }}>{w.name}</h4>
                <span className="chip">{w.slot === "power" ? "Power · map pickup" : w.category}</span>
              </div>
              <p className="small muted" style={{ minHeight: 48 }}>
                {w.blurb}
              </p>
              <div className="col" style={{ gap: 5 }}>
                {bar("Damage", w.damage * w.pellets, 110, `${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ""}`)}
                {bar("Fire rate", 1 / w.fireInterval, 15, `${Math.round(60 / w.fireInterval)}${w.burstCount ? "b" : ""}`)}
                {bar("DPS", dps, max.dps, `${Math.round(dps)}`)}
                {bar("Range", w.rangeEnd, max.range, `${w.rangeEnd}m`)}
                {bar("Accuracy", 8 - w.spreadHip, 8, `${w.spreadAds}°`)}
                {bar("Magazine", w.mag, max.mag, `${w.mag}`)}
                {bar("Reload", 5 - w.reloadTime, 5, `${w.reloadTime}s`)}
                {bar("Mobility", w.moveMult, 1.1, `${Math.round(w.moveMult * 100)}%`)}
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                Headshot ×{w.headMult} · {w.fireMode}
                {w.pierce ? ` · pierces ${w.pierce} targets & thin cover` : ""}
                {w.chain ? ` · chains to ${w.chain.max} enemies` : ""}
                {w.projectile ? ` · ${w.projectile.splashRadius}m blast` : ""}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid2" style={{ marginTop: 18 }}>
        <div className="panel">
          <h3>Grenades</h3>
          {GRENADE_IDS.map((g) => (
            <p key={g} className="small">
              <b style={{ color: hex(GRENADES[g].color) }}>{GRENADES[g].name}</b> — {GRENADES[g].blurb} <span className="muted">(carry {GRENADES[g].max})</span>
            </p>
          ))}
        </div>
        <div className="panel">
          <h3>Tactical abilities & consumables</h3>
          {TACTICAL_IDS.map((t) => (
            <p key={t} className="small">
              <b style={{ color: hex(TACTICALS[t].color) }}>{TACTICALS[t].name}</b> — {TACTICALS[t].blurb} <span className="muted">({TACTICALS[t].cooldown}s cooldown)</span>
            </p>
          ))}
          <p className="small">
            <b style={{ color: "#4dff7a" }}>Healing Injector</b> — +{INJECTOR.heal} health over {INJECTOR.channel}s. Cancelled by firing or sprinting.
          </p>
          <p className="small">
            <b style={{ color: "#3d8bff" }}>Armor Plate</b> — +{PLATE.armor} armor over {PLATE.channel}s.
          </p>
        </div>
      </div>
    </div>
  );
}

export function PrivacyScreen() {
  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn" onClick={() => go("menu")}>
          ← Back
        </button>
        <h2>Privacy</h2>
      </div>
      <div className="grid2" style={{ maxWidth: 1200 }}>
        <div className="panel">
          <h3>What the game never does</h3>
          <ul className="small" style={{ lineHeight: 1.7 }}>
            <li>No accounts, logins, emails, passwords or social sign-in.</li>
            <li>No analytics SDKs, advertising trackers, fingerprinting or cookies.</li>
            <li>No database. Player identities and match histories are never persisted.</li>
            <li>No chat, so there is no chat history to keep.</li>
            <li>No third-party fonts, CDNs or embeds — everything is served from the game's own origin.</li>
          </ul>
        </div>
        <div className="panel">
          <h3>What exists, and for how long</h3>
          <ul className="small" style={{ lineHeight: 1.7 }}>
            <li>
              <b>Your callsign</b> lives in this tab's memory only and is sent to the game server when you play online so other players can see it.
            </li>
            <li>
              <b>Parties & matches</b>: the server keeps names, team assignments, positions and scores in RAM while a party or match exists, then discards them when the
              room closes (at most a few minutes after a match ends).
            </li>
            <li>
              <b>Session challenges & stats</b> are kept in this tab's memory and vanish when you close it.
            </li>
            <li>
              <b>Level, XP and weapon finish</b> live in this tab's memory. Only if you switch on "Remember my level, XP and weapon finish" (Settings → Storage) are two
              values saved in this browser's localStorage: your total XP and the camo you picked. They never leave your device, and switching the option off deletes them.
            </li>
            <li>
              <b>Settings</b> are only saved (to this browser's localStorage) if you switch on "Remember these settings". They contain no identity or match stats.
            </li>
          </ul>
        </div>
        <div className="panel">
          <h3>What we can't promise</h3>
          <p className="small" style={{ lineHeight: 1.7 }}>
            Like every website, the hosting providers (the static site host and the game server host) may keep standard operational logs such as IP addresses and
            request times. That is outside the game's control. The game server itself only logs operational events (startup, rooms opening/closing, errors) and never
            logs names, IP addresses or message contents. Practice and Training never contact any server at all.
          </p>
        </div>
      </div>
    </div>
  );
}

export function CreditsScreen() {
  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn" onClick={() => go("menu")}>
          ← Back
        </button>
        <h2>Credits</h2>
      </div>
      <div className="panel" style={{ maxWidth: 820 }}>
        <Logo small />
        <p className="small" style={{ lineHeight: 1.8, marginTop: 16 }}>
          NEON RECKONING is an original game. Every map, weapon, texture, model and sound is generated procedurally in code — there are no external art or audio assets.
        </p>
        <h3 style={{ marginTop: 18 }}>Built with open-source software</h3>
        <ul className="small" style={{ lineHeight: 1.8 }}>
          <li>three.js (MIT) — WebGL rendering and post-processing</li>
          <li>React (MIT) — menus and HUD</li>
          <li>Vite (MIT) — build tooling</li>
          <li>ws (MIT) — WebSocket server</li>
          <li>TypeScript (Apache-2.0)</li>
        </ul>
        <p className="small muted">Inspired by the accessibility of browser arena shooters; no branding, assets, maps or content from any other game are used.</p>
      </div>
    </div>
  );
}
