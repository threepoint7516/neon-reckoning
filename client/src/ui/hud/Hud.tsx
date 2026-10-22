import { useEffect, useReducer, useRef } from "react";
import type { Game } from "../../game/Game";
import { MEDAL_NAMES } from "../../game/hud";
import type { HudData } from "../../game/hud";
import { useSettings, bindLabel } from "../../state/settings";
import { useStore } from "../../state/store";
import { MODE_INFO, getFrontierMap } from "@neon/shared";
import { mapImage } from "./mapImage";

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Re-renders at ~30 Hz, reading the Game's mutable HUD model. */
function useTicker(fps = 30): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let id = 0;
    let last = 0;
    const loop = (t: number) => {
      id = requestAnimationFrame(loop);
      if (t - last >= 1000 / fps) {
        last = t;
        force();
      }
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [fps]);
}

export function Hud({ game }: { game: Game }) {
  useTicker(30);
  const s = useSettings();
  const ping = useStore((st) => st.net.ping);
  const h = game.hud;
  const t = performance.now() / 1000;
  const district = game.district;
  return (
    <div className={`hud ${s.competitiveHud ? "competitive" : ""}`} style={{ ["--hud-scale" as string]: s.hudScale }}>
      {h.flash > 0 && <div className="flash-tint" style={{ opacity: Math.min(1, h.flash * 1.4) }} />}
      {h.hurtFlash > 0.05 && <div className="hurt-tint" style={{ opacity: h.hurtFlash }} />}
      {h.emp > 0 && <div className="emp-tint" />}
      {h.alive && h.ads > 0.85 && h.weaponName === "Longshot-X" && <div className="scope" />}

      {/* Top-left: minimap */}
      <div className="tl">
        <Minimap game={game} h={h} />
        <div className="district-name">{district ? district.name : "Neon Frontier"}</div>
        {s.showFps && (
          <div className="netinfo" style={{ marginTop: 6, width: 200, textAlign: "center" }}>
            <span className="fps">{h.fps} FPS</span>
            {h.online ? ` · ${ping ?? "—"} ms` : " · OFFLINE PRACTICE"}
          </div>
        )}
      </div>
      {h.training && (
        <div className="training">
          <div style={{ letterSpacing: "0.2em", color: "var(--cyan)", marginBottom: 4 }}>TRAINING CHECKLIST</div>
          {h.training.map((x) => (
            <div key={x.label} className={x.done ? "done" : ""}>
              {x.done ? "✔" : "○"} {x.label}
            </div>
          ))}
          {h.training.every((x) => x.done) && <div style={{ color: "var(--green)", marginTop: 6 }}>All done! You're ready for a real match.</div>}
        </div>
      )}

      {/* Top-centre: timer & scores */}
      <div className="tc">
        <div className="row" style={{ gap: 6 }}>
          {h.scoreLine[0] && <ScoreBox {...h.scoreLine[0]} />}
          <div className="timer">{fmtTime(h.timeLeft)}</div>
          {h.scoreLine[1] && <ScoreBox {...h.scoreLine[1]} />}
        </div>
        {h.points.length > 0 && (
          <div className="cps">
            {h.points.map((p) => (
              <div key={p.label} className={`cp ${p.contested ? "contested" : ""} ${p.oc ? "oc" : ""}`} style={{ borderColor: p.color, color: p.color }}>
                {p.label}
              </div>
            ))}
          </div>
        )}
        {h.zone && (
          <div className="row" style={{ gap: 8 }}>
            <span className="chip" style={{ background: "rgba(0,0,0,.5)" }}>
              {h.zone.alive} squads left
            </span>
            <span className={`chip ${h.zone.shrinking ? "bad" : "warn"}`} style={{ background: "rgba(0,0,0,.5)" }}>
              {h.zone.shrinking ? "Storm closing" : "Storm shrinks in"} {fmtTime(h.zone.next)}
            </span>
          </div>
        )}
        {h.cacheActive && <span className="chip warn" style={{ background: "rgba(0,0,0,.5)" }}>◆ Data Cache active</span>}
        {h.storm > 0 && <span className="chip bad" style={{ background: "rgba(0,0,0,.5)" }}>NEON STORM {h.storm}s</span>}
        <div className="banners">
          {h.banners.map((b) => (
            <div key={b.id} className={`banner ${b.kind}`}>
              {b.text}
            </div>
          ))}
        </div>
      </div>

      {/* Top-right: kill feed */}
      <div className="tr">
        <div className="feed">
          {h.feed.map((f) => (
            <div key={f.id} className={f.me ? "me" : ""}>
              <span style={{ color: f.kColor }}>{f.killer}</span>
              <span className="w">
                {f.downed ? "▼ downed" : f.weapon}
                {f.head ? " ◎" : ""}
              </span>
              <span style={{ color: f.vColor }}>{f.victim}</span>
            </div>
          ))}
        </div>
      </div>

      {h.alive && !h.downed && <Crosshair h={h} t={t} />}
      <DamageArcs h={h} t={t} />

      {h.killBanner && (
        <div className="killbanner">
          {h.killBanner.head ? "◎ Headshot · " : ""}Eliminated {h.killBanner.name}
        </div>
      )}
      <div className="medals">
        {h.medals.map((m) => (
          <div key={m.id} className="medal">
            {MEDAL_NAMES[m.m] ?? m.m}
          </div>
        ))}
      </div>
      {h.prompt && <div className="prompt">{h.prompt}</div>}
      {h.channel && (
        <div className="channel">
          {h.channel.label}
          <div className="bar">
            <i style={{ width: `${h.channel.k * 100}%` }} />
          </div>
        </div>
      )}
      <div className="msgs">
        {h.msgs.map((m) => (
          <div key={m.id}>{m.text}</div>
        ))}
      </div>
      {h.scanned > t && <div className="warn-box">⚠ You've been scanned — your position is exposed</div>}
      {h.connectionWarning && <div className="warn-box">{h.connectionWarning}</div>}
      {h.zone?.outside && h.alive && <div className="warn-box" style={{ top: "14%" }}>OUTSIDE THE SAFE ZONE — {h.zone.dps} dmg/s</div>}

      {/* Bottom-left: vitals */}
      {h.alive && (
        <div className="bl">
          <div className="vitals">
            <div className="status-icons">
              {h.spawnProt > 0 && <span style={{ background: "#22e5ff", color: "#000" }}>SPAWN SHIELD</span>}
              {h.overdrive > 0 && <span style={{ background: "#ffe14a", color: "#000" }}>OVERDRIVE {Math.ceil(h.overdrive)}</span>}
              {h.emp > 0 && <span style={{ background: "#3df2ff", color: "#000" }}>EMP {Math.ceil(h.emp)}</span>}
              {h.downed && <span style={{ background: "#ff3b5c" }}>DOWNED</span>}
              {h.streak >= 2 && <span style={{ border: "1px solid #ff2bd6", color: "#ff2bd6" }}>STREAK {h.streak}</span>}
            </div>
            <div className="vnum">
              {Math.ceil(h.health)}
              <small>{h.maxArmor > 0 ? `+${Math.ceil(h.armor)} ARMOR` : ""}</small>
            </div>
            {h.maxArmor > 0 && (
              <div className="vbar ar">
                <i style={{ width: `${(h.armor / h.maxArmor) * 100}%` }} />
              </div>
            )}
            <div className={`vbar hp ${h.health > 35 ? "ok" : ""}`}>
              <i style={{ width: `${h.health}%` }} />
            </div>
            <div className="consum">
              <span>
                <span className="kbd">{bindLabel("heal")}</span> Injector ×{h.injectors}
              </span>
              <span>
                <span className="kbd">{bindLabel("plate")}</span> Plate ×{h.plates}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom-right: weapon & equipment */}
      {h.alive && !h.downed && (
        <div className="br">
          <div className="weapon-name" style={{ color: h.weaponColor, textShadow: `0 0 10px ${h.weaponColor}` }}>
            {h.weaponName}
          </div>
          <div className={`ammo ${h.magMax > 0 && h.mag <= h.magMax * 0.25 ? "low" : ""}`}>
            {h.reloading > 0 ? <span style={{ fontSize: 22 }}>RELOADING</span> : h.mag}
            <small> / {h.reserve}</small>
          </div>
          <div className="slots">
            {h.slots.map((sl) => (
              <div key={sl.key} className={`slot ${sl.active ? "on" : ""}`} style={{ borderRightColor: sl.color }}>
                <span className="kbd" style={{ minWidth: 14, padding: "0 4px" }}>
                  {sl.key}
                </span>
                {sl.name}
                <span style={{ opacity: 0.6 }}>{sl.ammo}</span>
              </div>
            ))}
          </div>
          <div className="equip">
            <div className="eq" style={{ borderColor: h.grenade.color }}>
              <span className="key">{bindLabel("grenade")}</span>
              <b style={{ color: h.grenade.color }}>{h.grenade.count}</b>
              {h.grenade.name.replace(" Grenade", "")}
              <div style={{ fontSize: 8, opacity: 0.6 }}>[{bindLabel("cycleGrenade")}] cycle</div>
            </div>
            <div className="eq" style={{ borderColor: h.tactical.color }}>
              <span className="key">{bindLabel("tactical")}</span>
              <b style={{ color: h.tactical.cd > 0 ? "#888" : h.tactical.color }}>{h.tactical.cd > 0 ? Math.ceil(h.tactical.cd) : "✦"}</b>
              {h.tactical.name}
              {h.tactical.cd > 0 && <div className="cd" style={{ height: `${(h.tactical.cd / h.tactical.max) * 100}%`, opacity: 0.5 }} />}
            </div>
          </div>
        </div>
      )}

      {h.phase === "starting" && <Countdown game={game} h={h} />}
      {h.endBanner && (
        <div className={`endbanner ${h.endBanner.win ? "win" : "lose"}`}>
          <h1>{h.endBanner.text}</h1>
          <div className="tagline">{h.endBanner.sub}</div>
        </div>
      )}
    </div>
  );
}

function ScoreBox({ label, value, color, mine }: { label: string; value: number; color: string; mine: boolean }) {
  return (
    <div className="scores">
      <div className="s" style={{ borderColor: color, boxShadow: mine ? `0 0 14px ${color}55` : undefined }}>
        <b style={{ color }}>{value}</b>
        <small>{label}</small>
      </div>
    </div>
  );
}

function Countdown({ game, h }: { game: Game; h: HudData }) {
  const info = MODE_INFO[game.cfg.mode];
  return (
    <div className="countdown">
      <div style={{ letterSpacing: "0.4em", fontSize: 14, color: "#aab" }}>{info.name.toUpperCase()}</div>
      <b>{Math.ceil(h.timeLeft)}</b>
      <div style={{ maxWidth: 460, fontSize: 14 }}>{info.blurb}</div>
      {game.cfg.modifiers.length > 0 && <div style={{ marginTop: 8, color: "var(--yellow)", fontSize: 12, letterSpacing: "0.15em" }}>MODIFIERS: {game.cfg.modifiers.join(" · ").toUpperCase()}</div>}
    </div>
  );
}

function Crosshair({ h, t }: { h: HudData; t: number }) {
  const s = useSettings();
  const hitAge = t - h.hit.t;
  const spreadPx = Math.max(3, h.spread * 9) * (1 - h.ads * 0.6);
  const color = s.crosshairColor;
  const sz = s.crosshairSize;
  const lines = [];
  if (h.ads < 0.85 || h.weaponName !== "Longshot-X") {
    if (s.crosshairStyle === "dot") lines.push(<i key="d" style={{ left: -2 * sz, top: -2 * sz, width: 4 * sz, height: 4 * sz, borderRadius: "50%" }} />);
    else if (s.crosshairStyle === "circle")
      lines.push(<i key="c" style={{ left: -spreadPx, top: -spreadPx, width: spreadPx * 2, height: spreadPx * 2, borderRadius: "50%", background: "transparent", border: `${1.5 * sz}px solid ${color}`, boxShadow: "none" }} />, <i key="d" style={{ left: -1, top: -1, width: 2, height: 2 }} />);
    else if (s.crosshairStyle === "chevron")
      lines.push(<i key="l" style={{ left: -spreadPx - 6 * sz, top: spreadPx * 0.6, width: 8 * sz, height: 2 * sz, transform: "rotate(-35deg)" }} />, <i key="r" style={{ left: spreadPx - 2 * sz, top: spreadPx * 0.6, width: 8 * sz, height: 2 * sz, transform: "rotate(35deg)" }} />, <i key="d" style={{ left: -1, top: -1, width: 2, height: 2 }} />);
    else {
      const L = 7 * sz;
      const W = 2 * sz;
      lines.push(
        <i key="t" style={{ left: -W / 2, top: -spreadPx - L, width: W, height: L }} />,
        <i key="b" style={{ left: -W / 2, top: spreadPx, width: W, height: L }} />,
        <i key="l" style={{ left: -spreadPx - L, top: -W / 2, width: L, height: W }} />,
        <i key="r" style={{ left: spreadPx, top: -W / 2, width: L, height: W }} />,
      );
    }
  }
  return (
    <>
      <div className="xhair" style={{ ["--xh" as string]: color, opacity: h.sprint ? 0.3 : 1 }}>
        {lines}
      </div>
      {hitAge < 0.25 && (
        <div className={`hitmark ${h.hit.kill ? "kill" : h.hit.head ? "head" : ""}`} style={{ opacity: 1 - hitAge / 0.25 }}>
          {[45, 135, 225, 315].map((a) => (
            <i key={a} style={{ transform: `rotate(${a}deg) translateX(${10 + hitAge * 20}px)` }} />
          ))}
        </div>
      )}
      {h.reloading > 0 && (
        <svg className="reload-ring" width="56" height="56" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
          <circle cx="28" cy="28" r="22" fill="none" stroke={h.weaponColor} strokeWidth="3" strokeDasharray={`${h.reloading * 138} 200`} transform="rotate(-90 28 28)" />
        </svg>
      )}
    </>
  );
}

function DamageArcs({ h, t }: { h: HudData; t: number }) {
  return (
    <>
      {h.damageDirs.map((d, i) => {
        const rel = ((h.yaw - d.a) * 180) / Math.PI;
        return (
          <div key={`d${i}`} className="dmg-arc" style={{ transform: `rotate(${rel}deg)`, opacity: Math.max(0, 1 - (t - d.t) / 1.4) * (0.5 + d.amt * 0.5) }}>
            <i />
          </div>
        );
      })}
      {h.soundCues.map((c, i) => {
        const rel = ((h.yaw - c.a) * 180) / Math.PI;
        return (
          <div key={`c${i}`} className={`dmg-arc cue-arc ${c.kind}`} style={{ transform: `rotate(${rel}deg)`, opacity: Math.max(0, 1 - (t - c.t)) }}>
            <i />
          </div>
        );
      })}
    </>
  );
}

function Minimap({ game, h }: { game: Game; h: HudData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const d = game.district;
  const map = getFrontierMap();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const img = d ? mapImage(d.minX, d.minZ, d.maxX, d.maxZ, 2) : mapImage(map.minX, map.minZ, map.maxX, map.maxZ, 1);
    const S = 1.6; // px per metre on the minimap
    ctx.clearRect(0, 0, 200, 200);
    ctx.save();
    ctx.translate(100, 100);
    ctx.rotate(h.yaw);
    ctx.globalAlpha = 0.9;
    const k = S / img.scale;
    ctx.drawImage(img.canvas, (img.minX - h.meX) * S, (img.minZ - h.meZ) * S, img.canvas.width * k, img.canvas.height * k);
    ctx.globalAlpha = 1;
    const m = game.match;
    if (m?.zn) {
      ctx.strokeStyle = "rgba(190,80,255,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc((m.zn.x - h.meX) * S, (m.zn.z - h.meZ) * S, m.zn.r * S, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc((m.zn.tx - h.meX) * S, (m.zn.tz - h.meZ) * S, m.zn.tr * S, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const mk of h.markers) {
      const x = (mk.x - h.meX) * S;
      const y = (mk.z - h.meZ) * S;
      ctx.fillStyle = mk.color;
      if (mk.kind === "point" || mk.kind === "cache" || mk.kind === "power") {
        ctx.font = "bold 12px sans-serif";
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-h.yaw);
        ctx.textAlign = "center";
        ctx.fillText(mk.kind === "point" ? mk.label ?? "" : mk.kind === "cache" ? "◆" : "★", 0, 4);
        ctx.restore();
      } else if (mk.kind === "ping") {
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    // Player arrow (always pointing up).
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(100, 92);
    ctx.lineTo(106, 106);
    ctx.lineTo(100, 102);
    ctx.lineTo(94, 106);
    ctx.closePath();
    ctx.fill();
  });
  return <canvas ref={ref} width={200} height={200} className={`minimap ${h.emp > 0 ? "emp" : ""}`} />;
}
