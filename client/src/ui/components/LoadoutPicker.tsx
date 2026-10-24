import { PRIMARY_IDS, TACTICAL_IDS, TACTICALS, WEAPONS } from "@neon/shared";
import type { Loadout } from "@neon/shared";
import { audio } from "../../audio/audio";

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** Primary weapon + tactical ability selection (sidearm is always the Phantom). */
export function LoadoutPicker({ value, onChange, compact = false }: { value: Loadout; onChange: (l: Loadout) => void; compact?: boolean }) {
  return (
    <div className="col" style={{ gap: compact ? 8 : 12 }}>
      <div className="small muted" style={{ letterSpacing: "0.15em" }}>
        PRIMARY
      </div>
      <div className="row" style={{ gap: 6 }}>
        {PRIMARY_IDS.map((id) => {
          const w = WEAPONS[id];
          const on = value.primary === id;
          return (
            <button
              key={id}
              className={`chip ${on ? "on" : ""}`}
              style={{ cursor: "pointer", borderColor: hex(w.color), background: on ? hex(w.color) : "#fff", color: "#1f2a44", border: `2px solid ${hex(w.color)}`, padding: "6px 12px" }}
              title={`${w.category} — ${w.blurb}`}
              onClick={() => {
                audio.uiClick();
                onChange({ ...value, primary: id });
              }}
            >
              {w.name}
            </button>
          );
        })}
      </div>
      {!compact && <div className="small muted">{WEAPONS[value.primary].category} — {WEAPONS[value.primary].blurb}</div>}
      <div className="small muted" style={{ letterSpacing: "0.15em" }}>
        TACTICAL <span className="kbd">Q</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {TACTICAL_IDS.map((id) => {
          const t = TACTICALS[id];
          const on = value.tactical === id;
          return (
            <button
              key={id}
              className={`chip ${on ? "on" : ""}`}
              style={{ cursor: "pointer", padding: "6px 10px" }}
              title={t.blurb}
              onClick={() => {
                audio.uiClick();
                onChange({ ...value, tactical: id });
              }}
            >
              {t.name}
            </button>
          );
        })}
      </div>
      {!compact && <div className="small muted">{TACTICALS[value.tactical].blurb}</div>}
      <div className="small muted">Sidearm: Phantom · Grenades: 2 Frag, 1 Smoke, 1 Flash, 1 EMP · Power weapons spawn on the map.</div>
    </div>
  );
}
