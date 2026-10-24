import { useState } from "react";
import { DISTRICT_IDS, MODE_INFO, MODIFIER_IDS, MODIFIER_INFO, PAYLOAD_CHECKPOINT_BONUS, districtMeta, isSoloMode, makeMatchConfig } from "@neon/shared";
import type { ArenaId, ModeId, ModifierId } from "@neon/shared";
import { go, store, useStore } from "../../state/store";
import type { PracticeSetup } from "../../state/store";
import { LocalConnection } from "../../net/local";
import { LoadoutPicker } from "../components/LoadoutPicker";
import { audio } from "../../audio/audio";

/** Launches an offline match with AI opponents — no network involved. */
export function startPractice(setup: PracticeSetup): void {
  const s = store.get();
  const conn = new LocalConnection({
    mode: setup.mode as ModeId,
    arena: setup.arena as ArenaId,
    teamSize: setup.teamSize,
    bots: setup.bots,
    difficulty: setup.difficulty,
    modifiers: setup.modifiers as ModifierId[],
    timeLimit: setup.timeLimit,
    side: setup.side,
    name: s.name,
    loadout: s.loadout,
  });
  const off = conn.onMessage((m) => {
    if (m.t === "match_start") {
      off();
      store.set({ match: { info: m.info, conn, offline: true, practice: setup }, results: null });
      go("loading");
    }
  });
}

const MODES: ModeId[] = ["tdm", "ffa", "gungame", "dom", "payload", "br"];
const TEAM_MODES: ModeId[] = ["tdm", "dom", "payload"];

export function PracticeScreen() {
  const loadout = useStore((s) => s.loadout);
  const [mode, setMode] = useState<ModeId>("tdm");
  const [arena, setArena] = useState<string>("neon_city");
  const [teamSize, setTeamSize] = useState(6);
  const [squad, setSquad] = useState(1);
  const [difficulty, setDifficulty] = useState<PracticeSetup["difficulty"]>("standard");
  const [mods, setMods] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(8);
  const [side, setSide] = useState(0);
  const cfg = makeMatchConfig({ mode, arena: arena as ArenaId, teamSize: mode === "br" ? squad : teamSize, offline: true });
  const maxBots = cfg.maxPlayers - 1;
  // Default to a full lobby; the slider can thin it out.
  const [bots, setBots] = useState<number | null>(null);
  const effectiveBots = Math.min(bots ?? maxBots, maxBots);
  const start = () => {
    audio.uiClick();
    startPractice({
      mode, arena, teamSize: cfg.teamSize, bots: TEAM_MODES.includes(mode) ? cfg.maxPlayers - 1 : effectiveBots, difficulty, modifiers: mods,
      // Payload uses its own starting clock (checkpoints extend it).
      timeLimit: mode === "payload" ? cfg.timeLimit : minutes * 60, side: mode === "payload" ? side : undefined,
    });
  };
  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn" onClick={() => go("menu")}>
          ← Back
        </button>
        <h2>Practice</h2>
        <span className="chip">Offline · runs entirely in your browser</span>
        <span className="spacer" />
        <button className="btn primary big" onClick={start}>
          Deploy
        </button>
      </div>
      <div className="grid2">
        <div className="col" style={{ gap: 18 }}>
          <div className="panel">
            <h3>Mode</h3>
            <div className="grid2" style={{ gap: 10 }}>
              {MODES.map((m) => (
                <button key={m} aria-label={`${MODE_INFO[m].name} mode`} aria-pressed={mode === m} className={`card ${mode === m ? "sel" : ""}`} onClick={() => setMode(m)}>
                  <h4>{MODE_INFO[m].name}</h4>
                  <p>{MODE_INFO[m].blurb}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Opponents</h3>
            <div className="col">
              <div className="field">
                AI difficulty
                <div className="seg">
                  {(["rookie", "standard", "veteran", "elite"] as const).map((d) => (
                    <button key={d} className={difficulty === d ? "on" : ""} onClick={() => setDifficulty(d)}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              {(TEAM_MODES.includes(mode) || mode === "br") && (
                <div className="field">
                  {mode === "br" ? "Squad size" : "Team size"}
                  <div className="seg">
                    {(mode === "br" ? [1, 2, 3, 4] : [3, 4, 5, 6, 8]).map((n) => (
                      <button
                        key={n}
                        className={(mode === "br" ? squad : teamSize) === n ? "on" : ""}
                        onClick={() => (mode === "br" ? setSquad(n) : setTeamSize(n))}
                      >
                        {mode === "br" ? ["Solo", "Duo", "Trio", "Squad"][n - 1] : `${n}v${n}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(isSoloMode(mode) || mode === "br") && (
                <label className="field">
                  <span className="row" style={{ justifyContent: "space-between" }}>
                    AI players <b className="mono">{effectiveBots}</b>
                  </span>
                  <input type="range" min={1} max={maxBots} value={effectiveBots} onChange={(e) => setBots(Number(e.target.value))} />
                </label>
              )}
              {mode === "payload" && (
                <div className="field">
                  Your side
                  <div className="seg">
                    {["Attack", "Defend"].map((l, i) => (
                      <button key={l} className={side === i ? "on" : ""} onClick={() => setSide(i)}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {TEAM_MODES.includes(mode) && (
                <div className="small muted">
                  You + {cfg.teamSize - 1} AI teammate{cfg.teamSize === 2 ? "" : "s"} vs {cfg.teamSize} AI opponents.
                </div>
              )}
              {mode === "payload" ? (
                <div className="small muted">
                  Attackers start with {Math.floor(cfg.timeLimit / 60)}:{String(cfg.timeLimit % 60).padStart(2, "0")} on the clock; each of the two checkpoints adds{" "}
                  {PAYLOAD_CHECKPOINT_BONUS}s. Left alone, the payload rolls back to the last checkpoint.
                </div>
              ) : (
                <label className="field">
                  <span className="row" style={{ justifyContent: "space-between" }}>
                    Time limit <b className="mono">{minutes} min</b>
                  </span>
                  <input type="range" min={3} max={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
                </label>
              )}
            </div>
          </div>
        </div>
        <div className="col" style={{ gap: 18 }}>
          <div className="panel">
            <h3>District</h3>
            {mode === "br" ? (
              <p className="small muted">Battle Royale uses the entire Neon Frontier region — all eight districts and the bay.</p>
            ) : (
              <div className="grid2" style={{ gap: 8 }}>
                {DISTRICT_IDS.map((d) => {
                  const m = districtMeta(d);
                  return (
                    <button key={d} aria-label={`${m.name} district`} aria-pressed={arena === d} className={`card ${arena === d ? "sel" : ""}`} onClick={() => setArena(d)} style={{ padding: 10 }}>
                      <h4 style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 12, height: 12, borderRadius: 99, background: `#${m.accent.toString(16).padStart(6, "0")}`, border: "2px solid #1f2a44" }} />
                        {m.name}
                      </h4>
                      <p style={{ fontSize: 12 }}>{m.tagline}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="panel">
            <h3>Match modifiers (optional)</h3>
            <div className="col" style={{ gap: 6 }}>
              {MODIFIER_IDS.map((m) => (
                <label key={m} className="check">
                  <input type="checkbox" checked={mods.includes(m)} onChange={(e) => setMods(e.target.checked ? [...mods, m] : mods.filter((x) => x !== m))} />
                  <span>
                    <b>{MODIFIER_INFO[m].name}</b> <span className="muted small">— {MODIFIER_INFO[m].blurb}</span>
                  </span>
                </label>
              ))}
              <button
                className="btn small"
                style={{ alignSelf: "flex-start" }}
                onClick={() => setMods(MODIFIER_IDS.filter(() => Math.random() < 0.3).slice(0, 2))}
              >
                🎲 Randomize
              </button>
            </div>
          </div>
          <div className="panel">
            <h3>Loadout</h3>
            <LoadoutPicker value={loadout} onChange={(l) => store.set({ loadout: l })} />
          </div>
        </div>
      </div>
    </div>
  );
}
