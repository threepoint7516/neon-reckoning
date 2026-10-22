// Mutable HUD model written by the Game each frame and read by React.

export interface FeedEntry {
  id: number;
  killer: string;
  victim: string;
  weapon: string;
  head: boolean;
  kColor: string;
  vColor: string;
  me: boolean;
  t: number;
  downed?: boolean;
}

export interface Banner {
  id: number;
  text: string;
  kind: string;
  t: number;
}

export interface Marker {
  x: number;
  z: number;
  kind: "mate" | "enemy" | "ping" | "point" | "power" | "cache" | "pickup" | "me" | "spec";
  color: string;
  label?: string;
  yaw?: number;
}

export interface HudData {
  alive: boolean;
  downed: boolean;
  health: number;
  armor: number;
  maxArmor: number;
  weaponName: string;
  weaponColor: string;
  mag: number;
  magMax: number;
  reserve: number;
  reloading: number;
  slots: { name: string; key: string; active: boolean; color: string; ammo: string }[];
  grenade: { name: string; count: number; color: string; all: { id: string; n: number }[] };
  tactical: { name: string; cd: number; max: number; color: string };
  injectors: number;
  plates: number;
  channel: { label: string; k: number } | null;
  spread: number;
  ads: number;
  sprint: boolean;
  hit: { t: number; head: boolean; kill: boolean };
  damageDirs: { a: number; t: number; amt: number }[];
  soundCues: { a: number; t: number; kind: "shot" | "step" }[];
  hurtFlash: number;
  flash: number;
  emp: number;
  overdrive: number;
  spawnProt: number;
  feed: FeedEntry[];
  banners: Banner[];
  medals: { id: number; m: string; t: number }[];
  msgs: { id: number; text: string; t: number }[];
  prompt: string | null;
  scanned: number;
  death: { killer: string; weapon: string; respawnAt: number; head: boolean; spectating: string | null; placement: number } | null;
  phase: "starting" | "live" | "ended";
  timeLeft: number;
  scoreLine: { label: string; value: number; color: string; mine: boolean }[];
  points: { label: string; owner: number; prog: number; contested: boolean; oc: boolean; color: string }[];
  zone: { next: number; shrinking: boolean; alive: number; outside: boolean; dps: number } | null;
  cacheActive: boolean;
  storm: number;
  ping: number | null;
  fps: number;
  online: boolean;
  connectionWarning: string | null;
  killBanner: { name: string; t: number; head: boolean } | null;
  streak: number;
  training: { label: string; done: boolean }[] | null;
  endBanner: { text: string; sub: string; win: boolean } | null;
  markers: Marker[];
  meX: number;
  meZ: number;
  yaw: number;
  version: number;
}

export function emptyHud(): HudData {
  return {
    alive: false, downed: false, health: 100, armor: 0, maxArmor: 100, weaponName: "", weaponColor: "#fff", mag: 0, magMax: 0, reserve: 0,
    reloading: 0, slots: [], grenade: { name: "", count: 0, color: "#fff", all: [] }, tactical: { name: "", cd: 0, max: 1, color: "#fff" },
    injectors: 0, plates: 0, channel: null, spread: 0, ads: 0, sprint: false, hit: { t: -10, head: false, kill: false },
    damageDirs: [], soundCues: [], hurtFlash: 0, flash: 0, emp: 0, overdrive: 0, spawnProt: 0, feed: [], banners: [], medals: [], msgs: [],
    prompt: null, scanned: 0, death: null, phase: "starting", timeLeft: 0, scoreLine: [], points: [], zone: null, cacheActive: false, storm: 0,
    ping: null, fps: 0, online: false, connectionWarning: null, killBanner: null, streak: 0, training: null, endBanner: null, markers: [],
    meX: 0, meZ: 0, yaw: 0, version: 0,
  };
}

export const MEDAL_NAMES: Record<string, string> = {
  first_blood: "First Blood", double_kill: "Double Kill", triple_kill: "Triple Kill", rampage: "Rampage", headshot: "Headshot",
  longshot: "Long Shot", revenge: "Revenge", shutdown: "Bounty Collected", demolition: "Demolition", clutch: "Clutch", airborne: "Airborne",
  streak_3: "3 Streak · Radar Sweep", streak_5: "5 Streak · Overdrive", streak_8: "Unstoppable", defender: "Defender", capture: "Point Captured",
  revive: "Revive", data_heist: "Data Heist",
};
