import { RESPAWN_DELAY } from "../constants";
import type { ArenaId, Difficulty, MatchConfig, ModeId, ModifierId } from "../types";

export const MODE_INFO: Record<ModeId, { name: string; short: string; blurb: string; teams: boolean; respawn: boolean }> = {
  tdm: { name: "Team Deathmatch", short: "TDM", blurb: "Two squads. Every elimination scores. First to the limit wins.", teams: true, respawn: true },
  ffa: { name: "Free-for-All", short: "FFA", blurb: "Everyone for themselves. First to the elimination limit wins.", teams: false, respawn: true },
  dom: { name: "Domination", short: "DOM", blurb: "Hold A, B and C to earn points. The overclocked point scores double.", teams: true, respawn: true },
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

/** Builds a complete match config with sensible per-mode defaults. */
export function makeMatchConfig(o: ConfigOpts): MatchConfig {
  const mode = o.mode;
  const teamSize = Math.max(1, Math.min(6, o.teamSize ?? (mode === "ffa" || mode === "training" ? 1 : 4)));
  let teamCount: number;
  let maxPlayers: number;
  let scoreLimit: number;
  let timeLimit: number;
  switch (mode) {
    case "tdm":
      teamCount = 2;
      maxPlayers = teamSize * 2;
      scoreLimit = [0, 15, 25, 35, 45, 55, 65][teamSize]!;
      timeLimit = 480;
      break;
    case "dom":
      teamCount = 2;
      maxPlayers = teamSize * 2;
      scoreLimit = 150;
      timeLimit = 540;
      break;
    case "ffa":
      teamCount = 12;
      maxPlayers = 12;
      scoreLimit = 20;
      timeLimit = 480;
      break;
    case "br":
      teamCount = Math.max(2, Math.floor(16 / teamSize));
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
    teamSize: mode === "ffa" || mode === "training" ? 1 : teamSize,
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
