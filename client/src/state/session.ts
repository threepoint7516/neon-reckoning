// Session-only progress: daily-style challenges and "this session" stats.
// Everything here lives in memory and is gone when the tab closes.

import type { GameEvent, MatchResults } from "@neon/shared";
import { Rng } from "@neon/shared";
import { CHALLENGE_XP, FINISH_XP, WIN_XP, progress } from "./progress";

export interface Challenge {
  id: string;
  text: string;
  goal: number;
  progress: number;
}

interface Template {
  id: string;
  text: (n: number) => string;
  goals: number[];
}

const TEMPLATES: Template[] = [
  { id: "headshots", text: (n) => `Land ${n} headshot kills`, goals: [5, 8, 12] },
  { id: "kills", text: (n) => `Get ${n} eliminations`, goals: [15, 25, 40] },
  { id: "multi", text: (n) => `Earn ${n} double kills or better`, goals: [2, 3, 5] },
  { id: "streak", text: (n) => `Reach a ${n}-kill streak`, goals: [3, 5, 7] },
  { id: "grenade", text: (n) => `Get ${n} explosive kills`, goals: [2, 3, 5] },
  { id: "capture", text: (n) => `Capture ${n} Domination points`, goals: [2, 4, 6] },
  { id: "cache", text: (n) => `Crack ${n} Data Caches`, goals: [1, 2, 3] },
  { id: "wins", text: (n) => `Win ${n} match${n > 1 ? "es" : ""}`, goals: [1, 2, 3] },
  { id: "longshot", text: (n) => `Get ${n} long-range kills (45 m+)`, goals: [2, 4, 6] },
  { id: "revive", text: (n) => `Revive squadmates ${n} times`, goals: [1, 2, 4] },
];

/** Three challenges seeded from today's date (same for everyone, generated locally). */
function generate(): Challenge[] {
  const d = new Date();
  const rng = new Rng(d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate());
  const pool = [...TEMPLATES];
  const out: Challenge[] = [];
  for (let i = 0; i < 3; i++) {
    const t = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
    const goal = t.goals[i] ?? t.goals[0]!;
    out.push({ id: t.id, text: t.text(goal), goal, progress: 0 });
  }
  return out;
}

export const challenges: Challenge[] = generate();

export interface MatchSummary {
  kills: number;
  deaths: number;
  accuracy: number;
  headshotRate: number;
  damage: number;
  won: boolean;
}

export const sessionStats = {
  matches: 0,
  wins: 0,
  kills: 0,
  deaths: 0,
  history: [] as MatchSummary[],
};

const completeListeners = new Set<(c: Challenge) => void>();
/** Called when a challenge is completed (once per challenge). */
export function onChallengeComplete(l: (c: Challenge) => void): () => void {
  completeListeners.add(l);
  return () => completeListeners.delete(l);
}

function setProgress(c: Challenge, value: number): void {
  const was = c.progress;
  c.progress = Math.min(c.goal, value);
  if (was < c.goal && c.progress >= c.goal) {
    progress.add(CHALLENGE_XP, `Challenge: ${c.text}`);
    for (const l of completeListeners) l(c);
  }
}

function bump(id: string, n = 1): void {
  for (const c of challenges) if (c.id === id) setProgress(c, c.progress + n);
}

/** Streak challenges complete outright when a streak of at least their goal is reached. */
function reachStreak(n: number): void {
  for (const c of challenges) if (c.id === "streak" && c.goal <= n) setProgress(c, c.goal);
}

/** Feed match events for the local player into challenge progress. */
export function trackEvent(e: GameEvent, me: number): void {
  if (e.k === "kill" && e.kr === me && e.v !== me) {
    bump("kills");
    if (e.h) bump("headshots");
    if (["frag", "nova", "mine", "remote", "barrel"].includes(e.w)) bump("grenade");
  } else if (e.k === "medal" && e.to === me) {
    if (e.m === "double_kill") bump("multi");
    if (e.m === "streak_3") reachStreak(3);
    if (e.m === "streak_5") reachStreak(5);
    if (e.m === "streak_8") reachStreak(99);
    if (e.m === "capture") bump("capture");
    if (e.m === "data_heist") bump("cache");
    if (e.m === "longshot") bump("longshot");
    if (e.m === "revive") bump("revive");
  }
}

export function recordResults(r: MatchResults, me: number): { summary: MatchSummary; previous: MatchSummary | null } {
  const row = r.rows.find((x) => x.id === me);
  const won = !!row && r.winnerTeam >= 0 && row.team === r.winnerTeam;
  const summary: MatchSummary = {
    kills: row?.kills ?? 0,
    deaths: row?.deaths ?? 0,
    accuracy: row && row.shots > 0 ? row.hits / row.shots : 0,
    headshotRate: row && row.kills > 0 ? row.headshots / Math.max(1, row.hits) : 0,
    damage: row?.damage ?? 0,
    won,
  };
  const previous = sessionStats.history[sessionStats.history.length - 1] ?? null;
  sessionStats.history.push(summary);
  sessionStats.matches++;
  sessionStats.kills += summary.kills;
  sessionStats.deaths += summary.deaths;
  if (won) {
    sessionStats.wins++;
    progress.add(WIN_XP, "Victory");
    bump("wins");
  }
  progress.add(FINISH_XP, "Match complete");
  return { summary, previous };
}
