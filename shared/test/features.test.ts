import { describe, expect, it } from "vitest";
import { getFrontierMap } from "../src/map/frontier";
import { CollisionWorld } from "../src/map/collision";
import { createPlayerState, resetForSpawn, ARENA_KIT, stepPlayer } from "../src/sim/player";
import type { StepEnv } from "../src/sim/player";
import { Match } from "../src/sim/match";
import { BR_PLAYERS, GUN_LADDER, MEDAL_SCORES, ONLINE_TEAM_SIZE, makeMatchConfig } from "../src/sim/config";
import { SIM_DT, Btn } from "../src/constants";
import { DEFAULT_LOADOUT } from "../src/types";
import { recordingHooks, inp } from "./helpers";

const map = getFrontierMap();
const world = new CollisionWorld(map);
const env: StepEnv = { world, bounds: { minX: map.minX, minZ: map.minZ, maxX: map.maxX, maxZ: map.maxZ }, gravity: 1, tacticalRate: 1, maxArmor: 100 };

describe("jump pads on the real map", () => {
  const rooftop = map.jumpPads.filter((p) => Math.hypot(p.vx, p.vz) > 1.6);
  it("has rooftop launchers and bounce pads", () => {
    expect(rooftop.length).toBeGreaterThanOrEqual(16);
    expect(map.jumpPads.length - rooftop.length).toBeGreaterThanOrEqual(10);
  });

  it("every rooftop pad lands its rider on top of a building without fall damage", () => {
    const failures: string[] = [];
    for (const pad of rooftop) {
      const { hooks, fx } = recordingHooks();
      const p = createPlayerState(1, 0, DEFAULT_LOADOUT);
      const x = (pad.minX + pad.maxX) / 2;
      const z = (pad.minZ + pad.maxZ) / 2;
      resetForSpawn(p, DEFAULT_LOADOUT, ARENA_KIT, { x, y: pad.minY + 0.25, z }, 0);
      let peak = 0;
      for (let i = 0; i < 300; i++) {
        stepPlayer(p, inp(), env, hooks, SIM_DT);
        peak = Math.max(peak, p.y);
        if (i > 30 && p.onGround) break;
      }
      if (!fx.includes("pad") || p.y < 3 || fx.includes("fall")) failures.push(`pad at ${x.toFixed(0)},${z.toFixed(0)} → y=${p.y.toFixed(1)} peak=${peak.toFixed(1)} ${fx.join(",")}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("loot crates", () => {
  it("shooting a crate breaks it and drops a pickup", () => {
    const cfg = makeMatchConfig({ mode: "ffa", arena: "blacklight", offline: true, seed: 4 });
    const m = new Match(cfg, map);
    const a = m.addPlayer({ id: 1, name: "Breaker", squad: 1, team: 0 });
    while (m.phase !== "live") m.step();
    const crates = m.crateList();
    expect(crates.length).toBeGreaterThan(5);
    // Stand 4 m from a crate with clear sight and shoot it.
    let target = null as null | { x: number; y: number; z: number; i: number };
    let from = null as null | { x: number; y: number; z: number };
    for (const c of crates) {
      for (let k = 0; k < 8 && !target; k++) {
        const x = c.x + Math.cos(k * 0.785) * 4;
        const z = c.z + Math.sin(k * 0.785) * 4;
        const y = world.groundHeight(x, z, c.y + 1.5);
        if (!(Math.abs(y - c.y) < 0.3)) continue;
        if (world.overlaps({ minX: x - 0.5, maxX: x + 0.5, minY: y + 0.1, maxY: y + 1.8, minZ: z - 0.5, maxZ: z + 0.5 })) continue;
        if (!world.lineOfSight({ x, y: y + 1.62, z }, { x: c.x, y: c.y + 0.45, z: c.z })) continue;
        target = c;
        from = { x, y, z };
      }
      if (target) break;
    }
    expect(target).not.toBeNull();
    Object.assign(a.st, { x: from!.x, y: from!.y, z: from!.z, vx: 0, vy: 0, vz: 0, swapT: 0 });
    const yaw = Math.atan2(-(target!.x - from!.x), -(target!.z - from!.z));
    const pitch = Math.atan2(target!.y + 0.45 - (from!.y + 1.62), Math.hypot(target!.x - from!.x, target!.z - from!.z));
    let seq = 1000;
    let broken = false;
    for (let k = 0; k < 40 && !broken; k++) {
      m.pushInputs(1, [{ seq: seq++, mx: 0, mz: 0, yaw, pitch, b: Btn.FIRE, vt: m.time }, { seq: seq++, mx: 0, mz: 0, yaw, pitch, b: Btn.FIRE, vt: m.time }]);
      m.step();
      broken = m.snapshotFor(1, false).cr.includes(target!.i);
      m.clearEvents();
    }
    expect(broken).toBe(true);
    const pk = m.snapshotFor(1, false).pk;
    expect(pk.some((p) => Math.hypot(p.x - target!.x, p.z - target!.z) < 0.5)).toBe(true);
  });
});

describe("lively match sizes", () => {
  it("online team modes are 6v6, FFA 12 and BR 24 regardless of squad size", () => {
    for (const mode of ["tdm", "dom", "payload"] as const) {
      const c = makeMatchConfig({ mode, arena: "neon_city", teamSize: ONLINE_TEAM_SIZE, offline: false });
      expect(c.maxPlayers).toBe(12);
    }
    expect(makeMatchConfig({ mode: "ffa", arena: "neon_city", offline: false }).maxPlayers).toBe(12);
    for (const squad of [1, 2, 3, 4]) expect(makeMatchConfig({ mode: "br", arena: "frontier", teamSize: squad, offline: false }).maxPlayers).toBe(BR_PLAYERS);
  });

  it("a full 8v8 bot match fights and stays fast", () => {
    const map = getFrontierMap();
    const m = new Match(makeMatchConfig({ mode: "tdm", arena: "rusthaven", teamSize: 8, offline: true, seed: 21, difficulty: "veteran" }), map);
    for (let i = 0; i < 16; i++) m.addBot(i % 2, i % 2);
    for (let i = 0; i < 300; i++) m.step();
    const t0 = Date.now();
    for (let i = 0; i < 1800; i++) {
      m.step();
      m.clearEvents();
    }
    const ms = (Date.now() - t0) / 1800;
    const kills = [...m.players.values()].reduce((a, p) => a + p.stats.kills, 0);
    expect(m.players.size).toBe(16);
    expect(kills).toBeGreaterThan(5);
    expect(ms).toBeLessThan(5);
  }, 60000);
});

describe("Gun Game", () => {
  it("promotes every killer up the ladder and ends on a final-weapon kill", () => {
    const map = getFrontierMap();
    const m = new Match(makeMatchConfig({ mode: "gungame", arena: "rusthaven", offline: true, seed: 33, difficulty: "elite", timeLimit: 420 }), map);
    for (let i = 0; i < 10; i++) m.addBot(i, i);
    let checked = 0;
    for (let i = 0; i < 30 * 460 && m.phase !== "ended"; i++) {
      m.step();
      m.clearEvents();
      if (i % 90 === 0) {
        for (const p of m.players.values()) {
          if (!p.st.alive) continue;
          // Everyone carries exactly their tier's weapon and nothing else.
          expect(p.st.slots[0]?.id).toBe(GUN_LADDER[Math.min(p.gunTier, GUN_LADDER.length - 1)]);
          expect(p.st.slots[1]).toBeNull();
          expect(p.st.slots[2]).toBeNull();
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(m.phase).toBe("ended");
    expect(m.results?.reason).toBe("Final weapon kill");
    const winner = [...m.players.values()].find((p) => p.team === m.results!.winnerTeam)!;
    expect(winner.gunTier).toBe(GUN_LADDER.length);
  }, 60000);

  it("hands out no weapon or power pickups", () => {
    const kinds = (mode: "gungame" | "ffa") => {
      const m = new Match(makeMatchConfig({ mode, arena: "neon_city", offline: true, seed: 2 }), getFrontierMap());
      return (m as unknown as { pickups: { kind: string }[] }).pickups.map((p) => p.kind);
    };
    expect(kinds("ffa").some((k) => k === "weapon" || k === "power")).toBe(true);
    const gg = kinds("gungame");
    expect(gg.length).toBeGreaterThan(0);
    expect(gg.some((k) => k === "weapon" || k === "power")).toBe(false);
  });
});

describe("scoring", () => {
  it("medal scores come from the shared table the client uses for pop-ups", () => {
    expect(MEDAL_SCORES.double_kill).toBe(50);
    expect(MEDAL_SCORES.data_heist).toBe(150);
    expect(MEDAL_SCORES.headshot).toBe(0);
  });
});

describe("slide-hop", () => {
  const run = (holdCrouch: boolean) => {
    const env = { world: new CollisionWorld(flat()), bounds: { minX: -200, minZ: -200, maxX: 200, maxZ: 200 }, gravity: 1, tacticalRate: 1, maxArmor: 100 };
    const { hooks, fx } = recordingHooks();
    const p = createPlayerState(1, 0, DEFAULT_LOADOUT);
    resetForSpawn(p, DEFAULT_LOADOUT, ARENA_KIT, { x: 0, y: 0, z: 150 }, 0);
    for (let i = 0; i < 60; i++) stepPlayer(p, inp({ mz: 1, b: Btn.SPRINT }), env, hooks, SIM_DT);
    stepPlayer(p, inp({ mz: 1, b: Btn.SPRINT | Btn.CROUCH }), env, hooks, SIM_DT);
    for (let i = 0; i < 8; i++) stepPlayer(p, inp({ mz: 1, b: Btn.CROUCH }), env, hooks, SIM_DT);
    stepPlayer(p, inp({ mz: 1, b: Btn.CROUCH | Btn.JUMP }), env, hooks, SIM_DT);
    let landed = -1;
    for (let i = 0; i < 120; i++) {
      stepPlayer(p, inp({ mz: 1, b: holdCrouch ? Btn.CROUCH : 0 }), env, hooks, SIM_DT);
      if (landed < 0 && p.onGround) landed = i;
      if (landed >= 0 && i - landed >= 15) break;
    }
    return { speed: Math.hypot(p.vx, p.vz), slides: fx.filter((f) => f === "slide").length };
  };
  it("landing with crouch held flows into a slide that keeps momentum", () => {
    const hop = run(true);
    const plain = run(false);
    expect(hop.slides).toBe(2);
    expect(plain.slides).toBe(1);
    expect(hop.speed).toBeGreaterThan(plain.speed + 2);
  });
});

function flat() {
  return {
    name: "flat", minX: -200, minZ: -200, maxX: 200, maxZ: 200,
    boxes: [{ minX: -200, minY: -1, minZ: -200, maxX: 200, maxY: 0, maxZ: 200, mat: 0, color: 0, flags: 1 }],
    ladders: [], signs: [], lights: [], water: [], districts: [], barrels: [], loot: [], roads: [], jumpPads: [], crates: [],
  } as unknown as import("../src/map/types").MapData;
}

describe("death feedback", () => {
  it("kill events carry the killer's health and distance, and the killer is marked after you respawn", () => {
    const m = new Match(makeMatchConfig({ mode: "tdm", arena: "neon_city", teamSize: 2, offline: true, seed: 8, timeLimit: 600 }), getFrontierMap());
    const me = m.addPlayer({ id: 1, name: "Player", squad: 0, team: 0 });
    const foe = m.addBot(1, 1);
    for (let i = 0; i < 30 * 7; i++) m.step();
    m.clearEvents();
    foe.st.health = 37;
    (m as unknown as { kill: (v: unknown, k: unknown, c: string, h: boolean) => void }).kill(me, foe, "pulse9", false);
    const ev = (m as unknown as { events: { k: string; kh?: number; kd?: number }[] }).events.find((e) => e.k === "kill")!;
    expect(ev.kh).toBe(37);
    expect(ev.kd).toBeGreaterThanOrEqual(0);
    // Respawn: the killer is revealed to my team for a few seconds.
    for (let i = 0; i < 30 * 5 && !me.st.alive; i++) m.step();
    expect(me.st.alive).toBe(true);
    expect(foe.st.alive).toBe(true);
    expect(m.isRevealedTo(foe, me.team)).toBe(true);
  });
});
