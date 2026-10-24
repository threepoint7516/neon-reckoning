import { useEffect, useState } from "react";
import { ACTION_LABELS, DEFAULT_BINDS, PRESETS, keyLabel, settingsStore, useSettings } from "../../state/settings";
import type { Action, Quality, Settings } from "../../state/settings";
import { go, store } from "../../state/store";
import { audio } from "../../audio/audio";
import { progress, useProgress } from "../../state/progress";

type Tab = "controls" | "graphics" | "audio" | "access" | "privacy";

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="field">
      <span className="row" style={{ justifyContent: "space-between" }}>
        {label}
        <b className="mono" style={{ color: "var(--text)" }}>
          {fmt ? fmt(value) : value}
        </b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Check({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div>
      <label className="check">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <div className="small muted" style={{ marginLeft: 26 }}>{hint}</div>}
    </div>
  );
}

function Binder() {
  const s = useSettings();
  const [waiting, setWaiting] = useState<Action | null>(null);
  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setWaiting(null);
        return;
      }
      const binds = structuredClone(s.binds);
      // Remove this key from any other action to avoid conflicts.
      for (const a of Object.keys(binds) as Action[]) binds[a] = binds[a].filter((c) => c !== e.code);
      binds[waiting] = [e.code, ...binds[waiting].filter((c) => c !== e.code)].slice(0, 2);
      settingsStore.set({ binds });
      setWaiting(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [waiting, s.binds]);
  return (
    <div className="col" style={{ gap: 4 }}>
      {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
        <div key={a} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,.05)", padding: "4px 0" }}>
          <span className="small">{ACTION_LABELS[a]}</span>
          <span className="row" style={{ gap: 6 }}>
            {s.binds[a].map((c) => (
              <span key={c} className="kbd">
                {keyLabel(c)}
              </span>
            ))}
            <button className="btn small" onClick={() => setWaiting(a)}>
              {waiting === a ? "Press a key… (Esc cancels)" : "Rebind"}
            </button>
          </span>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => settingsStore.set({ binds: structuredClone(DEFAULT_BINDS) })}>
          Reset key bindings
        </button>
        <span className="small muted">Tip: Ctrl can be bound to crouch, but Ctrl+W may close the tab outside fullscreen.</span>
      </div>
    </div>
  );
}

export function SettingsPanel({ compact = false }: { compact?: boolean }) {
  const s = useSettings();
  const prog = useProgress();
  const [tab, setTab] = useState<Tab>("controls");
  const set = (p: Partial<Settings>) => settingsStore.set(p);
  return (
    <div className="col">
      <div className="seg" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
        {(
          [
            ["controls", "Controls"],
            ["graphics", "Graphics"],
            ["audio", "Audio"],
            ["access", "Accessibility"],
            ["privacy", "Storage"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ maxHeight: compact ? "56vh" : undefined, overflowY: compact ? "auto" : undefined, paddingRight: 6 }}>
        {tab === "controls" && (
          <div className="grid2">
            <div className="col">
              <Slider label="Mouse sensitivity" value={s.sensitivity} min={0.1} max={4} step={0.05} onChange={(v) => set({ sensitivity: v })} fmt={(v) => v.toFixed(2)} />
              <Slider label="Aim (ADS) sensitivity multiplier" value={s.adsSensitivity} min={0.2} max={1.5} step={0.05} onChange={(v) => set({ adsSensitivity: v })} fmt={(v) => v.toFixed(2)} />
              <Slider label="Field of view" value={s.fov} min={70} max={115} step={1} onChange={(v) => set({ fov: v })} fmt={(v) => `${v}°`} />
              <Check label="Invert vertical look" value={s.invertY} onChange={(v) => set({ invertY: v })} />
              <Check label="Toggle crouch (instead of hold)" value={s.crouchToggle} onChange={(v) => set({ crouchToggle: v })} />
              <Check label="Toggle aim (instead of hold)" value={s.adsToggle} onChange={(v) => set({ adsToggle: v })} />
            </div>
            <Binder />
          </div>
        )}
        {tab === "graphics" && (
          <div className="grid2">
            <div className="col">
              <div className="field">
                Preset
                <div className="seg">
                  {(["low", "medium", "high"] as Quality[]).map((q) => (
                    <button key={q} className={s.quality === q ? "on" : ""} onClick={() => set(PRESETS[q])}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              <Slider label="Resolution scale" value={s.resolutionScale} min={0.5} max={1} step={0.05} onChange={(v) => set({ resolutionScale: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
              <div className="field">
                Particles
                <div className="seg">
                  {(["low", "medium", "high"] as Quality[]).map((q) => (
                    <button key={q} className={s.particles === q ? "on" : ""} onClick={() => set({ particles: q })}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="col">
              <Check label="Bloom & post-processing" value={s.bloom} onChange={(v) => set({ bloom: v })} hint="Disabled automatically on the Low preset." />
              <Check label="Rain" value={s.rain} onChange={(v) => set({ rain: v })} hint="Applies to the next match." />
              <Check label="Dynamic shadows" value={s.shadows} onChange={(v) => set({ shadows: v })} hint="Applies to the next match. Costly on integrated GPUs." />
              <Check label="Show FPS & latency" value={s.showFps} onChange={(v) => set({ showFps: v })} />

            </div>
          </div>
        )}
        {tab === "audio" && (
          <div className="grid2">
            <div className="col">
              <Slider label="Master" value={s.masterVol} min={0} max={1} step={0.05} onChange={(v) => set({ masterVol: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Music" value={s.musicVol} min={0} max={1} step={0.05} onChange={(v) => {
                set({ musicVol: v });
                if (v === 0) audio.playMusic("off");
              }} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Effects" value={s.sfxVol} min={0} max={1} step={0.05} onChange={(v) => set({ sfxVol: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
            </div>
            <div className="col">
              <Slider label="Ambience" value={s.ambientVol} min={0} max={1} step={0.05} onChange={(v) => set({ ambientVol: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Interface" value={s.uiVol} min={0} max={1} step={0.05} onChange={(v) => set({ uiVol: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
              <div className="small muted">All sounds are synthesized live in your browser. The game is fully playable muted.</div>
            </div>
          </div>
        )}
        {tab === "access" && (
          <div className="grid2">
            <div className="col">
              <Check label="Colour-blind friendly team colours (blue / orange)" value={s.colorblind} onChange={(v) => set({ colorblind: v })} />
              <Check label="Reduce motion (no glitch, scanline or menu animations)" value={s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
              <Check label="Head bob" value={s.headBob} onChange={(v) => set({ headBob: v })} />
              <Check label="Camera shake" value={s.cameraShake} onChange={(v) => set({ cameraShake: v })} />
              <Check label="Visual sound cues (gunfire & footsteps direction)" value={s.visualSoundCues} onChange={(v) => set({ visualSoundCues: v })} />
              <Check label="Clean competitive HUD" value={s.competitiveHud} onChange={(v) => set({ competitiveHud: v })} hint="Hides medal popups and decorative effects." />
            </div>
            <div className="col">
              <div className="field">
                Crosshair
                <div className="seg">
                  {(["cross", "dot", "circle", "chevron"] as const).map((c) => (
                    <button key={c} className={s.crosshairStyle === c ? "on" : ""} onClick={() => set({ crosshairStyle: c })}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                Crosshair colour
                <input type="color" value={s.crosshairColor} onChange={(e) => set({ crosshairColor: e.target.value })} style={{ width: 64, height: 32, background: "transparent", border: "1px solid var(--line)" }} />
              </label>
              <Slider label="Crosshair size" value={s.crosshairSize} min={0.5} max={2} step={0.1} onChange={(v) => set({ crosshairSize: v })} fmt={(v) => v.toFixed(1)} />
              <Slider label="HUD scale" value={s.hudScale} min={0.7} max={1.4} step={0.05} onChange={(v) => set({ hudScale: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
            </div>
          </div>
        )}
        {tab === "privacy" && (
          <div className="col" style={{ maxWidth: 680 }}>
            <Check
              label="Remember these settings on this device"
              value={s.remember}
              onChange={(v) => set({ remember: v })}
              hint="Off by default. When on, only your control, graphics, audio and accessibility preferences are saved in this browser's localStorage. Your callsign and match stats are never stored."
            />
            <Check
              label="Remember my level, XP and weapon finish on this device"
              value={prog.remember}
              onChange={(v) => progress.setRemember(v)}
              hint="Off by default. When on, only two values are saved in this browser's localStorage: your total XP (your level is worked out from it) and the camo you picked. Nothing is sent to any server. Turning it off deletes the saved copy straight away; your progress in this tab stays until you close it."
            />
            <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => settingsStore.reset()}>
              Reset all settings to defaults
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsScreen() {
  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn" onClick={() => go(store.get().prevScreen === "play" || store.get().prevScreen === "practice" ? store.get().prevScreen : "menu")}>
          ← Back
        </button>
        <h2>Settings</h2>
      </div>
      <div className="panel" style={{ maxWidth: 1100 }}>
        <SettingsPanel />
      </div>
    </div>
  );
}
