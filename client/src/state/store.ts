import { useSyncExternalStore } from "react";
import type { Loadout, MatchResults, MatchStartInfo, PartyState } from "@neon/shared";
import { DEFAULT_LOADOUT, randomCallsign } from "@neon/shared";
import type { Connection } from "../net/connection";

export type Screen =
  | "boot"
  | "menu"
  | "play"
  | "party"
  | "practice"
  | "loading"
  | "game"
  | "results"
  | "settings"
  | "arsenal"
  | "privacy"
  | "credits";

export type NetStatus = "idle" | "connecting" | "online" | "error" | "unconfigured";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "ok";
}

export interface ActiveMatch {
  info: MatchStartInfo;
  conn: Connection;
  offline: boolean;
  /** Offline config replay for "Rematch". */
  practice?: PracticeSetup;
}

export interface PracticeSetup {
  mode: "tdm" | "ffa" | "dom" | "br" | "training";
  arena: string;
  teamSize: number;
  bots: number;
  difficulty: "rookie" | "standard" | "veteran" | "elite";
  modifiers: string[];
  timeLimit: number;
}

export interface AppState {
  screen: Screen;
  prevScreen: Screen;
  /** Session-only identity: lives in memory, never persisted. */
  name: string;
  myId: number | null;
  net: { status: NetStatus; online: number | null; ping: number | null; error: string | null };
  party: PartyState | null;
  match: ActiveMatch | null;
  results: MatchResults | null;
  resultsMeta: { you: number; offline: boolean; teamNames: string[] } | null;
  loadout: Loadout;
  toasts: Toast[];
  pendingInvite: string | null;
}

let state: AppState = {
  screen: "boot",
  prevScreen: "boot",
  name: randomCallsign(),
  myId: null,
  net: { status: "idle", online: null, ping: null, error: null },
  party: null,
  match: null,
  results: null,
  resultsMeta: null,
  loadout: { ...DEFAULT_LOADOUT },
  toasts: [],
  pendingInvite: null,
};

const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const p = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...p };
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

export function go(screen: Screen): void {
  store.set((s) => ({ screen, prevScreen: s.screen }));
}

let toastId = 1;
export function toast(text: string, kind: Toast["kind"] = "info"): void {
  const id = toastId++;
  store.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 6000 : 3500);
}
