import { describe, expect, it } from "vitest";
import { getFrontierMap } from "../src/map/frontier";
import { CollisionWorld } from "../src/map/collision";
import { BoxFlag } from "../src/map/types";
import type { Box, StairRun } from "../src/map/types";
import { overlaps, stairVolumes } from "../src/map/stairs";
import { createPlayerState, resetForSpawn, stepPlayer, ARENA_KIT } from "../src/sim/player";
import type { PlayerState } from "../src/sim/player";
import { SIM_DT, Btn, GRAVITY } from "../src/constants";
import { DEFAULT_LOADOUT } from "../src/types";
import { recordingHooks } from "./helpers";

const map = getFrontierMap();
const world = new CollisionWorld(map);
const env = { world, bounds: { minX: map.minX, minZ: map.minZ, maxX: map.maxX, maxZ: map.maxZ }, gravity: 1, tacticalRate: 1, maxArmor: 100 };
const stairs = map.stairs ?? [];
let seq = 0;

function step(p: PlayerState, b: number, mz = 0, hooks = recordingHooks().hooks): void {
  stepPlayer(p, { seq: ++seq, mx: 0, mz, yaw: p.yaw, pitch: 0, b, vt: 0 }, env, hooks, SIM_DT);
}

/** Yaw that faces along the run's axis in direction d (forward = (-sin, -cos)). */
const yawAlong = (axis: "x" | "z", d: number) => (axis === "x" ? (d > 0 ? -Math.PI / 2 : Math.PI / 2) : d > 0 ? Math.PI : 0);

/** A player standing just off one end of a flight, facing along it (up = toward the high end). */
function playerAt(r: StairRun, up: boolean): { p: PlayerState; target: number } {
  const ascend = r.y1 >= r.y0 ? r.dir : -r.dir;
  const lowU = r.y1 >= r.y0 ? 0 : r.len * r.dir;
  const highU = r.y1 >= r.y0 ? r.len * r.dir : 0;
  const u = up ? lowU - ascend * 0.9 : highU + ascend * 0.9;
  const lo = Math.min(r.y0, r.y1);
  const hi = Math.max(r.y0, r.y1);
  const y = (up ? lo : hi) + 0.02;
  const p = createPlayerState(1, 0, DEFAULT_LOADOUT);
  resetForSpawn(p, DEFAULT_LOADOUT, ARENA_KIT, r.axis === "x" ? { x: r.x + u, y, z: r.z } : { x: r.x, y, z: r.z + u }, yawAlong(r.axis, up ? ascend : -ascend));
  for (let i = 0; i < 20; i++) step(p, 0);
  return { p, target: up ? hi : lo };
}

/** The flight's own step boxes (exact geometry from the run). */
function isStepOf(b: Box, r: StairRun): boolean {
  const run = r.len / r.steps;
  const rise = (r.y1 - r.y0) / r.steps;
  const eq = (a: number, c: number) => Math.abs(a - c) < 1e-6;
  for (let i = 0; i < r.steps; i++) {
    const u0 = r.dir > 0 ? i * run : -(i + 1) * run;
    const u1 = r.dir > 0 ? (i + 1) * run : -i * run;
    const a0 = (r.axis === "x" ? r.x : r.z) + u0;
    const a1 = (r.axis === "x" ? r.x : r.z) + u1;
    const top = r.y0 + (i + 1) * rise;
    const [mn, mx] = r.axis === "x" ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
    const [cn, cx] = r.axis === "x" ? [b.minZ, b.maxZ] : [b.minX, b.maxX];
    const c = r.axis === "x" ? r.z : r.x;
    if (eq(mn, a0) && eq(mx, a1) && eq(b.maxY, Math.max(top, r.y0)) && eq(cn, c - r.width / 2) && eq(cx, c + r.width / 2)) return true;
  }
  return false;
}

describe("stairways", () => {
  it("the map records its stair flights", () => {
    expect(stairs.length).toBeGreaterThan(300);
  });

  it("no solid geometry, ladder, jump pad, crate or barrel sits in any stairway's walk space", () => {
    const problems: string[] = [];
    for (const r of stairs) {
      const vols = stairVolumes(r);
      const hit = (a: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }) => vols.some((v) => overlaps(a, v));
      for (const b of map.boxes) if (!(b.flags & BoxFlag.DECOR) && hit(b) && !isStepOf(b, r)) problems.push(`box ${JSON.stringify(b)} in stair ${JSON.stringify(r)}`);
      for (const l of map.ladders) if (hit(l)) problems.push(`ladder in stair ${JSON.stringify(r)}`);
      for (const j of map.jumpPads) if (hit({ ...j, maxY: j.minY + 1.8 })) problems.push(`jump pad in stair ${JSON.stringify(r)}`);
      for (const e of [...map.crates, ...map.barrels]) if (hit({ minX: e.x - 0.5, maxX: e.x + 0.5, minY: e.y, maxY: e.y + 1, minZ: e.z - 0.5, maxZ: e.z + 0.5 })) problems.push(`entity in stair ${JSON.stringify(r)}`);
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("every flight can be walked and sprinted up and down without snagging or bobbing", () => {
    const problems: string[] = [];
    for (const r of stairs) {
      for (const up of [true, false]) {
        for (const sprint of [true, false]) {
          const { p, target } = playerAt(r, up);
          let reached = false;
          let stalls = 0;
          let reversals = 0;
          let lastY = p.y;
          for (let i = 0; i < 60 * 6 && !reached; i++) {
            step(p, sprint ? Btn.SPRINT : 0, 1);
            if (i > 10 && Math.hypot(p.vx, p.vz) < 0.5) stalls++;
            if (up ? p.y < lastY - 0.02 : p.y > lastY + 0.02) reversals++;
            lastY = p.y;
            reached = Math.abs(p.y - target) < 0.2;
          }
          if (!reached || stalls > 5 || reversals > 0) problems.push(`${up ? "up" : "down"}${sprint ? " sprint" : ""} ${JSON.stringify(r)} y=${p.y.toFixed(2)} stalls=${stalls} reversals=${reversals}`);
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  }, 120000);

  it("you can jump from the middle of any flight, going up or down", () => {
    const problems: string[] = [];
    for (const r of stairs) {
      for (const up of [true, false]) {
        const { p } = playerAt(r, up);
        const mid = (r.y0 + r.y1) / 2;
        for (let i = 0; i < 200 && (up ? p.y < mid : p.y > mid); i++) step(p, Btn.SPRINT, 1);
        for (let k = 0; k < 3; k++) step(p, Btn.SPRINT, 1);
        const onGround = p.onGround;
        const y0 = p.y;
        step(p, Btn.SPRINT | Btn.JUMP, 1);
        let apex = p.y;
        for (let k = 0; k < 20; k++) {
          step(p, Btn.SPRINT, 1);
          apex = Math.max(apex, p.y);
        }
        if (!onGround || apex - y0 < (up ? 1.0 : 0.6)) problems.push(`${up ? "up" : "down"} ${JSON.stringify(r)} onGround=${onGround} gain=${(apex - y0).toFixed(2)}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  }, 60000);

  it("outdoor rooftop stairs arrive on a landing with a walk-through opening onto the roof", () => {
    // Outdoor flights: 1.5 m wide, from the street to a roof.
    const outdoor = stairs.filter((r) => r.width === 1.5 && r.y0 === 0 && r.y1 >= 4);
    expect(outdoor.length).toBeGreaterThan(10);
    const problems: string[] = [];
    for (const r of outdoor) {
      let ok = false;
      for (const side of [1, -1]) {
        const { p } = playerAt(r, true);
        for (let i = 0; i < 60 * 4 && Math.abs(p.y - r.y1) > 0.05; i++) step(p, Btn.SPRINT, 1);
        // Turn 90° toward one side and walk off the landing.
        const along = r.axis === "x" ? "z" : "x";
        p.yaw = yawAlong(along, side);
        const sx = p.x;
        const sz = p.z;
        // Reaching roof level 2 m in from the landing counts (some roofs have a stairwell further in).
        for (let i = 0; i < 90 && !ok; i++) {
          step(p, 0, 1);
          if (Math.abs(p.y - r.y1) < 0.1 && Math.hypot(p.x - sx, p.z - sz) > 2) ok = true;
        }
      }
      if (!ok) problems.push(JSON.stringify(r));
    }
    expect(problems.slice(0, 5)).toEqual([]);
  }, 60000);
});

describe("jump pads", () => {
  it("every pad has its visual, launches to its full height without hitting anything, and lands safely", () => {
    const pads = map.boxes.filter((b) => b.color === 0x3ee6a6 && b.flags & BoxFlag.DECOR);
    expect(pads.length).toBe(map.jumpPads.length);
    const problems: string[] = [];
    for (const j of map.jumpPads) {
      const { hooks, fx } = recordingHooks();
      let fall = 0;
      hooks.fallDamage = (_p, d) => (fall += d);
      const p = createPlayerState(1, 0, DEFAULT_LOADOUT);
      resetForSpawn(p, DEFAULT_LOADOUT, ARENA_KIT, { x: (j.minX + j.maxX) / 2, y: j.minY + 0.5, z: (j.minZ + j.maxZ) / 2 }, 0);
      let apex = p.y;
      let launched = -1;
      for (let i = 0; i < 60 * 5; i++) {
        step(p, 0, 0, hooks);
        if (launched < 0 && fx.includes("pad")) launched = i;
        apex = Math.max(apex, p.y);
        if (launched >= 0 && i - launched > 20 && p.onGround) break;
      }
      const expected = j.minY + 0.2 + (j.vy * j.vy) / (2 * GRAVITY);
      if (launched < 0 || apex < expected - 1 || fall > 0) problems.push(`${JSON.stringify(j)} launched=${launched >= 0} apex=${apex.toFixed(1)}/${expected.toFixed(1)} fall=${fall}`);
    }
    expect(problems).toEqual([]);
  });
});
