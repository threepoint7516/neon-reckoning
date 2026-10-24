import { CollisionWorld } from "../src/map/collision";
import { BoxFlag, Mat } from "../src/map/types";
import type { Box, MapData } from "../src/map/types";
import type { PlayerInput } from "../src/types";
import type { SimHooks, StepEnv } from "../src/sim/player";

export function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box {
  return { minX, minY, minZ, maxX, maxY, maxZ, mat: Mat.CONCRETE, color: 0, flags: BoxFlag.SOLID };
}

/** Flat 100×100 test floor plus any extra boxes. */
export function testMap(extra: Box[] = []): MapData {
  return {
    name: "test", minX: -50, minZ: -50, maxX: 50, maxZ: 50,
    boxes: [box(-50, -1, -50, 50, 0, 50), ...extra], ladders: [], signs: [], lights: [], water: [], districts: [], barrels: [], loot: [], roads: [], jumpPads: [], crates: [],
  };
}

export function testEnv(map: MapData): StepEnv {
  return { world: new CollisionWorld(map), bounds: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 }, gravity: 1, tacticalRate: 1, maxArmor: 100 };
}

export function recordingHooks() {
  const shots: number[] = [];
  const fx: string[] = [];
  const hooks: SimHooks = {
    fireHitscan: (_p, _d, _o, dirs) => shots.push(dirs.length),
    fireProjectile: () => shots.push(1),
    throwGrenade: () => fx.push("grenade"),
    useTactical: () => false,
    interact: () => {},
    fallDamage: () => fx.push("fall"),
    fx: (_p, f) => fx.push(f),
  };
  return { hooks, shots, fx };
}

let seq = 0;
export function inp(o: Partial<PlayerInput> = {}): PlayerInput {
  return { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0, vt: 0, ...o };
}
