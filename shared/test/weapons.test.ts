import { describe, expect, it } from "vitest";
import { createPlayerState, resetForSpawn, ARENA_KIT, stepPlayer, makeSlot } from "../src/sim/player";
import { Btn, SIM_DT } from "../src/constants";
import { WEAPONS, damageAtRange } from "../src/balance/weapons";
import type { Loadout } from "../src/types";
import { inp, recordingHooks, testEnv, testMap } from "./helpers";

function armed(primary: Loadout["primary"]) {
  const lo: Loadout = { primary, secondary: "phantom", tactical: "recon" };
  const p = createPlayerState(1, 0, lo);
  resetForSpawn(p, lo, ARENA_KIT, { x: 0, y: 0, z: 0 }, 0);
  p.swapT = 0;
  return p;
}

const env = testEnv(testMap());

describe("weapons", () => {
  it("auto weapons respect fire rate", () => {
    const { hooks, shots } = recordingHooks();
    const p = armed("pulse9");
    for (let i = 0; i < 60; i++) stepPlayer(p, inp({ b: Btn.FIRE }), env, hooks, SIM_DT);
    // 1 s at 0.1 s interval → 10 shots (first fires immediately).
    expect(shots.length).toBeGreaterThanOrEqual(10);
    expect(shots.length).toBeLessThanOrEqual(11);
    expect(p.slots[0]!.mag).toBe(30 - shots.length);
  });

  it("semi-auto requires a fresh trigger pull", () => {
    const { hooks, shots } = recordingHooks();
    const p = armed("railspike");
    for (let i = 0; i < 60; i++) stepPlayer(p, inp({ b: Btn.FIRE }), env, hooks, SIM_DT);
    expect(shots.length).toBe(1);
  });

  it("burst rifle fires three rounds per pull", () => {
    const { hooks, shots } = recordingHooks();
    const p = armed("helix47");
    stepPlayer(p, inp({ b: Btn.FIRE }), env, hooks, SIM_DT);
    for (let i = 0; i < 30; i++) stepPlayer(p, inp({ b: 0 }), env, hooks, SIM_DT);
    expect(shots.length).toBe(3);
  });

  it("shotgun fires nine pellets", () => {
    const { hooks, shots } = recordingHooks();
    const p = armed("breachmaker");
    stepPlayer(p, inp({ b: Btn.FIRE }), env, hooks, SIM_DT);
    expect(shots[0]).toBe(9);
  });

  it("reloads from reserve after the reload time", () => {
    const { hooks } = recordingHooks();
    const p = armed("pulse9");
    p.slots[0]!.mag = 5;
    stepPlayer(p, inp({ b: Btn.RELOAD }), env, hooks, SIM_DT);
    expect(p.reloadT).toBeGreaterThan(0);
    const steps = Math.ceil(WEAPONS.pulse9.reloadTime / SIM_DT) + 2;
    for (let i = 0; i < steps; i++) stepPlayer(p, inp(), env, hooks, SIM_DT);
    expect(p.slots[0]!.mag).toBe(30);
    expect(p.slots[0]!.reserve).toBe(WEAPONS.pulse9.reserve - 25);
  });

  it("cannot fire during reload or with an empty magazine", () => {
    const { hooks, shots } = recordingHooks();
    const p = armed("pulse9");
    p.slots[0]!.mag = 0;
    p.slots[0]!.reserve = 0;
    for (let i = 0; i < 30; i++) stepPlayer(p, inp({ b: Btn.FIRE }), env, hooks, SIM_DT);
    expect(shots.length).toBe(0);
  });

  it("switches weapons with a swap delay", () => {
    const { hooks, shots } = recordingHooks();
    const p = armed("pulse9");
    stepPlayer(p, inp({ b: Btn.SLOT2 }), env, hooks, SIM_DT);
    expect(p.active).toBe(1);
    expect(p.swapT).toBeGreaterThan(0);
    stepPlayer(p, inp({ b: Btn.FIRE }), env, hooks, SIM_DT);
    expect(shots.length).toBe(0);
  });

  it("damage falls off with range", () => {
    const d = WEAPONS.viper;
    expect(damageAtRange(d, 5)).toBe(d.damage);
    expect(damageAtRange(d, 100)).toBeCloseTo(d.damage * d.minDamageMult);
  });

  it("power weapons carry limited ammunition", () => {
    const s = makeSlot("nova");
    expect(s.mag + s.reserve).toBe(6);
    expect(WEAPONS.nova.ammoPickupMags).toBe(0);
  });

  it("every weapon has distinct handling", () => {
    const sig = Object.values(WEAPONS).map((w) => `${w.fireMode}|${w.fireInterval}|${w.damage}|${w.mag}`);
    expect(new Set(sig).size).toBe(sig.length);
  });
});
