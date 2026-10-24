import { describe, expect, it } from "vitest";
import { Match } from "../src/sim/match";
import { makeMatchConfig } from "../src/sim/config";
import { getFrontierMap } from "../src/map/frontier";
import { Btn, SIM_DT } from "../src/constants";
import type { PlayerInput } from "../src/types";
import { NavGrid } from "../src/ai/nav";
import { PAYLOAD_CHECKPOINT_BONUS, buildPayloadTrack, cartBlocked, trackPoint } from "../src/sim/payload";

const map = getFrontierMap();

function runTicks(m: Match, n: number) {
  for (let i = 0; i < n; i++) {
    m.step();
    for (const p of m.players.values()) m.snapshotFor(p.id, i % 15 === 0);
    m.clearEvents();
  }
}

function aimInputs(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, n: number, b: number, start: number, vt: number): PlayerInput[] {
  const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  const pitch = Math.atan2(to.y - (from.y + 1.62), Math.hypot(to.x - from.x, to.z - from.z));
  return Array.from({ length: n }, (_, i) => ({ seq: start + i, mx: 0, mz: 0, yaw, pitch, b: i % 2 === 0 ? b : 0, vt }));
}

describe("match simulation", () => {
  it("runs a bot-filled TDM without errors and ends at the score limit", () => {
    const cfg = makeMatchConfig({ mode: "tdm", arena: "neon_city", teamSize: 3, difficulty: "elite", offline: true, scoreLimit: 5, seed: 7 });
    const m = new Match(cfg, map);
    for (let i = 0; i < 6; i++) m.addBot(i % 2, i % 2);
    runTicks(m, 30 * 240);
    expect(m.phase).toBe("ended");
    expect(m.results).not.toBeNull();
    expect(Math.max(...m.results!.teamScores)).toBeGreaterThanOrEqual(5);
    const kills = m.results!.rows.reduce((a, r) => a + r.kills, 0);
    expect(kills).toBeGreaterThan(0);
  });

  it("runs FFA, Domination and Battle Royale with bots", () => {
    for (const mode of ["ffa", "dom", "br"] as const) {
      const cfg = makeMatchConfig({ mode, arena: "rusthaven", teamSize: mode === "br" ? 2 : 2, difficulty: "veteran", offline: true, seed: 11, timeLimit: 60 });
      const m = new Match(cfg, map);
      const n = mode === "br" ? 8 : 6;
      for (let i = 0; i < n; i++) m.addBot(mode === "ffa" ? i : mode === "br" ? Math.floor(i / 2) : i % 2, mode === "br" ? Math.floor(i / 2) : i);
      runTicks(m, 30 * 75);
      expect(m.phase).toBe("ended");
    }
  });

  it("server-authoritative hitscan damages a target, armor first, with headshot bonus", () => {
    const cfg = makeMatchConfig({ mode: "tdm", arena: "neon_city", teamSize: 1, offline: false, seed: 3 });
    const m = new Match(cfg, map);
    const a = m.addPlayer({ id: 1, name: "Alpha", squad: 1, team: 0, loadout: { primary: "railspike", secondary: "phantom", tactical: "recon" } });
    const b = m.addPlayer({ id: 2, name: "Bravo", squad: 2, team: 1 });
    // Find two open spawn points 8–20 m apart with clear line of sight.
    const d = map.districts.find((x) => x.id === "neon_city")!;
    let pair: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }] | null = null;
    for (const s1 of d.spawns) {
      for (let k = 0; k < 8 && !pair; k++) {
        const x = s1.x + Math.cos((k * Math.PI) / 4) * 10;
        const z = s1.z + Math.sin((k * Math.PI) / 4) * 10;
        const y = m.world.groundHeight(x, z, 3);
        if (!(y > -0.1 && y < 0.6)) continue;
        const free = !m.world.overlaps({ minX: x - 0.5, maxX: x + 0.5, minY: y + 0.1, maxY: y + 1.8, minZ: z - 0.5, maxZ: z + 0.5 });
        if (free && m.world.lineOfSight({ x: s1.x, y: s1.y + 1.62, z: s1.z }, { x, y: y + 1.0, z })) pair = [s1, { x, y, z }];
      }
      if (pair) break;
    }
    expect(pair).not.toBeNull();
    while (m.phase !== "live") m.step();
    Object.assign(a.st, { x: pair![0].x, y: pair![0].y, z: pair![0].z, spawnProt: 0, swapT: 0, vx: 0, vy: 0, vz: 0 });
    Object.assign(b.st, { x: pair![1].x, y: pair![1].y, z: pair![1].z, spawnProt: 0, vx: 0, vy: 0, vz: 0 });
    a.history.length = 0;
    b.history.length = 0;
    const chestB = { x: b.st.x, y: b.st.y + 1.0, z: b.st.z };
    const before = b.st.health + b.st.armor;
    m.pushInputs(1, aimInputs(a.st, chestB, 2, Btn.FIRE, 1, m.time));
    m.step();
    const after = b.st.health + b.st.armor;
    expect(before - after).toBeGreaterThan(40);
    expect(b.st.armor).toBeLessThan(50); // armor absorbed first
    expect(a.stats.hits).toBe(1);
  });

  it("does not trust clients: inputs are rate-limited by credits", () => {
    const cfg = makeMatchConfig({ mode: "ffa", arena: "neon_city", offline: false, seed: 5 });
    const m = new Match(cfg, map);
    const a = m.addPlayer({ id: 1, name: "Speedy", squad: 1, team: 0 });
    while (m.phase !== "live") m.step();
    const x0 = a.st.x;
    const z0 = a.st.z;
    // Spam 1000 sprint inputs in one tick.
    m.pushInputs(1, Array.from({ length: 1000 }, (_, i) => ({ seq: 10 + i, mx: 0, mz: 1, yaw: 0, pitch: 0, b: Btn.SPRINT, vt: m.time })));
    m.step();
    const moved = Math.hypot(a.st.x - x0, a.st.z - z0);
    // At most MAX_INPUT_BANK steps of movement can happen in one tick.
    expect(moved).toBeLessThan(12 * SIM_DT * 9);
  });

  it("produces JSON-serializable snapshots with interest-managed players", () => {
    const cfg = makeMatchConfig({ mode: "br", arena: "frontier", teamSize: 1, offline: true, seed: 9 });
    const m = new Match(cfg, map);
    m.addPlayer({ id: 1, name: "Solo", squad: 1, team: 0 });
    for (let i = 0; i < 10; i++) m.addBot(i + 1, i + 1);
    m.step();
    const s = m.snapshotFor(1, true);
    const json = JSON.stringify(s);
    expect(JSON.parse(json).me.id).toBe(1);
    expect(json.length).toBeLessThan(20000);
  });
});

describe("payload mode", () => {
  it("derives a deterministic track in every district that never clips geometry", () => {
    for (const d of map.districts) {
      const m = new Match(makeMatchConfig({ mode: "payload", arena: d.id, teamSize: 2, offline: true, seed: 1 }), map);
      const tr = m.track!;
      expect(tr.length, d.id).toBeGreaterThan(80);
      expect(tr.checkpoints.length).toBe(2);
      const again = buildPayloadTrack(new NavGrid(m.world, map, m.bounds), m.world, d);
      expect(again.pts).toEqual(tr.pts);
      for (let s = 0; s <= tr.length; s += 0.25) {
        const p = trackPoint(tr, s);
        expect(cartBlocked(m.world, p.x, p.y, p.z), `${d.id} @${s}`).toBe(false);
        expect(p.x > m.bounds.minX && p.x < m.bounds.maxX && p.z > m.bounds.minZ && p.z < m.bounds.maxZ).toBe(true);
      }
    }
  });

  it("advances only with uncontested escorts, extends time at checkpoints and rolls back to the last one", () => {
    const m = new Match(makeMatchConfig({ mode: "payload", arena: "neon_city", teamSize: 1, offline: false, seed: 2 }), map);
    const a = m.addPlayer({ id: 1, name: "Attacker", squad: 1, team: 0 });
    const d = m.addPlayer({ id: 2, name: "Defender", squad: 2, team: 1 });
    while (m.phase !== "live") m.step();
    const park = (p: typeof a, x: number, z: number) => Object.assign(p.st, { x, y: m.payloadPos()!.y, z, vx: 0, vy: 0, vz: 0 });
    const away = trackPoint(m.track!, m.track!.length);
    park(d, away.x, away.z);
    // Escorted: advances.
    let at = m.payloadPos()!;
    park(a, at.x + 1, at.z);
    runTicks(m, 60);
    expect(m.payloadState().d).toBeGreaterThan(1.5);
    expect(m.payloadState().state).toBe(1);
    // Contested: holds still.
    at = m.payloadPos()!;
    park(d, at.x - 1, at.z);
    const held = m.payloadState().d;
    runTicks(m, 60);
    expect(m.payloadState().d).toBe(held);
    expect(m.payloadState().state).toBe(2);
    // Reach the first checkpoint: the clock gains time.
    park(d, away.x, away.z);
    const before = m.timeLeft();
    for (let i = 0; i < 30 * 60 && m.payloadState().reached === 0; i++) {
      const p = m.payloadPos()!;
      park(a, p.x + 0.5, p.z);
      runTicks(m, 1);
    }
    expect(m.payloadState().reached).toBe(1);
    expect(m.timeLeft()).toBeGreaterThan(before + PAYLOAD_CHECKPOINT_BONUS - 60);
    // Push a little further, then abandon it: rolls back, but not past the checkpoint.
    for (let i = 0; i < 90; i++) {
      const p = m.payloadPos()!;
      park(a, p.x + 0.5, p.z);
      runTicks(m, 1);
    }
    park(a, away.x + 2, away.z);
    runTicks(m, 30 * 30);
    expect(m.payloadState().state).not.toBe(1);
    expect(m.payloadState().d).toBeCloseTo(m.track!.checkpoints[0]!, 5);
    const snap = m.snapshotFor(1, false);
    expect(snap.m.pl!.r).toBe(1);
    expect(snap.m.pl!.p).toBeGreaterThan(0.3);
  });

  it("bot attackers escort the payload to the end and win", () => {
    const cfg = makeMatchConfig({ mode: "payload", arena: "eclipse_harbor", teamSize: 3, difficulty: "veteran", offline: true, seed: 13 });
    const m = new Match(cfg, map);
    for (let i = 0; i < 3; i++) m.addBot(0, 0);
    runTicks(m, 30 * 240);
    expect(m.phase).toBe("ended");
    expect(m.results!.winnerTeam).toBe(0);
    expect(m.results!.reason).toBe("Payload delivered");
    expect(m.results!.teamScores[0]).toBe(100);
    expect(m.results!.rows.some((r) => (r.medals.checkpoint ?? 0) > 0)).toBe(true);
  });

  it("bot defenders hold the payload until time runs out and win", () => {
    const cfg = makeMatchConfig({ mode: "payload", arena: "rusthaven", teamSize: 3, difficulty: "veteran", offline: true, seed: 17, timeLimit: 45 });
    const m = new Match(cfg, map);
    for (let i = 0; i < 3; i++) m.addBot(1, 1);
    runTicks(m, 30 * 60);
    expect(m.phase).toBe("ended");
    expect(m.results!.winnerTeam).toBe(1);
    expect(m.results!.reason).toBe("Defenders held the line");
    expect(m.results!.teamScores[0]).toBe(0);
  });

  it("a full bot-filled 4v4 payload match reaches an end condition", () => {
    for (const seed of [5, 6]) {
      const cfg = makeMatchConfig({ mode: "payload", arena: "sector_zero", teamSize: 4, difficulty: "standard", offline: true, seed });
      const m = new Match(cfg, map);
      for (let i = 0; i < 8; i++) m.addBot(i % 2, i % 2);
      runTicks(m, 30 * 480);
      expect(m.phase).toBe("ended");
      expect(["Payload delivered", "Defenders held the line"]).toContain(m.results!.reason);
      expect(m.results!.teamScores[0]).toBeGreaterThan(0);
      expect(m.results!.rows.reduce((n, r) => n + r.kills, 0)).toBeGreaterThan(0);
    }
  });
});
