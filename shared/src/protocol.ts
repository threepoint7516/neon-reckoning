// Wire protocol between browser and game server (JSON over WebSocket).
// Every client→server message is validated by `parseClientMessage` before use.

import { BTN_MASK, MAX_MESSAGE_BYTES, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./constants";
import type { PlayerState } from "./sim/player";
import type { Difficulty, Loadout, MatchConfig, ModeId, PartySize, PlayerInput } from "./types";
import { PRIMARY_IDS, SECONDARY_IDS } from "./balance/weapons";
import { TACTICAL_IDS } from "./balance/equipment";

// ---------------------------------------------------------------------------
// Snapshot payloads
// ---------------------------------------------------------------------------

export const PF = {
  ALIVE: 1,
  CROUCH: 2,
  DOWNED: 4,
  ADS: 8,
  SPRINT: 16,
  REVEALED: 32,
  PROTECTED: 64,
  GROUND: 128,
  RELOAD: 256,
  GLIDE: 512,
  SLIDE: 1024,
  BOT: 2048,
} as const;

export interface PlayerSnap {
  i: number;
  x: number;
  y: number;
  z: number;
  yw: number;
  pt: number;
  f: number;
  w: number;
  /** Health/armor are only sent for teammates. */
  h?: number;
  a?: number;
}

export interface ProjSnap {
  i: number;
  k: string;
  x: number;
  y: number;
  z: number;
  o: number;
}
export interface DeploySnap {
  i: number;
  k: "shield" | "mine" | "remote";
  x: number;
  y: number;
  z: number;
  /** Shield axis (0 = spans X, 1 = spans Z). */
  ax: number;
  tm: number;
  armed: boolean;
}
export interface SmokeSnap {
  i: number;
  x: number;
  y: number;
  z: number;
  r: number;
  t: number;
}
export interface PickupSnap {
  i: number;
  k: string;
  w?: string;
  x: number;
  y: number;
  z: number;
}
export interface CPSnap {
  /** Owner team (-1 neutral). */
  o: number;
  /** Capture progress −1..1 (negative toward team 0, positive toward team 1). */
  p: number;
  /** Contested. */
  c: boolean;
  /** Overclocked (double points). */
  oc: boolean;
}
export interface ZoneSnap {
  x: number;
  z: number;
  r: number;
  tx: number;
  tz: number;
  tr: number;
  /** Seconds until the next change (shrink start or end). */
  n: number;
  s: boolean;
  dps: number;
}
export interface MatchStateSnap {
  ph: "starting" | "live" | "ended";
  tl: number;
  sc: number[];
  cp?: CPSnap[];
  zn?: ZoneSnap;
  /** Data cache objective position, if active. */
  dc?: [number, number, number] | null;
  /** Teams/players still alive (battle royale). */
  al?: number;
  storm?: number;
}

export interface ScoreRow {
  i: number;
  k: number;
  d: number;
  a: number;
  s: number;
  st: number;
  /** Placement (BR) or 0. */
  pl: number;
  /** Connected (false = reconnecting). */
  c: boolean;
}

export type GameEvent =
  | { k: "shot"; p: number; w: string; o: number[]; e: number[][] }
  | { k: "hit"; to: number; v: number; d: number; h: boolean; x: boolean; sh?: boolean }
  | { k: "dmg"; to: number; s: number[]; d: number }
  | { k: "kill"; kr: number; v: number; w: string; h: boolean; as: number[] }
  | { k: "down"; v: number; by: number }
  | { k: "revive"; v: number; by: number }
  | { k: "boom"; x: number; y: number; z: number; r: number; t: string }
  | { k: "flashed"; to: number; s: number }
  | { k: "medal"; to: number; m: string }
  | { k: "ann"; t: string; c: string; tm?: number }
  | { k: "msg"; to: number; t: string }
  | { k: "scan"; tm: number; x: number; z: number }
  | { k: "scanned"; to: number }
  | { k: "spawn"; p: number }
  | { k: "throw"; p: number }
  | { k: "arc"; p: number; pts: number[][] };

export interface Snapshot {
  t: number;
  tick: number;
  ack: number;
  me: PlayerState | null;
  ps: PlayerSnap[];
  pr: ProjSnap[];
  dp: DeploySnap[];
  sm: SmokeSnap[];
  pk: PickupSnap[];
  br: number[];
  m: MatchStateSnap;
  ev: GameEvent[];
  sb?: ScoreRow[];
  /** Spectate target when dead in BR. */
  spec?: number;
}

export interface RosterEntry {
  i: number;
  n: string;
  t: number;
  bot: boolean;
  /** Party/squad grouping key (same squad). */
  sq: number;
}

export interface ResultRow {
  id: number;
  name: string;
  bot: boolean;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  score: number;
  shots: number;
  hits: number;
  headshots: number;
  bestStreak: number;
  placement: number;
  medals: Record<string, number>;
  favWeapon: string | null;
}

export interface MatchResults {
  mode: ModeId;
  arena: string;
  duration: number;
  winnerTeam: number;
  teamScores: number[];
  rows: ResultRow[];
  mvp: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Lobby / party
// ---------------------------------------------------------------------------

export type QueueMode = "tdm" | "ffa" | "dom" | "br";

export interface PartyMember {
  id: number;
  name: string;
  ready: boolean;
  leader: boolean;
}

export interface PartyState {
  code: string;
  members: PartyMember[];
  mode: QueueMode;
  size: PartySize;
  fill: boolean;
  /** Allow clearly-labelled AI bots to fill empty slots. */
  bots: boolean;
  status: "idle" | "queued" | "in_match";
  queue?: { waiting: number; needed: number; since: number; aiFillIn: number | null };
}

export interface MatchStartInfo {
  matchId: string;
  config: MatchConfig;
  you: number;
  roster: RosterEntry[];
  reconnectToken: string;
  barrels: { i: number; x: number; y: number; z: number }[];
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: "hello"; v: number; name: string }
  | { t: "rename"; name: string }
  | { t: "party_create" }
  | { t: "party_join"; code: string }
  | { t: "party_leave" }
  | { t: "party_ready"; ready: boolean }
  | { t: "party_settings"; mode: QueueMode; size: PartySize; fill: boolean; bots: boolean }
  | { t: "party_kick"; id: number }
  | { t: "queue" }
  | { t: "cancel_queue" }
  | { t: "start_private"; difficulty: Difficulty }
  | { t: "loadout"; loadout: Loadout }
  | { t: "input"; i: PlayerInput[] }
  | { t: "leave_match" }
  | { t: "reconnect"; token: string }
  | { t: "ping"; c: number };

export type ServerMessage =
  | { t: "welcome"; id: number; name: string; online: number; v: number }
  | { t: "named"; name: string }
  | { t: "party"; party: PartyState | null }
  | { t: "error"; code: string; message: string }
  | { t: "match_start"; info: MatchStartInfo }
  | { t: "roster"; roster: RosterEntry[] }
  | { t: "snap"; s: Snapshot }
  | { t: "match_end"; results: MatchResults }
  | { t: "pong"; c: number; s: number }
  | { t: "online"; n: number };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

export const QUEUE_MODES: QueueMode[] = ["tdm", "ffa", "dom", "br"];
const DIFFS: Difficulty[] = ["rookie", "standard", "veteran", "elite"];

export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== "string" || code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export function validateInput(o: unknown): PlayerInput | null {
  if (!o || typeof o !== "object") return null;
  const i = o as Record<string, unknown>;
  if (!isInt(i.seq) || (i.seq as number) < 0) return null;
  if (!isNum(i.mx) || !isNum(i.mz) || !isNum(i.yaw) || !isNum(i.pitch) || !isInt(i.b) || !isNum(i.vt)) return null;
  if (Math.abs(i.mx as number) > 1.0001 || Math.abs(i.mz as number) > 1.0001) return null;
  if (Math.abs(i.yaw as number) > 1e6 || Math.abs(i.pitch as number) > 1.6) return null;
  if (((i.b as number) & ~BTN_MASK) !== 0) return null;
  return {
    seq: i.seq as number,
    mx: i.mx as number,
    mz: i.mz as number,
    yaw: (i.yaw as number) % (Math.PI * 2),
    pitch: i.pitch as number,
    b: i.b as number,
    vt: i.vt as number,
  };
}

export function validateLoadout(o: unknown): Loadout | null {
  if (!o || typeof o !== "object") return null;
  const l = o as Record<string, unknown>;
  if (!PRIMARY_IDS.includes(l.primary as never)) return null;
  if (!SECONDARY_IDS.includes(l.secondary as never)) return null;
  if (!TACTICAL_IDS.includes(l.tactical as never)) return null;
  return { primary: l.primary as Loadout["primary"], secondary: l.secondary as Loadout["secondary"], tactical: l.tactical as Loadout["tactical"] };
}

/**
 * Parses and validates a raw client frame. Returns null for anything
 * malformed, oversized, or of an unknown type — the caller counts strikes.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case "hello":
      return isInt(o.v) && isStr(o.name, 64) ? { t: "hello", v: o.v as number, name: o.name as string } : null;
    case "rename":
      return isStr(o.name, 64) ? { t: "rename", name: o.name as string } : null;
    case "party_create":
    case "party_leave":
    case "queue":
    case "cancel_queue":
    case "leave_match":
      return { t: o.t } as ClientMessage;
    case "party_join":
      return isStr(o.code, 16) ? { t: "party_join", code: (o.code as string).toUpperCase().trim() } : null;
    case "party_ready":
      return isBool(o.ready) ? { t: "party_ready", ready: o.ready } : null;
    case "party_settings": {
      if (!QUEUE_MODES.includes(o.mode as QueueMode)) return null;
      if (![1, 2, 3, 4].includes(o.size as number)) return null;
      if (!isBool(o.fill) || !isBool(o.bots)) return null;
      return { t: "party_settings", mode: o.mode as QueueMode, size: o.size as PartySize, fill: o.fill, bots: o.bots };
    }
    case "party_kick":
      return isInt(o.id) ? { t: "party_kick", id: o.id as number } : null;
    case "start_private":
      return DIFFS.includes(o.difficulty as Difficulty) ? { t: "start_private", difficulty: o.difficulty as Difficulty } : null;
    case "loadout": {
      const l = validateLoadout(o.loadout);
      return l ? { t: "loadout", loadout: l } : null;
    }
    case "input": {
      if (!Array.isArray(o.i) || o.i.length === 0 || o.i.length > 30) return null;
      const out: PlayerInput[] = [];
      for (const x of o.i) {
        const v = validateInput(x);
        if (!v) return null;
        out.push(v);
      }
      return { t: "input", i: out };
    }
    case "reconnect":
      return isStr(o.token, 64) ? { t: "reconnect", token: o.token as string } : null;
    case "ping":
      return isNum(o.c) ? { t: "ping", c: o.c as number } : null;
    default:
      return null;
  }
}
