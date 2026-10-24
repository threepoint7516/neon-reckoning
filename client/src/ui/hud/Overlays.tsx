import { useEffect, useReducer, useRef, useState } from "react";
import type { Game } from "../../game/Game";
import { getFrontierMap, MODE_INFO, WEAPONS } from "@neon/shared";
import { mapImage } from "./mapImage";
import { LoadoutPicker } from "../components/LoadoutPicker";
import { store, useStore } from "../../state/store";
import { SettingsPanel } from "../screens/Settings";
import { ACTION_LABELS, bindLabel } from "../../state/settings";
import type { Action } from "../../state/settings";

function useTick(ms: number) {
  const [, f] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const i = setInterval(f, ms);
    return () => clearInterval(i);
  }, [ms]);
}

export function Scoreboard({ game }: { game: Game }) {
  useTick(250);
  const rows = game.scores.length ? game.scores : [...game.roster.keys()].map((i) => ({ i, k: 0, d: 0, a: 0, s: 0, st: 0, pl: 0, c: true }));
  const teams = new Map<number, typeof rows>();
  for (const r of rows) {
    const t = game.isFFA ? 0 : game.roster.get(r.i)?.t ?? 0;
    (teams.get(t) ?? teams.set(t, []).get(t)!).push(r);
  }
  const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
  const br = game.cfg.mode === "br";
  return (
    <div className="overlay" style={{ background: "rgba(31,42,68,0.3)", pointerEvents: "none" }}>
      <div className="panel" style={{ width: "min(900px, 96vw)" }}>
        <h3>
          {MODE_INFO[game.cfg.mode].name} · {game.district?.name ?? "Neon Frontier"}
        </h3>
        {[...teams.entries()]
          .sort((a, b) => (a[0] === game.roster.get(game.myId)?.t ? -1 : b[0] === game.roster.get(game.myId)?.t ? 1 : a[0] - b[0]))
          .map(([team, list]) => (
            <table className="sb" key={team} style={{ marginBottom: 14 }}>
              <thead>
                <tr>
                  <th style={{ color: game.isFFA ? undefined : hex(game.colorForTeam(team)) }}>
                    {game.isFFA ? "Players" : br ? `Squad ${team + 1}` : team === game.roster.get(game.myId)?.t ? "Your team" : "Enemy team"}
                    {!game.isFFA && game.match?.sc[team] !== undefined && !br ? ` — ${game.match.sc[team]}` : ""}
                  </th>
                  <th className="num">K</th>
                  <th className="num">D</th>
                  <th className="num">A</th>
                  <th className="num">Streak</th>
                  {br && <th className="num">Place</th>}
                  <th className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {[...list]
                  .sort((a, b) => b.s - a.s)
                  .map((r) => {
                    const ro = game.roster.get(r.i);
                    return (
                      <tr key={r.i} className={r.i === game.myId ? "me" : ""}>
                        <td>
                          {ro?.n ?? "?"}
                          {ro?.bot && <span className="tag-bot">BOT</span>}
                          {r.i === game.myId && <span className="tag-you">YOU</span>}
                          {!r.c && <span className="chip warn" style={{ marginLeft: 6 }}>reconnecting</span>}
                        </td>
                        <td className="num">{r.k}</td>
                        <td className="num">{r.d}</td>
                        <td className="num">{r.a}</td>
                        <td className="num">{r.st}</td>
                        {br && <td className="num">{r.pl ? `#${r.pl}` : "—"}</td>}
                        <td className="num">{r.s}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ))}
        <div className="small muted">AI opponents are always labelled BOT. Stats are for this match only and are discarded when it ends.</div>
      </div>
    </div>
  );
}

export function MapOverlay({ game }: { game: Game }) {
  useTick(200);
  const ref = useRef<HTMLCanvasElement>(null);
  const map = getFrontierMap();
  const h = game.hud;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const img = mapImage(map.minX, map.minZ, map.maxX, map.maxZ, 1);
    const S = c.width / (map.maxX - map.minX);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img.canvas, 0, 0, c.width, c.height);
    const X = (x: number) => (x - map.minX) * S;
    const Z = (z: number) => (z - map.minZ) * S;
    for (const d of map.districts) {
      const active = game.district?.id === d.id;
      ctx.strokeStyle = active ? "#22e5ff" : "rgba(255,255,255,0.12)";
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(X(d.minX), Z(d.minZ), (d.maxX - d.minX) * S, (d.maxZ - d.minZ) * S);
      ctx.fillStyle = `#${d.accent.toString(16).padStart(6, "0")}`;
      ctx.font = `bold ${Math.round(c.width / 48)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(d.name.toUpperCase(), X((d.minX + d.maxX) / 2), Z(d.minZ) + c.width / 30);
    }
    if (!game.district) {
      ctx.fillStyle = "rgba(34,229,255,0.5)";
      ctx.fillText("ELECTRIFIED BAY", X(128), Z(140));
    }
    const m = game.match;
    if (m?.zn) {
      ctx.strokeStyle = "rgba(190,80,255,1)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(X(m.zn.x), Z(m.zn.z), m.zn.r * S, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(X(m.zn.tx), Z(m.zn.tz), m.zn.tr * S, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (game.track) {
      ctx.strokeStyle = "rgba(34,229,255,0.6)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      game.track.pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p.x), Z(p.z)));
      ctx.stroke();
    }
    for (const mk of h.markers) {
      ctx.fillStyle = mk.color;
      ctx.beginPath();
      ctx.arc(X(mk.x), Z(mk.z), mk.kind === "point" || mk.kind === "payload" ? 7 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (mk.label) {
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(mk.label, X(mk.x), Z(mk.z) - 9);
      }
    }
    // You.
    ctx.save();
    ctx.translate(X(h.meX), Z(h.meZ));
    ctx.rotate(-h.yaw);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  return (
    <div className="overlay" style={{ pointerEvents: "none" }}>
      <div className="panel">
        <h3>Neon Frontier — {game.district ? `${game.district.name} (combat zone highlighted)` : "full region"}</h3>
        <canvas ref={ref} width={720} height={720} style={{ width: "min(76vh, 88vw)", height: "min(76vh, 88vw)", display: "block" }} />
        <div className="small muted" style={{ marginTop: 6 }}>
          Press <span className="kbd">{bindLabel("map")}</span> to close
        </div>
      </div>
    </div>
  );
}

export function DeathPanel({ game }: { game: Game }) {
  useTick(100);
  const h = game.hud;
  const d = h.death;
  const loadout = useStore((s) => s.loadout);
  if (!d) return null;
  const remain = d.respawnAt >= 0 ? Math.max(0, d.respawnAt - game.now) : -1;
  const br = game.cfg.mode === "br";
  return (
    <div className="death" onMouseDown={(e) => e.stopPropagation()}>
      <h1>{h.downed ? "DOWNED" : d.redeploy ? "SECOND CHANCE" : "ELIMINATED"}</h1>
      {d.killer && (
        <div style={{ fontSize: 16, letterSpacing: "0.1em", marginTop: 6 }}>
          by <b style={{ color: "#ff2b4e" }}>{d.killer}</b> · {d.weapon}
          {d.head ? " · headshot" : ""}
          {d.killerHp !== undefined && (
            <div className="death-detail">
              They had <b>{d.killerHp} HP</b> left{d.dist !== undefined ? ` · ${d.dist} m away` : ""}
              {d.killerHp <= 30 ? " — so close!" : ""}
            </div>
          )}
        </div>
      )}
      {br && d.redeploy ? (
        <div style={{ marginTop: 14 }}>
          <div className="muted">Knocked out early — you get one free redeploy.</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 18, margin: "10px 0 0" }} className="glow-cyan">
            {remain > 0 ? `Gliding back in ${remain.toFixed(1)}s` : "Redeploying…"}
          </div>
        </div>
      ) : br ? (
        <div style={{ marginTop: 14 }}>
          {d.spectating ? <div className="chip">Spectating {d.spectating}</div> : <div className="muted">Your squad has been eliminated.</div>}
          {d.placement > 0 && <div style={{ fontSize: 30, fontWeight: 900, marginTop: 8 }}>#{d.placement}</div>}
          <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
            <button className="btn danger" onClick={() => game.leave()}>
              Leave match
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontFamily: "var(--mono)", fontSize: 18, margin: "10px 0 16px" }} className="glow-cyan">
            {remain > 0 ? `Respawning in ${remain.toFixed(1)}s` : "Respawning…"}
          </div>
          <div className="panel" style={{ textAlign: "left", width: "min(640px, 92vw)" }}>
            <h3>Next life loadout</h3>
            <LoadoutPicker
              value={loadout}
              compact
              onChange={(l) => {
                store.set({ loadout: l });
                game.setLoadout(l);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function PauseMenu({ game, onResume, onLeave }: { game: Game; onResume: () => void; onLeave: () => void }) {
  const [tab, setTab] = useState<"main" | "settings" | "controls">("main");
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="overlay" onMouseDown={(e) => e.stopPropagation()}>
      <div className="panel" style={{ width: tab === "main" ? "min(420px, 92vw)" : "min(980px, 96vw)" }}>
        <h3>{game.offline ? "Paused — practice simulation stopped" : "Menu — the match continues"}</h3>
        {tab === "main" && (
          <div className="col">
            <button className="btn primary big" onClick={onResume}>
              Resume
            </button>
            <button className="btn" onClick={() => setTab("settings")}>
              Settings
            </button>
            <button className="btn" onClick={() => setTab("controls")}>
              Controls
            </button>
            {!confirm ? (
              <button className="btn danger" onClick={() => setConfirm(true)}>
                Leave match
              </button>
            ) : (
              <div className="row">
                <span className="muted small">Leave this match?</span>
                <button className="btn danger small" onClick={onLeave}>
                  Yes, leave
                </button>
                <button className="btn small" onClick={() => setConfirm(false)}>
                  Stay
                </button>
              </div>
            )}
            <div className="small muted" style={{ marginTop: 6 }}>
              {MODE_INFO[game.cfg.mode].name} · {game.district?.name ?? "Neon Frontier"}
              {game.cfg.modifiers.length ? ` · ${game.cfg.modifiers.join(", ")}` : ""}
            </div>
          </div>
        )}
        {tab === "settings" && (
          <>
            <SettingsPanel compact />
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setTab("main")}>
              Back
            </button>
          </>
        )}
        {tab === "controls" && (
          <>
            <ControlsReference />
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setTab("main")}>
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ControlsReference() {
  const acts = Object.keys(ACTION_LABELS) as Action[];
  return (
    <div className="grid2" style={{ gap: 6 }}>
      <div className="row small">
        <span className="kbd">Mouse</span> Aim · <span className="kbd">LMB</span> Fire · <span className="kbd">RMB</span> Aim down sights · <span className="kbd">Wheel</span> Switch weapon
      </div>
      <div className="row small">
        <span className="kbd">Esc</span> Pause menu
      </div>
      {acts.map((a) => (
        <div key={a} className="row small" style={{ justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,.05)", padding: "3px 0" }}>
          <span className="muted">{ACTION_LABELS[a]}</span>
          <span className="kbd">{bindLabel(a)}</span>
        </div>
      ))}
    </div>
  );
}

export function weaponName(id: string): string {
  return WEAPONS[id as keyof typeof WEAPONS]?.name ?? id;
}
