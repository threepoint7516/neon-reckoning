import { describe, expect, it } from "vitest";
import { createPlayerState, resetForSpawn, ARENA_KIT, stepPlayer } from "../src/sim/player";
import { Btn, SIM_DT, SPRINT_SPEED, WALK_SPEED } from "../src/constants";
import { DEFAULT_LOADOUT } from "../src/types";
import { box, inp, recordingHooks, testEnv, testMap } from "./helpers";

function spawn(x = 0, z = 0, y = 0.05) {
  const p = createPlayerState(1, 0, DEFAULT_LOADOUT);
  resetForSpawn(p, DEFAULT_LOADOUT, ARENA_KIT, { x, y, z }, 0);
  return p;
}

describe("movement & collision", () => {
  it("settles onto the ground under gravity", () => {
    const env = testEnv(testMap());
    const { hooks } = recordingHooks();
    const p = spawn(0, 0, 3);
    for (let i = 0; i < 120; i++) stepPlayer(p, inp(), env, hooks, SIM_DT);
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(0, 2);
  });

  it("walks at walk speed and sprints faster", () => {
    const env = testEnv(testMap());
    const { hooks } = recordingHooks();
    const p = spawn();
    for (let i = 0; i < 60; i++) stepPlayer(p, inp({ mz: 1 }), env, hooks, SIM_DT);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(WALK_SPEED * 0.9);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThanOrEqual(WALK_SPEED + 0.01);
    for (let i = 0; i < 60; i++) stepPlayer(p, inp({ mz: 1, b: Btn.SPRINT }), env, hooks, SIM_DT);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(SPRINT_SPEED * 0.9);
  });

  it("cannot pass through a wall even at high speed", () => {
    // Thin wall 2 m ahead (yaw 0 looks toward −Z).
    const env = testEnv(testMap([box(-10, 0, -2.2, 10, 4, -2)]));
    const { hooks } = recordingHooks();
    const p = spawn();
    p.vz = -400; // absurd velocity: swept collision must still stop it
    for (let i = 0; i < 120; i++) stepPlayer(p, inp({ mz: 1, b: Btn.SPRINT }), env, hooks, SIM_DT);
    expect(p.z).toBeGreaterThan(-2);
  });

  it("steps up low ledges but not tall ones", () => {
    const { hooks } = recordingHooks();
    const low = testEnv(testMap([box(-5, 0, -10, 5, 0.45, -3)]));
    const p = spawn();
    for (let i = 0; i < 90; i++) stepPlayer(p, inp({ mz: 1 }), low, hooks, SIM_DT);
    expect(p.y).toBeCloseTo(0.45, 1);
    expect(p.z).toBeLessThan(-3);

    const tall = testEnv(testMap([box(-5, 0, -10, 5, 1.0, -3)]));
    const q = spawn();
    for (let i = 0; i < 90; i++) stepPlayer(q, inp({ mz: 1 }), tall, hooks, SIM_DT);
    expect(q.z).toBeGreaterThan(-3);
  });

  it("jumps roughly 1.3 m", () => {
    const env = testEnv(testMap());
    const { hooks } = recordingHooks();
    const p = spawn();
    for (let i = 0; i < 10; i++) stepPlayer(p, inp(), env, hooks, SIM_DT);
    let maxY = 0;
    stepPlayer(p, inp({ b: Btn.JUMP }), env, hooks, SIM_DT);
    for (let i = 0; i < 60; i++) {
      stepPlayer(p, inp(), env, hooks, SIM_DT);
      maxY = Math.max(maxY, p.y);
    }
    expect(maxY).toBeGreaterThan(1.1);
    expect(maxY).toBeLessThan(1.5);
  });

  it("slides when crouching at sprint speed", () => {
    const env = testEnv(testMap());
    const { hooks, fx } = recordingHooks();
    const p = spawn();
    for (let i = 0; i < 60; i++) stepPlayer(p, inp({ mz: 1, b: Btn.SPRINT }), env, hooks, SIM_DT);
    stepPlayer(p, inp({ mz: 1, b: Btn.SPRINT | Btn.CROUCH }), env, hooks, SIM_DT);
    expect(fx).toContain("slide");
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(SPRINT_SPEED);
  });

  it("respects arena bounds", () => {
    const env = testEnv(testMap());
    env.bounds = { minX: -5, minZ: -5, maxX: 5, maxZ: 5 };
    const { hooks } = recordingHooks();
    const p = spawn();
    for (let i = 0; i < 300; i++) stepPlayer(p, inp({ mz: 1, b: Btn.SPRINT }), env, hooks, SIM_DT);
    expect(p.z).toBeGreaterThanOrEqual(-5);
  });

  it("is deterministic for identical input streams (prediction parity)", () => {
    const env = testEnv(testMap([box(3, 0, -8, 4, 2, 8)]));
    const run = () => {
      const { hooks } = recordingHooks();
      const p = spawn();
      for (let i = 0; i < 240; i++)
        stepPlayer(p, inp({ seq: i, mx: Math.sin(i / 20), mz: 1, yaw: i / 50, b: i % 37 === 0 ? Btn.JUMP : Btn.SPRINT }), env, hooks, SIM_DT);
      return [p.x, p.y, p.z, p.vx, p.vy, p.vz];
    };
    expect(run()).toEqual(run());
  });
});
