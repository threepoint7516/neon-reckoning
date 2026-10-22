import { describe, expect, it } from "vitest";
import { generateFrontier, getFrontierMap } from "../src/map/frontier";
import { CollisionWorld } from "../src/map/collision";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../src/constants";

describe("Neon Frontier map", () => {
  const map = getFrontierMap();
  const world = new CollisionWorld(map);

  it("is deterministic (server and clients build identical geometry)", () => {
    const again = generateFrontier();
    expect(again.boxes.length).toBe(map.boxes.length);
    expect(JSON.stringify(again.boxes.slice(0, 500))).toBe(JSON.stringify(map.boxes.slice(0, 500)));
    expect(JSON.stringify(again.districts)).toBe(JSON.stringify(map.districts));
  });

  it("has eight named districts", () => {
    expect(map.districts.map((d) => d.id).sort()).toEqual(
      ["blacklight", "chrome_valley", "eclipse_harbor", "neon_city", "outlands", "rusthaven", "sector_zero", "skyrail"].sort(),
    );
  });

  for (const d of getFrontierMap().districts) {
    it(`${d.name}: spawns are open, objectives and pickups exist`, () => {
      expect(d.spawns.length).toBeGreaterThanOrEqual(12);
      for (const s of d.spawns) {
        const blocked = world.overlaps({
          minX: s.x - PLAYER_RADIUS, maxX: s.x + PLAYER_RADIUS, minY: s.y + 0.06, maxY: s.y + PLAYER_HEIGHT,
          minZ: s.z - PLAYER_RADIUS, maxZ: s.z + PLAYER_RADIUS,
        });
        expect(blocked).toBe(false);
        expect(s.x).toBeGreaterThan(d.minX);
        expect(s.x).toBeLessThan(d.maxX);
      }
      expect(d.points.length).toBe(3);
      expect(d.pickups.length).toBeGreaterThanOrEqual(12);
      expect(d.pickups.some((p) => p.kind === "power")).toBe(true);
    });
  }

  it("has battle royale loot spread across the region", () => {
    expect(map.loot.length).toBeGreaterThan(120);
  });

  it("raycasts hit the ground", () => {
    const y = world.groundHeight(0, -100, 50);
    expect(Number.isFinite(y)).toBe(true);
  });
});
