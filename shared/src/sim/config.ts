import { RESPAWN_DELAY } from "../constants";
import type { ArenaId, Difficulty, MatchConfig, ModeId, ModifierId, WeaponId } from "../types";

export const MODE_INFO: Record<ModeId, { name: string; short: string; blurb: string; teams: boolean; respawn: boolean }> = {
  tdm: { name: "Team Deathmatch", short: "TDM", blurb: "Two squads. Every elimination scores. First to the limit wins.", teams: true, respawn: true },
  ffa: { name: "Free-for-All", short: "FFA", blurb: "Everyone for themselves. First to the elimination limit wins.", teams: false, respawn: true },
  gungame: { name: "Gun Game", short: "GUN", blurb: "Every elimination swaps you to the next weapon. First to score a kill with the final pistol wins.", teams: false, respawn: true },
  dom: { name: "Domination", short: "DOM", blurb: "Hold A, B and C to earn points. The overclocked point scores double.", teams: true, respawn: true },
  payload: { name: "Payload", short: "PAY", blurb: "Attackers escort the data core to the far side of the district. Checkpoints add time; defenders win if the clock runs out.", teams: true, respawn: true },
  br: { name: "Battle Royale", short: "BR", blurb: "Glide in, loot, outlast the shrinking storm. No respawns — squads can revive.", teams: true, respawn: false },
  training: { name: "Training Range", short: "TRAIN", blurb: "Learn the controls against passive target bots.", teams: false, respawn: true },
};

export const MODIFIER_INFO: Record<ModifierId, { name: string; blurb: string }> = {
  lowgrav: { name: "Low Gravity", blurb: "Gravity reduced to 55%. Jumps go further." },
  headhunter: { name: "Headhunter", blurb: "Headshots deal +40% damage, body shots −10%." },
  overcharge: { name: "Overcharge", blurb: "Tactical abilities recharge twice as fast." },
  glass: { name: "Glass Cannon", blurb: "No armor anywhere. Every shot matters." },
  powersurge: { name: "Power Surge", blurb: "Data Caches appear twice as often." },
  neonstorm: { name: "Neon Storm", blurb: "Periodic EMP storms scramble HUDs and abilities for everyone." },
};
/** Gun Game weapon ladder: big and forgiving first, ending on the pistol. */
export const GUN_LADDER: WeaponId[] = ["arcstorm", "titan", "pulse9", "helix47", "viper", "breachmaker", "railspike", "longshot", "nova", "phantom"];

/** Modes where everyone is on their own team. */
export const isSoloMode = (mode: ModeId) => mode === "ffa" || mode === "gungame" || mode === "training";

/** Score awarded with each medal (shared so the client can show "+N" pop-ups). */
export const MEDAL_SCORES: Record<string, number> = {
  first_blood: 50, double_kill: 50, triple_kill: 100, rampage: 150, headshot: 0, longshot: 50, revenge: 50, shutdown: 150,
  demolition: 25, clutch: 50, airborne: 25, streak_3: 50, streak_5: 100, streak_8: 150, defender: 50, revive: 100,
  data_heist: 150, capture: 150, checkpoint: 150, delivery: 250, promoted: 0, final_tier: 0, slide_kill: 25, nemesis: 100,
};
/** Base score for an elimination, a headshot bonus and an assist. */
export const KILL_SCORE = 100;
export const HEADSHOT_BONUS = 25;
export const ASSIST_SCORE = 50;

export const MODIFIER_IDS = Object.keys(MODIFIER_INFO) as ModifierId[];

export interface ConfigOpts {
  mode: ModeId;
  arena: ArenaId;
  teamSize?: number;
  difficulty?: Difficulty;
  botFill?: number;
  modifiers?: ModifierId[];
  scoreLimit?: number;
  timeLimit?: number;
  offline: boolean;
  seed?: number;
}

/**
 * Players per team in online TDM / Domination / Payload. Squads (1–4) are
 * placed together on a team and the rest of the team is filled with other
 * queued players or labelled AI, so every match is a lively 6v6.
 */
export const ONLINE_TEAM_SIZE = 6;
/** Largest team size in arena team modes (Practice allows up to 8v8). */
export const MAX_TEAM_SIZE = 8;
/** Total players in a Battle Royale (squads of 1–4 fill it). */
export const BR_PLAYERS = 24;

/** Builds a complete match config with sensible per-mode defaults. */
export function makeMatchConfig(o: ConfigOpts): MatchConfig {
  const mode = o.mode;
  const teamSize = Math.max(1, Math.min(mode === "br" ? 4 : MAX_TEAM_SIZE, o.teamSize ?? (isSoloMode(mode) ? 1 : 4)));
  let teamCount: number;
  let maxPlayers: number;
  let scoreLimit: number;
  let timeLimit: number;
  switch (mode) {
    case "tdm":
      teamCount = 2;
      maxPlayers = teamSize * 2;
      scoreLimit = [0, 15, 25, 35, 45, 55, 65, 75, 85][teamSize]!;
      timeLimit = 480;
      break;
    case "dom":
      teamCount = 2;
      maxPlayers = teamSize * 2;
      scoreLimit = 150;
      timeLimit = 540;
      break;
    case "payload":
      // Team 0 attacks, team 1 defends. The time limit is the attackers'
      // starting clock; each checkpoint extends it.
      teamCount = 2;
      maxPlayers = teamSize * 2;
      scoreLimit = 100;
      timeLimit = 180;
      break;
    case "ffa":
      teamCount = 12;
      maxPlayers = 12;
      scoreLimit = 20;
      timeLimit = 480;
      break;
    case "gungame":
      teamCount = 12;
      maxPlayers = 12;
      scoreLimit = GUN_LADDER.length;
      timeLimit = 480;
      break;
    case "br":
      teamCount = Math.max(2, Math.floor(BR_PLAYERS / teamSize));
      maxPlayers = teamCount * teamSize;
      scoreLimit = 0;
      timeLimit = 900;
      break;
    case "training":
      teamCount = 12;
      maxPlayers = 8;
      scoreLimit = 0;
      timeLimit = 3600;
      break;
  }
  return {
    mode,
    arena: mode === "br" ? "frontier" : o.arena === "frontier" ? "neon_city" : o.arena,
    teamSize: isSoloMode(mode) ? 1 : teamSize,
    teamCount,
    maxPlayers,
    scoreLimit: o.scoreLimit ?? scoreLimit,
    timeLimit: o.timeLimit ?? timeLimit,
    respawnDelay: RESPAWN_DELAY,
    friendlyFire: false,
    botDifficulty: o.difficulty ?? "standard",
    botFill: Math.max(0, Math.min(maxPlayers, o.botFill ?? 0)),
    modifiers: o.modifiers ?? [],
    seed: o.seed ?? Math.floor(Math.random() * 1e9),
    offline: o.offline,
  };
}
