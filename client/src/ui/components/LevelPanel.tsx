import { CAMOS, progress, titleFor, useProgress, xpToNext } from "../../state/progress";
import type { Camo } from "../../state/progress";
import { audio } from "../../audio/audio";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** CSS preview of a camo finish. */
export function camoSwatch(c: Camo): string {
  const b = hex(c.body);
  const ink = hex(c.ink ?? c.dark);
  switch (c.pattern) {
    case "dots":
      return `radial-gradient(${ink} 18%, transparent 20%) 0 0 / 9px 9px, ${b}`;
    case "stripes":
      return `repeating-linear-gradient(60deg, ${b} 0 6px, ${ink} 6px 10px)`;
    case "checker":
      return `conic-gradient(${ink} 25%, ${b} 0 50%, ${ink} 0 75%, ${b} 0) 0 0 / 12px 12px`;
    case "flames":
      return `linear-gradient(0deg, ${ink}, ${b} 70%)`;
    case "stars":
      return `radial-gradient(#fff 8%, transparent 10%) 0 0 / 7px 7px, radial-gradient(#a78bfa 30%, transparent 60%), ${b}`;
    case "prism":
      return "linear-gradient(90deg, #ff4f9a, #ffbe0b, #22c55e, #2f9bff, #a78bfa)";
    default:
      return c.metal ? `linear-gradient(135deg, ${b}, #fff6c9 45%, ${b} 60%, ${hex(c.dark)})` : b;
  }
}

/** Session level, XP bar, title and the weapon-finish picker. */
export function LevelPanel() {
  const p = useProgress();
  const need = xpToNext(p.level);
  return (
    <div className="panel level-panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>
          Level {p.level} <span className="muted small">· {titleFor(p.level)}</span>
        </h3>
        <span className="mono small">
          {p.into}/{need} XP
        </span>
      </div>
      <div className="bar xp" style={{ marginTop: 6 }}>
        <i style={{ width: `${(p.into / need) * 100}%` }} />
      </div>
      <div className="small" style={{ margin: "12px 0 6px" }}>
        Weapon finish
      </div>
      <div className="camos">
        {CAMOS.map((c) => {
          const locked = c.level > p.level;
          return (
            <button
              key={c.id}
              className={`camo ${p.camo === c.id ? "on" : ""} ${locked ? "locked" : ""}`}
              title={locked ? `${c.name} — unlocks at level ${c.level}` : c.name}
              aria-label={locked ? `${c.name}, locked until level ${c.level}` : `${c.name} finish`}
              aria-pressed={p.camo === c.id}
              disabled={locked}
              onClick={() => {
                audio.uiClick();
                progress.setCamo(c.id);
              }}
            >
              <span className="sw" style={{ background: camoSwatch(c) }} />
              <span className="nm">{locked ? `Lv ${c.level}` : c.name}</span>
            </button>
          );
        })}
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        Earn XP from every point you score, wins and challenges.{" "}
        {p.remember
          ? "Your level and finish are saved in this browser (turn off in Settings → Storage)."
          : "Levels and finishes last for this visit only, unless you turn on saving in Settings → Storage."}
      </div>
    </div>
  );
}
