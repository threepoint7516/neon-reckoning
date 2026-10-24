import { describe, expect, it } from "vitest";
import { getFrontierMap } from "../src/map/frontier";
import { Match, BR_REDEPLOY_WINDOW } from "../src/sim/match";
import type { MatchPlayer } from "../src/sim/match";
import { makeMatchConfig } from "../src/sim/config";
import { NavGrid } from "../src/ai/nav";
import { TICK_DT } from "../src/constants";
import { makeSlot } from "../src/sim/player";

const map = getFrontierMap();

/** A solo practice-style BR: one idle player plus 23 bots. */
function brMatch(seed: number): { m: Match; human: MatchPlayer } {
  const m = new Match(makeMatchConfig({ mode: "br", arena: "frontier", teamSize: 1, offline: true, seed, difficulty: "standard" }), map);
  const human = m.addPlayer({ id: 1, name: "Player", squad: 0, team: 0 });
  for (let i = 1; i < 24; i++) m.addBot(i, i);
  return { m, human };
}
const runFor = (m: Match, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT) && m.phase !== "ended"; i++) {
    m.step();
    m.clearEvents();
  }
};
const liveBots = (m: Match) => [...m.players.values()].filter((p) => p.isBot && p.st.alive);

describe("battle royale pacing", () => {
  it("bots stay armed and on the move, the field survives the opening, and pathfinding stays cheap", () => {
    const { m } = brMatch(4);
    let searches = 0;
    const path = NavGrid.prototype.path;
    NavGrid.prototype.path = function (...a: Parameters<typeof path>) {
      searches++;
      return path.apply(this, a);
    };
    try {
      runFor(m, 5 + 75); // landing + 75 s of play
      const before = new Map(liveBots(m).map((b) => [b.id, { x: b.st.x, z: b.st.z }]));
      runFor(m, 15);
      const bots = liveBots(m);
      const moved = bots.filter((b) => {
        const p = before.get(b.id);
        return p && Math.hypot(b.st.x - p.x, b.st.z - p.z) > 8;
      });
      const dry = bots.filter((b) => b.st.slots.every((s) => !s || s.mag + s.reserve === 0));
      // 95 s in: most of the field is still alive, moving around and armed.
      expect(bots.length).toBeGreaterThanOrEqual(10);
      expect(moved.length / bots.length).toBeGreaterThan(0.4);
      expect(dry.length).toBeLessThanOrEqual(2);
      // Route searches stay throttled (≤ ~2 per bot per second on average).
      expect(searches / (95 * 23)).toBeLessThan(2);
    } finally {
      NavGrid.prototype.path = path;
    }
  }, 60000);

  it("players eliminated early get one free redeploy; later eliminations are final", () => {
    const { m, human } = brMatch(7);
    runFor(m, 10);
    const killer = liveBots(m)[0]!;
    // Kill the player early: no placement, redeploy pending.
    (m as unknown as { kill: (v: MatchPlayer, k: MatchPlayer, c: string, h: boolean) => void }).kill(human, killer, "pulse9", false);
    expect(human.st.alive).toBe(false);
    expect(human.eliminated).toBe(false);
    expect(human.placement).toBe(0);
    runFor(m, 6);
    expect(human.st.alive).toBe(true);
    expect(human.st.gliding).toBe(true);
    expect(human.st.slots[1]?.reserve).toBeGreaterThan(0);
    // Second elimination (or any after the window) is final.
    runFor(m, BR_REDEPLOY_WINDOW);
    if (human.st.alive) (m as unknown as { kill: (v: MatchPlayer, k: MatchPlayer, c: string, h: boolean) => void }).kill(human, liveBots(m)[0]!, "pulse9", false);
    expect(human.eliminated).toBe(true);
    runFor(m, 8);
    expect(human.st.alive).toBe(false);
  }, 60000);

  it("supply drops land inside the next safe zone and spill a power weapon and armor", () => {
    const { m, human } = brMatch(11);
    const anyM = m as unknown as { cache: { x: number; y: number; z: number } | null; zone: { tx: number; tz: number; tr: number }; pickups: { kind: string; active: boolean; x: number; z: number }[]; claimCache: (p: MatchPlayer) => void };
    let drop: { x: number; z: number } | null = null;
    for (let s = 0; s < 120 && !drop; s++) {
      runFor(m, 1);
      if (anyM.cache) drop = { ...anyM.cache };
    }
    expect(drop).not.toBeNull();
    const z = anyM.zone;
    expect(Math.hypot(drop!.x - z.tx, drop!.z - z.tz)).toBeLessThan(Math.max(12, z.tr * 0.8) + 1);
    anyM.claimCache(human);
    const near = anyM.pickups.filter((p) => p.active && Math.hypot(p.x - drop!.x, p.z - drop!.z) < 2).map((p) => p.kind);
    expect(near).toEqual(expect.arrayContaining(["power", "armor", "plate", "ammo"]));
  }, 60000);

  it("bots only head for loot they can actually use", () => {
    const { m } = brMatch(3);
    runFor(m, 20);
    const bot = liveBots(m).find((b) => !b.st.gliding)!;
    const anyM = m as unknown as { pickups: { kind: string; active: boolean; x: number; y: number; z: number }[] };
    // Fully stocked bot with a primary: armor/plates/injectors on the floor next to it are useless.
    bot.st.slots[0] = makeSlot("pulse9");
    bot.st.armor = 100;
    bot.st.plates = 99;
    bot.st.injectors = 99;
    bot.st.health = 100;
    const obj = m.botObjective(bot) as { kind?: string } | null;
    expect(["armor", "plate", "injector", "health"]).not.toContain(obj?.kind);
    // An unarmed bot (empty guns) goes for ammo or a weapon.
    bot.st.slots = [null, { id: "phantom", mag: 0, reserve: 0 }, null];
    const obj2 = m.botObjective(bot) as { kind?: string } | null;
    if (obj2?.kind) expect(["ammo", "weapon", "power"]).toContain(obj2.kind);
    void anyM;
  }, 60000);
});
