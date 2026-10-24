// Progression: XP, levels, titles and weapon camos.
// Memory-only by default. If the player opts in, total XP and the chosen camo
// (nothing else) are saved in this browser's localStorage.

import { useSyncExternalStore } from "react";

export type CamoPattern = "solid" | "dots" | "stripes" | "checker" | "flames" | "stars" | "prism";

export interface Camo {
  id: string;
  name: string;
  /** Level that unlocks it. */
  level: number;
  body: number;
  dark: number;
  pattern: CamoPattern;
  /** Pattern ink colour. */
  ink?: number;
  metal?: boolean;
}

export const CAMOS: Camo[] = [
  { id: "factory", name: "Factory", level: 1, body: 0xf1f3f5, dark: 0x3d405b, pattern: "solid" },
  { id: "bubblegum", name: "Bubblegum", level: 2, body: 0xff9ecf, dark: 0x7a2e5c, pattern: "solid" },
  { id: "mint", name: "Mint Chip", level: 3, body: 0xa8f0d1, dark: 0x2e5947, pattern: "dots", ink: 0x4a2c1d },
  { id: "tiger", name: "Tiger", level: 4, body: 0xffb347, dark: 0x2b1d0e, pattern: "stripes", ink: 0x2b1d0e },
  { id: "arcade", name: "Arcade", level: 5, body: 0x3a86ff, dark: 0x1d2b53, pattern: "checker", ink: 0xffbe0b },
  { id: "lava", name: "Lava", level: 7, body: 0xff5a1f, dark: 0x3a0d05, pattern: "flames", ink: 0xffd166 },
  { id: "galaxy", name: "Galaxy", level: 9, body: 0x2b2d6e, dark: 0x0f1030, pattern: "stars", ink: 0xffffff },
  { id: "gold", name: "Gold", level: 12, body: 0xffcf3f, dark: 0x8a5a00, pattern: "solid", metal: true },
  { id: "prism", name: "Prism", level: 15, body: 0xffffff, dark: 0x2a2a40, pattern: "prism" },
];

export const TITLES: { level: number; title: string }[] = [
  { level: 1, title: "Rookie" },
  { level: 3, title: "Brawler" },
  { level: 5, title: "Sharpshooter" },
  { level: 8, title: "Street Legend" },
  { level: 10, title: "Night Owl" },
  { level: 12, title: "Golden Gun" },
  { level: 15, title: "Neon Royalty" },
];

/** XP needed to go from `level` to `level + 1` — quick early levels, gentle ramp. */
export const xpToNext = (level: number) => 600 + (level - 1) * 250;

export const WIN_XP = 300;
export const FINISH_XP = 150;
export const CHALLENGE_XP = 500;

export function unlocksAt(level: number): string[] {
  const out: string[] = [];
  for (const c of CAMOS) if (c.level === level) out.push(`${c.name} camo`);
  for (const t of TITLES) if (t.level === level) out.push(`"${t.title}" title`);
  return out;
}

export function titleFor(level: number): string {
  let t = TITLES[0]!.title;
  for (const x of TITLES) if (level >= x.level) t = x.title;
  return t;
}

interface MatchXp {
  combat: number;
  bonuses: { label: string; xp: number }[];
  startLevel: number;
  startInto: number;
  unlocked: string[];
}

interface ProgressState {
  /** XP into the current level. */
  into: number;
  level: number;
  total: number;
  camo: string;
  /** Opted in to saving progress in this browser. */
  remember: boolean;
  match: MatchXp;
}

/** Splits total XP into a level and the XP into it. */
export function levelFromTotal(total: number): { level: number; into: number } {
  let level = 1;
  let into = total;
  while (into >= xpToNext(level)) {
    into -= xpToNext(level);
    level++;
  }
  return { level, into };
}

export const PROGRESS_KEY = "neon-reckoning:progress";
/** Sanity cap so a hand-edited value can't hang the level loop. */
const MAX_SAVED_XP = 10_000_000;

/** Reads opted-in progress; anything malformed is ignored (and the game starts fresh). */
function load(): Pick<ProgressState, "into" | "level" | "total" | "camo" | "remember"> {
  const fresh = { into: 0, level: 1, total: 0, camo: "factory", remember: false };
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as { v?: unknown; xp?: unknown; camo?: unknown };
    if (p.v !== 1 || typeof p.xp !== "number" || !Number.isFinite(p.xp) || p.xp < 0) return { ...fresh, remember: true };
    const total = Math.min(Math.floor(p.xp), MAX_SAVED_XP);
    const { level, into } = levelFromTotal(total);
    const camo = CAMOS.find((c) => c.id === p.camo && c.level <= level)?.id ?? "factory";
    return { into, level, total, camo, remember: true };
  } catch {
    return fresh; // storage unavailable (private mode) or corrupt
  }
}

function save(): void {
  if (!state.remember) return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ v: 1, xp: state.total, camo: state.camo }));
  } catch {
    /* quota or storage disabled — keep playing from memory */
  }
}

let state: ProgressState = {
  ...load(),
  match: { combat: 0, bonuses: [], startLevel: 1, startInto: 0, unlocked: [] },
};
const listeners = new Set<() => void>();
const levelUpListeners = new Set<(level: number, unlocked: string[]) => void>();

let queued = false;
/** Publishes a new snapshot; listeners run after the current task so XP can be awarded mid-render. */
function emit(): void {
  state = { ...state, match: { ...state.match } };
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const l of listeners) l();
  });
}

export const progress = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  onLevelUp(l: (level: number, unlocked: string[]) => void) {
    levelUpListeners.add(l);
    return () => levelUpListeners.delete(l);
  },
  /** Resets the per-match XP breakdown. */
  beginMatch(): void {
    state.match = { combat: 0, bonuses: [], startLevel: state.level, startInto: state.into, unlocked: [] };
    emit();
  },
  /** Adds XP (combat XP unless a bonus label is given) and fires level-ups. */
  add(xp: number, bonus?: string): void {
    if (xp <= 0) return;
    if (bonus) state.match.bonuses.push({ label: bonus, xp });
    else state.match.combat += xp;
    state.total += xp;
    state.into += xp;
    while (state.into >= xpToNext(state.level)) {
      state.into -= xpToNext(state.level);
      state.level++;
      const u = unlocksAt(state.level);
      state.match.unlocked.push(...u);
      for (const l of levelUpListeners) l(state.level, u);
    }
    save();
    emit();
  },
  setCamo(id: string): void {
    const c = CAMOS.find((x) => x.id === id);
    if (!c || c.level > state.level) return;
    state.camo = id;
    save();
    emit();
  },
  /** Opt in/out of saving. Turning it off deletes the saved copy; this tab keeps its progress. */
  setRemember(on: boolean): void {
    state.remember = on;
    if (on) save();
    else {
      try {
        localStorage.removeItem(PROGRESS_KEY);
      } catch {
        /* ignore */
      }
    }
    emit();
  },
  camo(): Camo {
    return CAMOS.find((c) => c.id === state.camo) ?? CAMOS[0]!;
  },
};

export function useProgress(): ProgressState {
  return useSyncExternalStore(progress.subscribe, progress.get);
}
