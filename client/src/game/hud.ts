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
  kind: "mate" | "enemy" | "ping" | "point" | "power" | "cache" | "pickup" | "me" | "spec" | "payload";
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
  /** Floating damage numbers near the crosshair. */
  dmgNums: { id: number; d: number; head: boolean; kill: boolean; t: number; dx: number }[];
  /** Night factor (0..1). */
  night: number;
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
  death: {
    killer: string; weapon: string; respawnAt: number; head: boolean; spectating: string | null; placement: number;
    /** BR second chance: gliding back in at respawnAt. */
    redeploy?: boolean;
    /** Killer's health left and distance, for the death card. */
    killerHp?: number;
    dist?: number;
  } | null;
  phase: "starting" | "live" | "ended";
  timeLeft: number;
  scoreLine: { label: string; value: number; color: string; mine: boolean }[];
  points: { label: string; owner: number; prog: number; contested: boolean; oc: boolean; color: string }[];
  zone: { next: number; shrinking: boolean; alive: number; outside: boolean; dps: number } | null;
  /** Payload progress (0..1), checkpoint fractions and cart state (0 idle, 1 moving, 2 contested, 3 rolling back). */
  payload: {
    progress: number; checkpoints: number[]; reached: number; state: number; escorts: number; attacking: boolean; overtime: boolean; color: string;
  } | null;
  cacheActive: boolean;
  storm: number;
  ping: number | null;
  fps: number;
  online: boolean;
  connectionWarning: string | null;
  killBanner: { name: string; t: number; head: boolean } | null;
  streak: number;
  /** "+100 Elimination"-style score pop-ups and the running combo they add up to. */
  scorePops: { id: number; text: string; pts: number; t: number }[];
  combo: { pts: number; n: number; t: number };
  /** Gun Game ladder position (null in other modes). */
  gunGame: { tier: number; total: number; next: string | null; leader: number } | null;
  /** Session level shown in the HUD. */
  level: { level: number; k: number };
  /** Level-up / challenge toasts under the level chip. */
  toasts: { id: number; title: string; text: string; kind: "levelup" | "challenge"; t: number }[];
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
    damageDirs: [], dmgNums: [], night: 1, soundCues: [], hurtFlash: 0, flash: 0, emp: 0, overdrive: 0, spawnProt: 0, feed: [], banners: [], medals: [], msgs: [],
    prompt: null, scanned: 0, death: null, phase: "starting", timeLeft: 0, scoreLine: [], points: [], zone: null, payload: null, cacheActive: false, storm: 0,
    ping: null, fps: 0, online: false, connectionWarning: null, killBanner: null, streak: 0, scorePops: [], combo: { pts: 0, n: 0, t: -10 }, gunGame: null,
    level: { level: 1, k: 0 }, toasts: [], training: null, endBanner: null, markers: [],
    meX: 0, meZ: 0, yaw: 0, version: 0,
  };
}

export const MEDAL_NAMES: Record<string, string> = {
  first_blood: "First Blood", double_kill: "Double Kill", triple_kill: "Triple Kill", rampage: "Rampage", headshot: "Headshot",
  longshot: "Long Shot", revenge: "Revenge", shutdown: "Bounty Collected", demolition: "Demolition", clutch: "Clutch", airborne: "Airborne",
  streak_3: "3 Streak · Radar Sweep", streak_5: "5 Streak · Overdrive", streak_8: "8 Streak · Full Restock", defender: "Defender", capture: "Point Captured",
  revive: "Revive", data_heist: "Data Heist", checkpoint: "Checkpoint Reached", delivery: "Payload Delivered",
  promoted: "Promoted", final_tier: "Final Weapon", slide_kill: "Slide Kill", nemesis: "Nemesis",
};

/** Streak rewards, in order (shown on the streak meter). */
export const STREAK_REWARDS: { at: number; name: string }[] = [
  { at: 3, name: "Radar Sweep" },
  { at: 5, name: "Overdrive" },
  { at: 8, name: "Full Restock" },
];
