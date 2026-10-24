import { useSyncExternalStore } from "react";

export type Action =
  | "forward" | "back" | "left" | "right" | "jump" | "sprint" | "crouch" | "reload" | "interact" | "tactical" | "grenade"
  | "cycleGrenade" | "heal" | "plate" | "slot1" | "slot2" | "slot3" | "scoreboard" | "map";

export const ACTION_LABELS: Record<Action, string> = {
  forward: "Move forward", back: "Move back", left: "Strafe left", right: "Strafe right", jump: "Jump", sprint: "Sprint",
  crouch: "Crouch / slide", reload: "Reload", interact: "Interact / pick up / revive", tactical: "Tactical ability",
  grenade: "Throw grenade", cycleGrenade: "Cycle grenade type", heal: "Healing injector", plate: "Armor plate",
  slot1: "Primary weapon", slot2: "Sidearm", slot3: "Power weapon", scoreboard: "Scoreboard (hold)", map: "Map overlay",
};

export const DEFAULT_BINDS: Record<Action, string[]> = {
  forward: ["KeyW", "ArrowUp"], back: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
  jump: ["Space"], sprint: ["ShiftLeft"], crouch: ["KeyC"], reload: ["KeyR"], interact: ["KeyE"], tactical: ["KeyQ"],
  grenade: ["KeyG"], cycleGrenade: ["Digit4"], heal: ["KeyF"], plate: ["KeyX"], slot1: ["Digit1"], slot2: ["Digit2"],
  slot3: ["Digit3"], scoreboard: ["Tab"], map: ["KeyM"],
};

export type Quality = "low" | "medium" | "high";

export interface Settings {
  sensitivity: number;
  adsSensitivity: number;
  invertY: boolean;
  fov: number;
  crouchToggle: boolean;
  adsToggle: boolean;
  quality: Quality;
  resolutionScale: number;
  bloom: boolean;
  rain: boolean;
  shadows: boolean;
  particles: Quality;
  showFps: boolean;
  masterVol: number;
  musicVol: number;
  sfxVol: number;
  ambientVol: number;
  uiVol: number;
  headBob: boolean;
  cameraShake: boolean;
  reduceMotion: boolean;
  colorblind: boolean;
  crosshairStyle: "cross" | "dot" | "circle" | "chevron";
  crosshairColor: string;
  crosshairSize: number;
  hudScale: number;
  competitiveHud: boolean;
  visualSoundCues: boolean;
  binds: Record<Action, string[]>;
  /** Opt-in: store *only these preferences* in localStorage. Never identity or stats. */
  remember: boolean;
  tutorialSeen: boolean;
}

export const PRESETS: Record<Quality, Partial<Settings>> = {
  low: { quality: "low", resolutionScale: 0.75, bloom: false, rain: false, shadows: false, particles: "low" },
  medium: { quality: "medium", resolutionScale: 1, bloom: true, rain: false, shadows: false, particles: "medium" },
  high: { quality: "high", resolutionScale: 1, bloom: true, rain: false, shadows: true, particles: "high" },
};

const DEFAULTS: Settings = {
  sensitivity: 1, adsSensitivity: 0.75, invertY: false, fov: 92, crouchToggle: false, adsToggle: false,
  quality: "medium", resolutionScale: 1, bloom: true, rain: false, shadows: false, particles: "medium", showFps: true,
  masterVol: 0.8, musicVol: 0.45, sfxVol: 0.9, ambientVol: 0.5, uiVol: 0.6,
  headBob: true, cameraShake: true, reduceMotion: false, colorblind: false,
  crosshairStyle: "cross", crosshairColor: "#ffffff", crosshairSize: 1, hudScale: 1, competitiveHud: false, visualSoundCues: true,
  binds: structuredClone(DEFAULT_BINDS), remember: false, tutorialSeen: false,
};

const KEY = "neon-reckoning:prefs";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULTS, ...parsed, binds: { ...DEFAULT_BINDS, ...(parsed.binds ?? {}) }, remember: true };
    }
  } catch {
    /* storage unavailable (private mode) — use defaults */
  }
  // Pick a sensible default preset for weaker devices.
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores <= 4 ? { ...DEFAULTS, ...PRESETS.low } : { ...DEFAULTS };
}

let settings: Settings = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    if (settings.remember) localStorage.setItem(KEY, JSON.stringify(settings));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const settingsStore = {
  get: () => settings,
  set(patch: Partial<Settings>) {
    settings = { ...settings, ...patch };
    persist();
    for (const l of listeners) l();
  },
  reset() {
    settings = { ...DEFAULTS, binds: structuredClone(DEFAULT_BINDS), remember: settings.remember };
    persist();
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
}

export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const map: Record<string, string> = {
    Space: "Space", ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl", AltLeft: "L-Alt",
    Tab: "Tab", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", CapsLock: "Caps", Backquote: "`",
  };
  return map[code] ?? code;
}

export function bindLabel(a: Action): string {
  return keyLabel(settings.binds[a]?.[0] ?? "—");
}
