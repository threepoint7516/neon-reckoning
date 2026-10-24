import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory localStorage for the node test environment.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

const KEY = "neon-reckoning:progress";
/** Fresh module per test: progress loads from storage at import time. */
async function load() {
  vi.resetModules();
  return import("../src/state/progress");
}

describe("opt-in progress saving", () => {
  beforeEach(() => store.clear());

  it("saves nothing and starts at level 1 by default", async () => {
    const { progress } = await load();
    progress.add(5000);
    expect(progress.get().remember).toBe(false);
    expect(progress.get().level).toBeGreaterThan(1);
    expect(store.size).toBe(0);
  });

  it("when opted in, saves only total XP and camo, and restores the level from them", async () => {
    let m = await load();
    m.progress.setRemember(true);
    m.progress.add(3000);
    m.progress.setCamo("tiger");
    expect(JSON.parse(store.get(KEY)!)).toEqual({ v: 1, xp: 3000, camo: "tiger" });

    m = await load();
    const s = m.progress.get();
    expect(s.remember).toBe(true);
    expect(s.total).toBe(3000);
    expect(s).toMatchObject(m.levelFromTotal(3000));
    expect(s.level).toBe(4);
    expect(s.camo).toBe("tiger");
  });

  it("turning the option off deletes the saved copy but keeps this tab's progress", async () => {
    const { progress } = await load();
    progress.setRemember(true);
    progress.add(1000);
    expect(store.has(KEY)).toBe(true);
    progress.setRemember(false);
    expect(store.has(KEY)).toBe(false);
    expect(progress.get().total).toBe(1000);
    progress.add(500);
    expect(store.has(KEY)).toBe(false);
  });

  it("ignores malformed or out-of-range data and camos above the saved level", async () => {
    for (const raw of ["not json", '{"v":1,"xp":-5}', '{"v":2,"xp":100}', '{"v":1,"xp":"9e9"}']) {
      store.set(KEY, raw);
      const { progress } = await load();
      expect(progress.get().level).toBe(1);
      expect(progress.get().total).toBe(0);
    }
    store.set(KEY, JSON.stringify({ v: 1, xp: 700, camo: "prism" }));
    const { progress } = await load();
    expect(progress.get().level).toBe(2);
    expect(progress.get().camo).toBe("factory");
    store.set(KEY, JSON.stringify({ v: 1, xp: 1e12, camo: "factory" }));
    const capped = (await load()).progress.get();
    expect(capped.total).toBe(10_000_000);
  });
});
