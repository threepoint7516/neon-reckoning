// Core identifiers & configuration types shared across the codebase.

export type WeaponId =
  | "pulse9"
  | "viper"
  | "breachmaker"
  | "longshot"
  | "helix47"
  | "titan"
  | "phantom"
  | "arcstorm"
  | "railspike"
  | "nova";

export type GrenadeId = "frag" | "smoke" | "flash" | "emp";
export type TacticalId = "recon" | "shield" | "mine" | "remote";
export type ModeId = "tdm" | "ffa" | "dom" | "br" | "training";
export type DistrictId =
  | "neon_city"
  | "rusthaven"
  | "eclipse_harbor"
  | "sector_zero"
  | "chrome_valley"
  | "outlands"
  | "blacklight"
  | "skyrail";
export type ArenaId = DistrictId | "frontier";
export type Difficulty = "rookie" | "standard" | "veteran" | "elite";
export type ModifierId = "lowgrav" | "headhunter" | "overcharge" | "glass" | "powersurge" | "neonstorm";

/** Party size == team size. Solo plays free-for-all style rules. */
export type PartySize = 1 | 2 | 3 | 4;

export interface Loadout {
  primary: WeaponId;
  secondary: WeaponId;
  tactical: TacticalId;
}

export interface MatchConfig {
  mode: ModeId;
  arena: ArenaId;
  /** Players per team (1 for FFA). */
  teamSize: number;
  /** Number of teams (FFA = max players). */
  teamCount: number;
  maxPlayers: number;
  scoreLimit: number;
  /** Seconds. */
  timeLimit: number;
  respawnDelay: number;
  friendlyFire: boolean;
  botDifficulty: Difficulty;
  /** Total player slots to fill with clearly-labelled AI bots (0 = none). */
  botFill: number;
  modifiers: ModifierId[];
  seed: number;
  /** True when this match runs offline in the browser. */
  offline: boolean;
}

/** One fixed-step (SIM_DT) command from a client. */
export interface PlayerInput {
  /** Monotonic sequence number. */
  seq: number;
  /** Strafe axis −1..1 (right positive). */
  mx: number;
  /** Forward axis −1..1 (forward positive). */
  mz: number;
  yaw: number;
  pitch: number;
  /** Button bitmask (see Btn). */
  b: number;
  /** Server time (s) the client was viewing when this input was made — lag compensation. */
  vt: number;
}

export const DEFAULT_LOADOUT: Loadout = { primary: "pulse9", secondary: "phantom", tactical: "recon" };
