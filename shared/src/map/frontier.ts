import { MapBuilder, FLOOR_H } from "./builder";
import { CollisionWorld } from "./collision";
import { BoxFlag, Mat } from "./types";
import type { District, MapData, PickupSpot } from "./types";
import type { DistrictId } from "../types";
import { Rng } from "../rng";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../constants";
import type { Vec3 } from "../math";

/*
 * NEON FRONTIER — a 384 m × 384 m region laid out as a 3×3 grid of 128 m
 * cells separated by streets. Eight districts plus the electrified bay:
 *
 *   [ The Outlands ]  [ Sector Zero ]  [ Skyrail Station ]
 *   [ Rusthaven    ]  [ Neon City   ]  [ Blacklight Mkt  ]
 *   [ Chrome Valley]  [ Eclipse Hbr ]  [   (the bay)     ]
 *
 * Everything is generated from fixed seeds so the server and every client
 * build byte-identical geometry without shipping map files.
 */

export const REGION = 192;
export const CELL_SIZE = 128;
const HALF = 58; // half-size of a district's buildable interior

const NEON = {
  cyan: 0x22e5ff, magenta: 0xff2bd6, violet: 0x9b5cff, green: 0x7dff3a, orange: 0xff8a1f, red: 0xff3b5c, yellow: 0xffe14a, white: 0xe8f0ff,
};
const NEON_LIST = Object.values(NEON);

const SIGN_WORDS = [
  "KAIJU COLA", "NOODLE 24", "HOTEL ORBIT", "VOIDNET", "LUCKY 8", "CYBER CLINIC", "ARCADE", "SYNTH BAR", "RAMEN", "DATA DEN",
  "OPEN 25H", "HYPERDRIVE", "NEURO+", "CHROME", "PULSE FM", "GLITCH", "OMNI-MART", "ZETA", "DREAMWARE", "NIGHT OWL",
];

interface Cell {
  id: DistrictId | "bay";
  cx: number;
  cz: number;
}

const CELLS: Cell[] = [
  { id: "outlands", cx: -128, cz: -128 },
  { id: "sector_zero", cx: 0, cz: -128 },
  { id: "skyrail", cx: 128, cz: -128 },
  { id: "rusthaven", cx: -128, cz: 0 },
  { id: "neon_city", cx: 0, cz: 0 },
  { id: "blacklight", cx: 128, cz: 0 },
  { id: "chrome_valley", cx: -128, cz: 128 },
  { id: "eclipse_harbor", cx: 0, cz: 128 },
  { id: "bay", cx: 128, cz: 128 },
];

const META: Record<DistrictId, { name: string; tagline: string; accent: number }> = {
  neon_city: { name: "Neon City", tagline: "High-rise canyons, alleys and skybridges", accent: NEON.magenta },
  rusthaven: { name: "Rusthaven", tagline: "Factories, warehouses and scrapyards", accent: NEON.orange },
  eclipse_harbor: { name: "Eclipse Harbor", tagline: "Container stacks, cranes and electrified water", accent: NEON.cyan },
  sector_zero: { name: "Sector Zero", tagline: "Abandoned research labs and an underground complex", accent: NEON.green },
  chrome_valley: { name: "Chrome Valley", tagline: "Elevated highway, tunnel and wrecked convoys", accent: NEON.yellow },
  outlands: { name: "The Outlands", tagline: "Open ridges, comms towers and remote settlements", accent: NEON.violet },
  blacklight: { name: "Blacklight Market", tagline: "Narrow market lanes built for ambushes", accent: NEON.red },
  skyrail: { name: "Skyrail Station", tagline: "Elevated platforms, trains and a grand concourse", accent: NEON.white },
};

export const DISTRICT_IDS = Object.keys(META) as DistrictId[];
export const districtMeta = (id: DistrictId) => META[id];

let cached: MapData | null = null;

/** Returns the (memoized) generated region. */
export function getFrontierMap(): MapData {
  if (!cached) cached = generateFrontier();
  return cached;
}

export function generateFrontier(): MapData {
  const b = new MapBuilder(1337);

  // Ground per cell (bay & harbor water handled separately).
  for (const c of CELLS) {
    if (c.id === "bay") continue;
    const groundMat = c.id === "outlands" ? Mat.DIRT : c.id === "rusthaven" || c.id === "sector_zero" ? Mat.CONCRETE : Mat.ASPHALT;
    const groundColor = c.id === "outlands" ? 0x5a4e6a : 0x4a4858;
    const x0 = c.cx - CELL_SIZE / 2;
    const z0 = c.cz - CELL_SIZE / 2;
    const x1 = c.cx + CELL_SIZE / 2;
    const z1 = c.cz + CELL_SIZE / 2;
    if (c.id === "eclipse_harbor") {
      b.box(x0, -1, z0, x1 - 34, 0, z1 - 22, groundMat, groundColor);
      b.box(x1 - 34, -1, z0, x1, 0, z0 + 18, groundMat, groundColor); // north quay connects to Blacklight road
    } else if (c.id === "sector_zero") {
      // Leave a pit for the underground lab (see sectorZero()).
      b.slab(x0, z0, x1, z1, -1, 0, groundMat, groundColor, [c.cx - 18, c.cz + 6, c.cx + 18, c.cz + 30]);
    } else if (c.id === "chrome_valley") {
      // Dry canal trench running north-south.
      b.box(x0, -1, z0, c.cx + 20, 0, z1, groundMat, groundColor);
      b.box(c.cx + 28, -1, z0, x1, 0, z1, groundMat, groundColor);
      b.box(c.cx + 20, -4, z0, c.cx + 28, -3, z1, Mat.CONCRETE, 0x30303a);
      b.box(c.cx + 20, -3, z0, c.cx + 20.4, 0, z1, Mat.CONCRETE, 0x30303a);
      b.box(c.cx + 27.6, -3, z0, c.cx + 28, 0, z1, Mat.CONCRETE, 0x30303a);
      b.box(c.cx + 20, -4, z0, c.cx + 28, 0, z0 + 0.4, Mat.CONCRETE, 0x30303a);
      b.box(c.cx + 20, -4, z1 - 0.4, c.cx + 28, 0, z1, Mat.CONCRETE, 0x30303a);
    } else {
      b.box(x0, -1, z0, x1, 0, z1, groundMat, groundColor);
    }
  }

  // Water: the bay plus the harbor's east channel and south basin.
  b.water.push({ minX: 64, minZ: 64, maxX: REGION, maxZ: REGION, level: -1.4 });
  b.water.push({ minX: 30, minZ: 82, maxX: 64, maxZ: REGION, level: -1.4 });
  b.water.push({ minX: -64, minZ: 170, maxX: 30, maxZ: REGION, level: -1.4 });

  // Street network (decor surface strips; collision comes from the ground).
  const roadY = 0.02;
  for (const off of [-64, 64]) {
    b.decor(off - 6, 0, -REGION, off + 6, roadY, off === 64 ? 64 : REGION, Mat.ASPHALT, 0x16161d);
    b.roads.push({ minX: off - 6, minZ: -REGION, maxX: off + 6, maxZ: off === 64 ? 64 : REGION });
    b.decor(-REGION, 0, off - 6, off === 64 ? 30 : REGION, roadY, off + 6, Mat.ASPHALT, 0x16161d);
    b.roads.push({ minX: -REGION, minZ: off - 6, maxX: off === 64 ? 30 : REGION, maxZ: off + 6 });
    // Lane markings.
    for (let u = -REGION + 4; u < REGION - 4; u += 9) {
      if (!(off === 64 && u > 60)) b.decor(off - 0.12, roadY, u, off + 0.12, roadY + 0.01, u + 4, Mat.NEON, 0xb8a040);
      if (!(off === 64 && u > 26)) b.decor(u, roadY, off - 0.12, u + 4, roadY + 0.01, off + 0.12, Mat.NEON, 0xb8a040);
    }
  }
  // Street lamps along the main roads.
  for (let u = -180; u <= 180; u += 24) {
    for (const off of [-64, 64]) {
      if (!(off === 64 && u > 56)) b.lamp(off + 6.6, u, NEON_LIST[(u / 24 + 8) % NEON_LIST.length]!, 6.5);
      if (!(off === 64 && u > 24)) b.lamp(u, off - 6.6, NEON_LIST[(u / 24 + 11) % NEON_LIST.length]!, 6.5);
    }
  }

  // Region boundary energy walls.
  const W = 60;
  b.box(-REGION - 2, -10, -REGION - 2, REGION + 2, W, -REGION, Mat.NEON, 0x22e5ff);
  b.box(-REGION - 2, -10, REGION, REGION + 2, W, REGION + 2, Mat.NEON, 0x22e5ff);
  b.box(-REGION - 2, -10, -REGION, -REGION, W, REGION, Mat.NEON, 0x22e5ff);
  b.box(REGION, -10, -REGION, REGION + 2, W, REGION, Mat.NEON, 0x22e5ff);
  // Mark them so the renderer draws them as barrier fields.
  for (let i = b.boxes.length - 4; i < b.boxes.length; i++) b.boxes[i]!.mat = Mat.BARRIER;

  const gens: Record<DistrictId, (b: MapBuilder, cx: number, cz: number, rng: Rng) => void> = {
    neon_city: neonCity,
    rusthaven,
    eclipse_harbor: eclipseHarbor,
    sector_zero: sectorZero,
    chrome_valley: chromeValley,
    outlands,
    blacklight,
    skyrail,
  };

  const spotRanges: Partial<Record<DistrictId, [number, number]>> = {};
  for (const c of CELLS) {
    if (c.id === "bay") continue;
    const before = b.spots.length;
    b.rng = new Rng(hashId(c.id));
    gens[c.id](b, c.cx, c.cz, b.rng);
    spotRanges[c.id] = [before, b.spots.length];
  }
  bay(b);

  const map: MapData = {
    name: "Neon Frontier",
    minX: -REGION, minZ: -REGION, maxX: REGION, maxZ: REGION,
    boxes: b.boxes, ladders: b.ladders, signs: b.signs, lights: b.lights, water: b.water,
    districts: [], barrels: b.barrels, loot: [], roads: b.roads,
  };

  // Placement pass: spawns, objectives and pickups are derived from the real
  // collision geometry so nothing ever spawns inside a wall.
  const world = new CollisionWorld(map);
  map.barrels = map.barrels.flatMap((p) => {
    const y = world.groundHeight(p.x, p.z, p.y + 1.5);
    if (!isFinite(y) || Math.abs(y - p.y) > 0.7) return [];
    const free = !world.overlaps({ minX: p.x - 0.4, maxX: p.x + 0.4, minY: y + 0.05, maxY: y + 1.2, minZ: p.z - 0.4, maxZ: p.z + 0.4 });
    return free ? [{ x: p.x, y, z: p.z }] : [];
  });
  for (const c of CELLS) {
    if (c.id === "bay") continue;
    const meta = META[c.id];
    const rng = new Rng(hashId(c.id) ^ 0xabcdef);
    const minX = c.cx - CELL_SIZE / 2 + 1;
    const maxX = c.cx + CELL_SIZE / 2 - 1;
    const minZ = c.cz - CELL_SIZE / 2 + 1;
    const maxZ = c.cz + CELL_SIZE / 2 - 1;
    const ground = sampleOpenGround(world, map, minX + 3, minZ + 3, maxX - 3, maxZ - 3, 3.5);
    const spawns = farthestPoints(ground, 18, rng);
    const points = [
      nearestOpen(ground, { x: c.cx - 34, y: 0, z: c.cz }),
      nearestOpen(ground, { x: c.cx, y: 0, z: c.cz }),
      nearestOpen(ground, { x: c.cx + 34, y: 0, z: c.cz }),
    ];
    const [s0, s1] = spotRanges[c.id]!;
    const spots = b.spots.slice(s0, s1).filter((p) => isFree(world, p));
    const pickups = placePickups(ground, spots, points, rng, c.cx, c.cz);
    map.districts.push({
      id: c.id, name: meta.name, tagline: meta.tagline, accent: meta.accent,
      minX, minZ, maxX, maxZ, spawns, pickups, points,
      landmark: { x: c.cx, y: 0, z: c.cz },
    });
    // BR loot: rooftops/interiors plus a scatter of open ground.
    for (const s of spots) map.loot.push(s);
    for (const g of farthestPoints(ground, 14, rng)) map.loot.push(g);
  }
  return map;
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function isFree(world: CollisionWorld, p: Vec3): boolean {
  return !world.overlaps({
    minX: p.x - PLAYER_RADIUS, maxX: p.x + PLAYER_RADIUS, minY: p.y + 0.06, maxY: p.y + PLAYER_HEIGHT,
    minZ: p.z - PLAYER_RADIUS, maxZ: p.z + PLAYER_RADIUS,
  });
}

function inWater(map: MapData, x: number, z: number): boolean {
  return map.water.some((w) => x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ);
}

/** Open, walkable ground-level points (y within 0.6 of street level). */
function sampleOpenGround(world: CollisionWorld, map: MapData, x0: number, z0: number, x1: number, z1: number, step: number): Vec3[] {
  const out: Vec3[] = [];
  for (let x = x0; x <= x1; x += step)
    for (let z = z0; z <= z1; z += step) {
      const y = world.groundHeight(x, z, 3);
      if (!isFinite(y) || y < -0.1 || y > 0.6) continue;
      const p = { x, y, z };
      if (inWater(map, x, z) && y < 0) continue;
      // Require clearance around the point so spawns aren't wedged in corners.
      const wide = !world.overlaps({ minX: x - 1, maxX: x + 1, minY: y + 0.06, maxY: y + PLAYER_HEIGHT + 0.3, minZ: z - 1, maxZ: z + 1 });
      if (wide) out.push(p);
    }
  return out;
}

function farthestPoints(pts: Vec3[], n: number, rng: Rng): Vec3[] {
  if (!pts.length) return [];
  const out: Vec3[] = [pts[rng.int(0, pts.length - 1)]!];
  const dist = pts.map((p) => Math.hypot(p.x - out[0]!.x, p.z - out[0]!.z));
  while (out.length < Math.min(n, pts.length)) {
    let bi = 0;
    for (let i = 1; i < pts.length; i++) if (dist[i]! > dist[bi]!) bi = i;
    const p = pts[bi]!;
    out.push(p);
    for (let i = 0; i < pts.length; i++) dist[i] = Math.min(dist[i]!, Math.hypot(pts[i]!.x - p.x, pts[i]!.z - p.z));
  }
  return out.map((p) => ({ ...p }));
}

function nearestOpen(pts: Vec3[], target: Vec3): Vec3 {
  let best = pts[0] ?? target;
  let bd = Infinity;
  for (const p of pts) {
    const d = Math.hypot(p.x - target.x, p.z - target.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return { ...best };
}

function placePickups(ground: Vec3[], spots: Vec3[], points: Vec3[], rng: Rng, cx: number, cz: number): PickupSpot[] {
  const used: Vec3[] = [...points];
  const take = (pool: Vec3[], minGap: number): Vec3 | null => {
    for (let tries = 0; tries < 60; tries++) {
      const p = pool[rng.int(0, pool.length - 1)];
      if (!p) return null;
      if (used.every((u) => Math.hypot(u.x - p.x, u.z - p.z) > minGap || Math.abs(u.y - p.y) > 2)) {
        used.push(p);
        return { ...p };
      }
    }
    return null;
  };
  const out: PickupSpot[] = [];
  const primaries = ["pulse9", "viper", "breachmaker", "longshot", "helix47", "titan", "railspike"] as const;
  // Power weapon: risk/reward spot close to the district centre.
  const central = [...ground].sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz)).slice(0, 12);
  const pw = take(central, 6);
  if (pw) out.push({ pos: pw, kind: "power", weapon: rng.chance(0.5) ? "nova" : "arcstorm" });
  const plan: [PickupSpot["kind"], number][] = [["weapon", 6], ["ammo", 5], ["health", 4], ["armor", 4], ["grenade", 3]];
  for (const [kind, n] of plan)
    for (let i = 0; i < n; i++) {
      const fromSpots = spots.length > 0 && rng.chance(0.45);
      const p = take(fromSpots ? spots : ground, 9);
      if (!p) continue;
      out.push(kind === "weapon" ? { pos: p, kind, weapon: rng.pick(primaries) } : { pos: p, kind });
    }
  return out;
}

// ---------------------------------------------------------------------------
// District generators. Each fills roughly [cx±58, cz±58].
// ---------------------------------------------------------------------------

function neonCity(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  // Central plaza with the Holo-Spire landmark.
  b.block(cx, cz, 7, 7, 64, Mat.FACADE, 0x1c1830);
  b.neonRect(cx - 3.5, cz - 3.5, cx + 3.5, cz + 3.5, 64, NEON.magenta, 0.2);
  for (let y = 8; y < 64; y += 8) b.neonRect(cx - 3.55, cz - 3.55, cx + 3.55, cz + 3.55, y, y % 16 ? NEON.cyan : NEON.magenta, 0.06);
  b.sign(cx, 22, cz + 3.6, 5.6, 9, 2, NEON.magenta, "HOLO-SPIRE", "holo");
  b.sign(cx, 22, cz - 3.6, 5.6, 9, 3, NEON.cyan, "NEON CITY", "holo");
  b.light(cx, 66, cz, NEON.magenta, 2);
  // Plaza cover: planters, kiosks, benches.
  for (const [dx, dz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]] as const) {
    b.block(cx + dx, cz + dz, 5, 1.6, 1.1, Mat.CONCRETE, 0x3d3b4f);
    b.decor(cx + dx - 2.4, 1.1, cz + dz - 0.7, cx + dx + 2.4, 1.15, cz + dz + 0.7, Mat.NEON, NEON.green);
    b.block(cx + dx * 0.55, cz + dz * 1.45, 2.4, 2.4, 2.6, Mat.PANEL, 0x2a2f45);
    b.sign(cx + dx * 0.55, 2.9, cz + dz * 1.45 + 1.25 * Math.sign(dz), 2.2, 0.6, dz > 0 ? 2 : 3, NEON_LIST[(dx + dz + 40) % 8]!, rng.pick(SIGN_WORDS));
  }
  for (const [dx, dz] of [[0, -16], [0, 16], [-16, 0], [16, 0]] as const) b.block(cx + dx, cz + dz, dz ? 3.5 : 0.8, dz ? 0.8 : 3.5, 1.0, Mat.CONCRETE, 0x4a4860);
  b.spot(cx + 8, 0.05, cz - 6);
  b.spot(cx - 7, 0.05, cz + 8);

  // Blocks on a 4×4 lattice, skipping the central plaza.
  const lat = [-44, -20, 20, 44];
  const interiors: { x: number; z: number; w: number; d: number; floors: number }[] = [];
  for (const ux of lat)
    for (const uz of lat) {
      if (Math.abs(ux) === 20 && Math.abs(uz) === 20) continue;
      const bx = cx + ux;
      const bz = cz + uz;
      const kind = rng.next();
      const color = rng.pick([0x262a3d, 0x2f2540, 0x1f2b38, 0x33283a]);
      const neon = rng.pick(NEON_LIST);
      if (kind < 0.45) {
        const floors = rng.int(2, 3);
        const w = 14;
        const d = 12;
        b.building(bx - w / 2, bz - d / 2, w, d, {
          floors, color, neon, doors: [ux < 0 ? "e" : "w", uz < 0 ? "s" : "n"], sign: rng.pick(SIGN_WORDS),
        });
        interiors.push({ x: bx, z: bz, w, d, floors });
      } else if (kind < 0.8) {
        const h = rng.int(18, 38);
        b.tower(bx, bz, 13, 13, h, color, neon, rng.pick(SIGN_WORDS));
        // Low annex with ladder to its roof: a sniper perch.
        const ax = bx + (ux < 0 ? 6.5 + 2.5 : -6.5 - 2.5);
        b.block(ax, bz, 5, 8, 5, Mat.CONCRETE, 0x30344a);
        b.ladder(ax, bz + 4, 0, 5, "s");
        b.box(ax - 2.5, 5, bz - 4, ax + 2.5, 6, bz - 3.8, Mat.CONCRETE, 0x30344a);
        b.spot(ax, 5.05, bz);
      } else {
        // Alley block: two narrow solid buildings with a dumpster alley.
        b.block(bx - 4.5, bz, 6, 14, rng.int(9, 16), Mat.FACADE, color);
        b.block(bx + 4.5, bz, 6, 14, rng.int(9, 16), Mat.FACADE, color);
        b.block(bx, bz - 3, 1.6, 2.6, 1.4, Mat.METAL, 0x2c4a3a);
        b.crate(bx + 0.6, bz + 3, 1.1);
        b.sign(bx - 1.45, 4, bz, 0.8, 3.5, 0, neon, rng.pick(SIGN_WORDS), "strip");
        b.light(bx, 3, bz, neon, 0.6);
        b.barrel(bx - 0.6, bz + 5);
      }
    }
  // Skybridges between neighbouring interior buildings at matching heights.
  for (let i = 0; i < interiors.length; i++)
    for (let j = i + 1; j < interiors.length; j++) {
      const p = interiors[i]!;
      const q = interiors[j]!;
      const fl = Math.min(p.floors, q.floors);
      const y = fl * FLOOR_H;
      if (p.z === q.z && Math.abs(p.x - q.x) === 24) {
        const xa = Math.min(p.x, q.x) + p.w / 2;
        const xb = Math.max(p.x, q.x) - q.w / 2;
        b.box(xa, y - 0.3, p.z - 1.5, xb, y, p.z + 1.5, Mat.METAL, 0x3a4058);
        b.box(xa, y, p.z - 1.55, xb, y + 1.0, p.z - 1.4, Mat.GLASS, 0x6080a0);
        b.box(xa, y, p.z + 1.4, xb, y + 1.0, p.z + 1.55, Mat.GLASS, 0x6080a0);
        b.decor(xa, y - 0.35, p.z - 1.5, xb, y - 0.3, p.z + 1.5, Mat.NEON, NEON.cyan);
        // Cut a doorway through each parapet: parapets are 1m so players jump over (cover stays).
      } else if (p.x === q.x && Math.abs(p.z - q.z) === 24) {
        const za = Math.min(p.z, q.z) + p.d / 2;
        const zb = Math.max(p.z, q.z) - q.d / 2;
        b.box(p.x - 1.5, y - 0.3, za, p.x + 1.5, y, zb, Mat.METAL, 0x3a4058);
        b.box(p.x - 1.55, y, za, p.x - 1.4, y + 1.0, zb, Mat.GLASS, 0x6080a0);
        b.box(p.x + 1.4, y, za, p.x + 1.55, y + 1.0, zb, Mat.GLASS, 0x6080a0);
        b.decor(p.x - 1.5, y - 0.35, za, p.x + 1.5, y - 0.3, zb, Mat.NEON, NEON.magenta);
      }
    }
  // Street clutter: parked/wrecked cars and barricades.
  for (let i = 0; i < 14; i++) {
    const alongX = rng.chance(0.5);
    const lane = rng.pick([-32, 0, 32]);
    const u = rng.range(-50, 50);
    const x = alongX ? cx + u : cx + lane;
    const z = alongX ? cz + lane : cz + u;
    if (Math.abs(x - cx) < 9 && Math.abs(z - cz) < 9) continue;
    b.car(x, z, alongX, rng.pick([0x8a1f3a, 0x1f4a8a, 0xc8c8d0, 0x202028, 0x6a2a8a]));
  }
  for (let i = 0; i < 8; i++) b.barrier(cx + rng.range(-52, 52), cz + rng.pick([-32, 32]) + rng.range(-2, 2), rng.chance(0.5));
  for (let i = 0; i < 6; i++) b.barrel(cx + rng.pick([-32, 32]) + rng.range(-3, 3), cz + rng.range(-50, 50));
  for (const u of [-32, 0, 32]) {
    b.lamp(cx + u + 4.5, cz - 52, NEON.cyan);
    b.lamp(cx - 52, cz + u + 4.5, NEON.magenta);
  }
}

function rusthaven(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  const rust = 0x5a3a2a;
  // Two big warehouses with catwalks.
  for (const [wx, wz] of [[-28, -28], [26, 22]] as const) {
    const x0 = cx + wx - 15;
    const z0 = cz + wz - 10;
    const w = 30;
    const d = 20;
    const h = 9;
    const door = (c: number) => [[c - 2.5, c + 2.5, -1, 4.5]];
    b.wall("x", x0, x0 + w, z0, z0 + 0.4, 0, h, [...door(x0 + w / 2), [x0 + 4, x0 + 6, 5.6, 7], [x0 + 24, x0 + 26, 5.6, 7]], Mat.PANEL, rust);
    b.wall("x", x0, x0 + w, z0 + d - 0.4, z0 + d, 0, h, [...door(x0 + 8), [x0 + 18, x0 + 20, 5.6, 7]], Mat.PANEL, rust);
    b.wall("z", z0, z0 + d, x0, x0 + 0.4, 0, h, [[z0 + 8, z0 + 12, -1, 3]], Mat.PANEL, rust);
    b.wall("z", z0, z0 + d, x0 + w - 0.4, x0 + w, 0, h, [[z0 + 9, z0 + 11, 5.6, 7]], Mat.PANEL, rust);
    b.box(x0, h, z0, x0 + w, h + 0.4, z0 + d, Mat.METAL, 0x3a2e2a);
    // Catwalk along the north wall + stairs.
    b.box(x0 + 0.4, 4.6, z0 + 0.4, x0 + w - 0.4, 5, z0 + 2.6, Mat.METAL, 0x4a4a52);
    b.box(x0 + 0.4, 5, z0 + 2.55, x0 + w - 0.4, 6, z0 + 2.65, Mat.FENCE, 0x8899aa, BoxFlag.BULLET_PASS);
    b.stairs(x0 + 2, z0 + 4, "x", 1, 1.6, 0, 5, Mat.METAL, 0x4a4a52);
    b.box(x0 + 7.9, 4.6, z0 + 2.6, x0 + 9.5, 5, z0 + 4.8, Mat.METAL, 0x4a4a52);
    // Interior cover: crate stacks and machinery.
    for (let i = 0; i < 6; i++) {
      const px = x0 + 4 + rng.range(0, w - 8);
      const pz = z0 + 6 + rng.range(0, d - 9);
      b.crate(px, pz, 1.4);
      if (rng.chance(0.5)) b.crate(px, pz, 1.2, 1.4);
    }
    b.block(x0 + w * 0.7, z0 + d * 0.6, 4, 3, 2.4, Mat.METAL, 0x55606a);
    b.light(x0 + w / 2, 8, z0 + d / 2, NEON.orange, 1);
    b.spot(x0 + w / 2, 5.05, z0 + 1.5);
    b.spot(x0 + w * 0.3, 0.05, z0 + d * 0.6);
    b.sign(x0 + w / 2, 7.4, z0 + d + 0.1, 10, 1.6, 2, NEON.orange, "RUSTHAVEN IRONWORKS");
    b.barrel(x0 + 2, z0 + d - 2);
    b.barrel(x0 + w - 3, z0 + 6);
  }
  // Factory block with smokestacks (landmark).
  b.building(cx + 14, cz - 46, 22, 14, { floors: 2, color: 0x4a3328, mat: Mat.PANEL, neon: NEON.orange, doors: ["s", "w"], sign: "FOUNDRY 7" });
  for (const [sx, h] of [[18, 34], [26, 42], [34, 30]] as const) {
    b.block(cx + sx, cz - 28, 3.2, 3.2, h, Mat.CONCRETE, 0x5a4a44);
    b.decor(cx + sx - 1.7, h - 2, cz - 29.7, cx + sx + 1.7, h - 1.6, cz - 26.3, Mat.NEON, NEON.red);
    b.light(cx + sx, h + 1, cz - 28, NEON.red, 1.2);
  }
  // Scrapyard with fences and scrap piles.
  b.fence(cx - 50, cz + 12, cx - 10, cz + 12.1);
  b.fence(cx - 50, cz + 12, cx - 49.9, cz + 50);
  for (let i = 0; i < 18; i++) {
    const px = cx - 46 + rng.range(0, 34);
    const pz = cz + 16 + rng.range(0, 32);
    const s = rng.range(1.2, 3);
    b.block(px, pz, s, s * rng.range(0.8, 1.8), rng.range(0.8, 2.4), Mat.METAL, rng.pick([0x5a4030, 0x4a4a50, 0x6a3020]));
  }
  for (let i = 0; i < 4; i++) b.car(cx - 40 + i * 8, cz + 46, false, 0x5a3a2a);
  // Container stacks.
  for (let i = 0; i < 5; i++) {
    const px = cx - 6 + i * 7;
    const col = rng.pick([0xa83a2a, 0x2a6aa8, 0x3a8a4a, 0xc89a2a]);
    b.container(px, cz - 8, false, col);
    if (i % 2 === 0) b.container(px, cz - 8, false, rng.pick([0xa83a2a, 0x2a6aa8]), 2.6);
  }
  b.ladder(cx - 6, cz - 4.95, 0, 5.2, "s");
  b.spot(cx - 6, 5.25, cz - 8);
  for (let i = 0; i < 8; i++) b.barrel(cx + rng.range(-50, 50), cz + rng.range(-4, 6));
  // Water tower with ladder.
  b.block(cx + 46, cz - 10, 0.5, 0.5, 10, Mat.METAL, 0x444444);
  b.block(cx + 50, cz - 10, 0.5, 0.5, 10, Mat.METAL, 0x444444);
  b.block(cx + 48, cz - 10, 6, 6, 0.4, Mat.METAL, 0x555560, 10);
  b.block(cx + 48, cz - 10, 4, 4, 4, Mat.METAL, 0x5a4a3a, 10.4);
  b.ladder(cx + 46, cz - 6.9, 0, 10.4, "s");
  b.box(cx + 45, 0, cz - 7.2, cx + 47, 10, cz - 7.0, Mat.METAL, 0x444444, BoxFlag.DECOR);
  b.spot(cx + 50.4, 10.45, cz - 12.4);
}

function eclipseHarbor(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  // Quay edge & piers into the electrified water.
  const edgeX = cx + 30;
  b.decor(edgeX - 0.3, 0, cz - 46, edgeX + 0.1, 0.25, cz + 42, Mat.NEON, NEON.cyan);
  for (const pz of [-30, -6, 18]) {
    b.box(edgeX, -1, cz + pz - 4, edgeX + 26, 0, cz + pz + 4, Mat.WOOD, 0x4a3a2e);
    b.block(edgeX + 24, cz + pz, 1, 1, 1, Mat.METAL, 0x666a70);
    b.crate(edgeX + 10, cz + pz + 2, 1.3);
    b.light(edgeX + 25, 1.6, cz + pz, NEON.cyan, 0.7);
    b.spot(edgeX + 18, 0.05, cz + pz - 1);
  }
  // Moored cargo ship with accessible deck.
  const sx0 = edgeX + 8;
  const sz0 = cz + 26;
  b.box(sx0, -3, sz0, sx0 + 40, 5.5, sz0 + 12, Mat.METAL, 0x2a3a4a);
  b.box(sx0 + 30, 5.5, sz0 + 1, sx0 + 38, 12, sz0 + 11, Mat.PANEL, 0xd0d4dc);
  b.sign(sx0 + 30 - 0.08, 10, sz0 + 6, 6, 1.4, 1, NEON.cyan, "ECLIPSE LINE");
  b.container(sx0 + 8, sz0 + 6, true, 0xc8402a, 5.5);
  b.container(sx0 + 16, sz0 + 3.5, true, 0x2a6aa8, 5.5);
  b.container(sx0 + 16, sz0 + 8.5, true, 0xc89a2a, 5.5);
  b.container(sx0 + 23, sz0 + 6, true, 0x3a8a4a, 5.5);
  b.stairs(sx0 - 0.1, sz0 - 6, "z", 1, 2, 0, 5.5, Mat.METAL, 0x555a66);
  b.box(sx0 - 1.1, -1, sz0 - 6.2, sx0 + 0.9, 0, sz0, Mat.WOOD, 0x4a3a2e);
  b.spot(sx0 + 12, 5.55, sz0 + 6);
  b.spot(sx0 + 34, 12.05, sz0 + 6);
  b.ladder(sx0 + 34, sz0 + 0.95, 5.5, 12, "n");

  // Container yard.
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 5; col++) {
      if (rng.chance(0.18)) continue;
      const px = cx - 44 + col * 13;
      const pz = cz - 40 + row * 11;
      const c1 = rng.pick([0xc8402a, 0x2a6aa8, 0xc89a2a, 0x3a8a4a, 0x8a3aa8, 0x2aa8a0]);
      b.container(px, pz, true, c1);
      const stack = rng.int(0, 2);
      for (let s = 1; s <= stack; s++) b.container(px + rng.pick([0, 0, 1.5]), pz, true, rng.pick([0xc8402a, 0x2a6aa8, 0xc89a2a]), s * 2.6);
      if (stack >= 1 && rng.chance(0.5)) {
        b.ladder(px - 3.05, pz, 0, stack * 2.6 + 2.6, "w");
        b.spot(px, stack * 2.6 + 2.65, pz);
      }
    }
  // Gantry crane (landmark) spanning the yard.
  const gx = cx - 18;
  for (const lz of [-46, 4]) {
    b.block(gx - 12, cz + lz, 1.4, 1.4, 30, Mat.METAL, 0xd8a020);
    b.block(gx + 12, cz + lz, 1.4, 1.4, 30, Mat.METAL, 0xd8a020);
  }
  b.box(gx - 13, 30, cz - 47, gx - 11, 32, cz + 5, Mat.METAL, 0xd8a020);
  b.box(gx + 11, 30, cz - 47, gx + 13, 32, cz + 5, Mat.METAL, 0xd8a020);
  b.box(gx - 13, 30, cz - 22, gx + 13, 32, cz - 18, Mat.METAL, 0xd8a020);
  b.block(gx, cz - 20, 4, 4, 3, Mat.PANEL, 0x303844, 27);
  b.ladder(gx - 12, cz + 4.7, 0, 30, "s");
  b.spot(gx - 12, 32.05, cz - 30);
  b.light(gx, 33, cz - 20, NEON.red, 1.2);
  for (const lz of [-46, 4]) b.light(gx - 12, 31, cz + lz, NEON.yellow, 0.7);
  // Port authority office & sheds.
  b.building(cx - 50, cz + 18, 16, 12, { floors: 2, color: 0x2a3444, neon: NEON.cyan, doors: ["e", "n"], sign: "PORT AUTHORITY" });
  b.building(cx - 26, cz + 24, 12, 10, { floors: 1, color: 0x3a3a44, mat: Mat.PANEL, neon: NEON.green, doors: ["n", "e"] });
  b.building(cx + 2, cz + 22, 14, 10, { floors: 1, color: 0x34303a, mat: Mat.PANEL, neon: NEON.orange, doors: ["w", "n"], sign: "DOCK 9" });
  for (let i = 0; i < 10; i++) b.barrel(cx + rng.range(-40, 25), cz + rng.range(-35, 15));
  for (let i = 0; i < 6; i++) b.crate(cx + rng.range(-48, 26), cz + rng.range(-48, 40), 1.3);
  b.car(cx - 10, cz + 36, true, 0xd8a020);
  b.car(cx + 12, cz + 38, true, 0x2a6aa8);
}

function sectorZero(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  const wallCol = 0x3a4440;
  // Perimeter wall with gates.
  const r = 52;
  const gate = (c: number) => [[c - 4, c + 4, -1, 6]];
  b.wall("x", cx - r, cx + r, cz - r, cz - r + 0.6, 0, 4, gate(cx), Mat.CONCRETE, wallCol);
  b.wall("x", cx - r, cx + r, cz + r - 0.6, cz + r, 0, 4, gate(cx - 20), Mat.CONCRETE, wallCol);
  b.wall("z", cz - r, cz + r, cx - r, cx - r + 0.6, 0, 4, gate(cz - 10), Mat.CONCRETE, wallCol);
  b.wall("z", cz - r, cz + r, cx + r - 0.6, cx + r, 0, 4, gate(cz + 10), Mat.CONCRETE, wallCol);
  b.neonRect(cx - r, cz - r, cx + r, cz + r, 4, NEON.green, 0.05);
  b.sign(cx, 5.2, cz - r - 0.1, 12, 1.4, 3, NEON.green, "SECTOR ZERO — RESTRICTED");
  // Containment dome (stepped), landmark.
  for (let i = 0; i < 6; i++) {
    const s = 22 - i * 3.2;
    b.block(cx - 26, cz - 24, s, s, 2.6, Mat.PANEL, i % 2 ? 0x2a4a3a : 0x34584a, i * 2.6);
  }
  b.decor(cx - 27, 15.6, cz - 25, cx - 25, 22, cz - 23, Mat.NEON, NEON.green);
  b.light(cx - 26, 20, cz - 24, NEON.green, 1.6);
  b.stairs(cx - 26, cz - 38.6, "z", 1, 2, 0, 2.6, Mat.METAL, 0x445048);
  b.spot(cx - 26, 2.65, cz - 34.2);
  // Radar mast with ladder.
  b.block(cx + 38, cz - 38, 2, 2, 22, Mat.METAL, 0x5a6060);
  b.block(cx + 38, cz - 38, 7, 7, 0.4, Mat.METAL, 0x6a7070, 14);
  b.block(cx + 38, cz - 38, 5, 0.4, 3, Mat.PANEL, 0xa0a8a8, 22);
  b.ladder(cx + 38, cz - 36.95, 0, 14.4, "s");
  b.spot(cx + 40, 14.45, cz - 40);
  // Lab buildings.
  b.building(cx + 6, cz - 44, 18, 12, { floors: 2, color: 0x2e3a38, neon: NEON.green, doors: ["s", "w"], sign: "LAB A" });
  b.building(cx + 24, cz - 16, 14, 14, { floors: 3, color: 0x2a3436, neon: NEON.cyan, doors: ["w", "s"], sign: "ZETA BIOTECH" });
  b.building(cx - 44, cz + 8, 14, 12, { floors: 2, color: 0x30383a, neon: NEON.green, doors: ["e", "n"], sign: "LAB C" });

  // Underground lab: pit [cx-18, cz+6]..[cx+18, cz+30], floor at y=-5.
  const px0 = cx - 18;
  const px1 = cx + 18;
  const pz0 = cz + 6;
  const pz1 = cz + 30;
  const D = -5;
  b.box(px0, D - 1, pz0, px1, D, pz1, Mat.PANEL, 0x2a3030);
  b.box(px0, D, pz0, px0 + 0.5, 0, pz1, Mat.CONCRETE, 0x30383a);
  b.box(px1 - 0.5, D, pz0, px1, 0, pz1, Mat.CONCRETE, 0x30383a);
  b.box(px0, D, pz0, px1, 0, pz0 + 0.5, Mat.CONCRETE, 0x30383a);
  b.box(px0, D, pz1 - 0.5, px1, 0, pz1, Mat.CONCRETE, 0x30383a);
  // Ceiling over the middle (the "underground" part), open at both ends for stairs.
  b.box(px0 + 7, -0.4, pz0, px1 - 7, 0, pz1, Mat.CONCRETE, 0x2a2e30);
  // Stair access from the surface at both open ends.
  b.stairs(px0 + 2, pz0 + 6.5, "z", -1, 3, D, 0, Mat.METAL, 0x445048);
  b.stairs(px1 - 2, pz1 - 6.5, "z", 1, 3, D, 0, Mat.METAL, 0x445048);
  // Partition walls & lab benches below ground.
  b.wall("z", pz0 + 0.5, pz1 - 0.5, cx - 4, cx - 3.7, D, -0.4, [[pz0 + 4, pz0 + 7, D - 1, D + 2.6], [pz1 - 8, pz1 - 5, D - 1, D + 2.6]], Mat.PANEL, 0x3a4444);
  b.wall("z", pz0 + 0.5, pz1 - 0.5, cx + 3.7, cx + 4, D, -0.4, [[pz0 + 10, pz0 + 13, D - 1, D + 2.6]], Mat.PANEL, 0x3a4444);
  for (let i = 0; i < 5; i++) b.block(cx + rng.range(-12, 12), pz0 + rng.range(4, 20), 2.4, 0.9, 1.0, Mat.METAL, 0x606a70, D);
  b.block(cx, pz0 + 12, 2.2, 2.2, 3, Mat.GLASS, 0x2aff8a, D);
  b.light(cx, D + 3, pz0 + 12, NEON.green, 1.5);
  b.light(cx - 10, D + 3, pz0 + 6, NEON.cyan, 0.8);
  b.light(cx + 10, D + 3, pz1 - 6, NEON.cyan, 0.8);
  b.spot(cx, D + 0.05, pz0 + 6);
  b.spot(cx - 9, D + 0.05, pz1 - 8);
  b.spot(cx + 9, D + 0.05, pz0 + 16);
  b.sign(cx, -1.2, pz0 + 0.55, 6, 0.9, 2, NEON.green, "SUBLEVEL 0");
  // Railings around the pit openings.
  b.box(px0 + 4, 0, pz0 - 0.2, px0 + 7, 1.0, pz0, Mat.METAL, 0x606a6a);
  b.box(px1 - 7, 0, pz1, px1 - 4, 1.0, pz1 + 0.2, Mat.METAL, 0x606a6a);
  // Surface cover: crates, barriers, wrecked trucks.
  for (let i = 0; i < 10; i++) {
    const x = cx + rng.range(-46, 46);
    const z = cz + rng.range(-46, 46);
    if (x > px0 - 2 && x < px1 + 2 && z > pz0 - 2 && z < pz1 + 2) continue;
    if (rng.chance(0.5)) b.barrier(x, z, rng.chance(0.5));
    else b.crate(x, z, 1.4, 0, 0x4a5048);
  }
  for (let i = 0; i < 6; i++) b.barrel(cx + rng.range(-45, 45), cz + rng.range(-45, -2));
  b.car(cx + 30, cz + 40, true, 0x3a4a3a);
  b.car(cx - 34, cz - 2, false, 0x3a4a3a);
}

function chromeValley(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  // Elevated highway running east-west at y=8.
  const hz = cz - 18;
  const H = 8;
  b.box(cx - 64, H - 0.6, hz - 7, cx + 64, H, hz + 7, Mat.CONCRETE, 0x40404c);
  b.wall("x", cx - 64, cx + 64, hz - 7, hz - 6.6, H, H + 1, [[cx + 36.4, cx + 38.4, H - 1, H + 2]], Mat.CONCRETE, 0x5a5a66);
  b.wall("x", cx - 64, cx + 64, hz + 6.6, hz + 7, H, H + 1, [[cx - 38.4, cx - 36.4, H - 1, H + 2]], Mat.CONCRETE, 0x5a5a66);
  b.decor(cx - 64, H + 1, hz - 7, cx + 64, H + 1.06, hz - 6.9, Mat.NEON, NEON.yellow);
  b.decor(cx - 64, H + 1, hz + 6.9, cx + 64, H + 1.06, hz + 7, Mat.NEON, NEON.yellow);
  for (let x = cx - 56; x <= cx + 56; x += 16) b.block(x, hz, 2, 6, H - 0.6, Mat.CONCRETE, 0x3a3a44);
  b.sign(cx - 20, H + 4, hz + 7.1, 9, 2, 2, NEON.green, "CHROME VALLEY EXPWY");
  b.box(cx - 24.5, H + 1, hz + 6.95, cx - 15.5, H + 3, hz + 7.05, Mat.METAL, 0x30303a, BoxFlag.DECOR);
  // Stair access at both ends and a ladder mid-span.
  b.stairs(cx - 48, hz + 9.5, "x", 1, 2.5, 0, H, Mat.CONCRETE, 0x50505c);
  b.box(cx - 48 + 9.6, 0, hz + 7, cx - 48 + 11.6, H, hz + 11, Mat.CONCRETE, 0x50505c);
  b.stairs(cx + 48, hz - 9.5, "x", -1, 2.5, 0, H, Mat.CONCRETE, 0x50505c);
  b.box(cx + 48 - 11.6, 0, hz - 11, cx + 48 - 9.6, H, hz - 7, Mat.CONCRETE, 0x50505c);
  b.ladder(cx + 8, hz + 7, 0, H, "s");
  // Wrecked convoy on the deck.
  for (let i = 0; i < 7; i++) {
    const x = cx + rng.range(-56, 56);
    const z = hz + rng.range(-4.5, 4.5);
    if (rng.chance(0.6)) b.car(x, z, true, rng.pick([0x6a6a70, 0x8a1f3a, 0x1f4a8a]), H);
    else b.block(x, z, 8, 2.6, 3, Mat.METAL, 0x50565e, H);
  }
  for (let i = 0; i < 6; i++) b.block(cx + rng.range(-50, 50), hz + rng.pick([-3, 3]), 3, 0.6, 1, Mat.CONCRETE, 0x8a8f9e, H);
  b.spot(cx - 30, H + 0.05, hz);
  b.spot(cx + 22, H + 0.05, hz + 2);
  b.light(cx, H + 3, hz, NEON.yellow, 0.8);

  // Tunnel through a concrete hill (north-south).
  const tx = cx - 36;
  const tz = cz + 24;
  b.box(tx - 14, 0, tz - 18, tx - 3, 9, tz + 18, Mat.ROCK, 0x3a3640);
  b.box(tx + 3, 0, tz - 18, tx + 14, 9, tz + 18, Mat.ROCK, 0x3a3640);
  b.box(tx - 3, 5.5, tz - 18, tx + 3, 9, tz + 18, Mat.ROCK, 0x3a3640);
  for (let z = tz - 15; z <= tz + 15; z += 6) {
    b.decor(tx - 3, 4.9, z - 0.4, tx - 2.9, 5.1, z + 0.4, Mat.NEON, NEON.orange);
    b.decor(tx + 2.9, 4.9, z - 0.4, tx + 3, 5.1, z + 0.4, Mat.NEON, NEON.orange);
    b.light(tx, 5, z, NEON.orange, 0.5);
  }
  b.car(tx + 1, tz - 4, false, 0x5a5a60);
  b.block(tx - 1.3, tz + 8, 2.2, 7, 2.8, Mat.METAL, 0x6a5a40);
  b.sign(tx, 7, tz - 18.1, 5, 1.2, 3, NEON.orange, "TUNNEL 3");
  b.stairs(tx + 24.8, tz + 12, "x", -1, 3, 0, 9, Mat.CONCRETE, 0x4a4650);
  b.spot(tx + 8, 9.05, tz - 8);

  // Canal bridges (canal trench at cx+20..cx+28).
  for (const bz of [-44, 6, 42]) {
    b.box(cx + 19, -0.4, cz + bz - 3, cx + 29, 0, cz + bz + 3, Mat.CONCRETE, 0x50505c);
    b.box(cx + 19, 0, cz + bz - 3, cx + 29, 1, cz + bz - 2.8, Mat.METAL, 0x707080);
    b.box(cx + 19, 0, cz + bz + 2.8, cx + 29, 1, cz + bz + 3, Mat.METAL, 0x707080);
  }
  b.ladder(cx + 20.4, cz - 20, -3, 0, "e");
  b.ladder(cx + 27.6, cz + 24, -3, 0, "w");
  b.spot(cx + 24, -2.95, cz - 10);
  // Toll plaza & gas station.
  for (let i = 0; i < 4; i++) {
    b.block(cx - 2 + i * 6, cz + 44, 1.6, 3, 2.6, Mat.PANEL, 0x30384a);
    b.decor(cx - 2.8 + i * 6, 2.6, cz + 42.5, cx - 1.2 + i * 6, 2.7, cz + 45.5, Mat.NEON, NEON.green);
  }
  b.box(cx + 34, 4.5, cz + 26, cx + 54, 5, cz + 42, Mat.METAL, 0x30303a);
  for (const [px, pz] of [[36, 28], [52, 28], [36, 40], [52, 40]] as const) b.block(cx + px, cz + pz, 0.5, 0.5, 4.5, Mat.METAL, 0x50505a);
  b.neonRect(cx + 34, cz + 26, cx + 54, cz + 42, 5, NEON.red, 0.1);
  b.block(cx + 44, cz + 34, 6, 1.2, 1.6, Mat.PANEL, 0x404858);
  b.building(cx + 40, cz + 46, 12, 9, { floors: 1, color: 0x3a3440, neon: NEON.red, doors: ["n", "w"], sign: "FUEL-X" });
  for (let i = 0; i < 4; i++) b.barrel(cx + 37 + i * 4, cz + 31);
  // Ground-level wrecks.
  for (let i = 0; i < 8; i++) b.car(cx + rng.range(-50, 15), cz + rng.range(-4, 44), rng.chance(0.5), rng.pick([0x4a4a50, 0x6a2a2a, 0x2a4a6a]));
}

function outlands(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  // Terraced ridges.
  b.hill(cx - 30, cz - 30, 16, 12, 6, Mat.DIRT, 0x4a3e58);
  b.hill(cx + 26, cz + 28, 14, 18, 7, Mat.DIRT, 0x4a3e58);
  b.hill(cx - 34, cz + 34, 10, 10, 4, Mat.ROCK, 0x3e3a4a);
  // Rocks.
  for (let i = 0; i < 22; i++) {
    const s = rng.range(1, 3.2);
    b.block(cx + rng.range(-54, 54), cz + rng.range(-54, 54), s, s * rng.range(0.7, 1.4), s * rng.range(0.5, 1.1), Mat.ROCK, 0x45405a);
  }
  // Giant comms tower (landmark) with two platforms.
  const tx = cx + 4;
  const tz = cz - 4;
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) b.block(tx + dx, tz + dz, 0.5, 0.5, 42, Mat.METAL, 0x5a5a6a);
  b.block(tx, tz, 7, 7, 0.4, Mat.METAL, 0x606070, 8);
  b.block(tx, tz, 7, 7, 0.4, Mat.METAL, 0x606070, 16);
  b.box(tx - 3.5, 8.4, tz - 3.5, tx + 3.5, 9.4, tz - 3.4, Mat.METAL, 0x707080);
  b.box(tx - 3.5, 16.4, tz + 3.4, tx + 3.5, 17.4, tz + 3.5, Mat.METAL, 0x707080);
  b.ladder(tx, tz + 3.5, 0, 8.4, "s");
  b.ladder(tx + 3.5, tz, 8.4, 16.4, "e");
  for (let y = 4; y < 42; y += 6) b.neonRect(tx - 2.3, tz - 2.3, tx + 2.3, tz + 2.3, y, NEON.violet, 0.05);
  b.light(tx, 43, tz, NEON.red, 2);
  b.spot(tx - 2, 8.45, tz - 2);
  b.spot(tx + 2, 16.45, tz + 1);
  // Satellite dish.
  b.block(cx + 40, cz - 40, 1.2, 1.2, 5, Mat.METAL, 0x606070);
  b.block(cx + 40, cz - 40, 8, 1, 6, Mat.PANEL, 0xb0b8c8, 5);
  // Settlement huts.
  const huts: [number, number][] = [[-44, -2], [-30, 6], [-46, 14], [-20, -12], [40, -8], [44, 8]];
  for (const [hx, hz] of huts) {
    b.building(cx + hx - 4.5, cz + hz - 3.5, 9, 7, { floors: 1, color: 0x4a4048, mat: Mat.PANEL, doors: ["s", "e"], neon: rng.pick(NEON_LIST), roofAccess: false, parapet: 0.4 });
  }
  b.sign(cx - 44, 3.3, cz + 1.1, 3, 0.8, 2, NEON.violet, "OUTPOST");
  // Wind turbines (decor towers) and a water tank.
  for (const [wx, wz] of [[-50, -50], [50, -26], [50, 48]] as const) {
    b.block(cx + wx, cz + wz, 0.9, 0.9, 24, Mat.METAL, 0xb0b8c8);
    b.decor(cx + wx - 0.2, 23, cz + wz - 7, cx + wx + 0.2, 24, cz + wz + 7, Mat.PANEL, 0xc8d0e0);
    b.light(cx + wx, 24.5, cz + wz, NEON.red, 0.8);
  }
  b.fence(cx - 54, cz - 16, cx - 14, cz - 15.9);
  for (let i = 0; i < 5; i++) b.barrel(cx + rng.range(-50, -14), cz + rng.range(-14, 20));
  b.car(cx - 10, cz + 10, true, 0x5a4a3a);
  b.car(cx + 14, cz - 30, false, 0x4a4a5a);
}

function blacklight(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  // Pagoda landmark in the central courtyard.
  for (let i = 0; i < 6; i++) {
    const s = 9 - i * 1.2;
    b.block(cx, cz, s, s, 3.5, i % 2 ? Mat.PANEL : Mat.FACADE, 0x3a1a28, i * 3.5);
    b.decor(cx - s / 2 - 0.8, i * 3.5 + 3.2, cz - s / 2 - 0.8, cx + s / 2 + 0.8, i * 3.5 + 3.4, cz + s / 2 + 0.8, Mat.NEON, i % 2 ? NEON.red : NEON.orange);
  }
  b.light(cx, 22, cz, NEON.red, 1.8);
  b.sign(cx, 6, cz + 4.6, 4, 1.2, 2, NEON.red, "BLACKLIGHT");
  // Dense shop grid with narrow lanes (12 m lattice, ~8 m shops).
  for (let gx = -4; gx <= 4; gx++)
    for (let gz = -4; gz <= 4; gz++) {
      if (Math.abs(gx) <= 1 && Math.abs(gz) <= 1) continue; // courtyard
      if (gx === 0 || gz === 0) continue; // main cross lanes
      const x = cx + gx * 12.5 + rng.range(-1, 1);
      const z = cz + gz * 12.5 + rng.range(-1, 1);
      const r = rng.next();
      const color = rng.pick([0x2a1e2e, 0x30222a, 0x1e2230, 0x2a2a22]);
      const neon = rng.pick(NEON_LIST);
      if (r < 0.42) {
        b.building(x - 4.75, z - 4, 9.5, 8, { floors: rng.int(1, 2), color, neon, doors: [rng.pick(["n", "s"] as const), rng.pick(["e", "w"] as const)], sign: rng.pick(SIGN_WORDS) });
      } else if (r < 0.75) {
        b.block(x, z, 8, 8, rng.int(5, 12), Mat.FACADE, color);
        b.sign(x, 3.2, z + 4.08, 5, 1, 2, neon, rng.pick(SIGN_WORDS));
        b.sign(x + 4.08, 6, z, 0.9, 3, 0, rng.pick(NEON_LIST), rng.pick(SIGN_WORDS), "strip");
      } else {
        // Open stall with canopy (canopy is solid — climbable from the counter).
        b.block(x, z - 1.5, 5, 1.2, 1.1, Mat.WOOD, 0x5a3a2a);
        b.box(x - 3, 3, z - 3.5, x + 3, 3.2, z + 1, Mat.PANEL, rng.pick([0x8a1f3a, 0x1f6a8a, 0x8a6a1f]));
        b.decor(x - 3, 2.9, z - 3.55, x + 3, 3.0, z - 3.45, Mat.NEON, neon);
        b.crate(x + 1.5, z + 2, 1);
        b.light(x, 2.6, z - 1.5, neon, 0.6);
        b.spot(x, 0.05, z + 0.5);
      }
    }
  // Hanging lantern lines over the lanes (decor).
  for (let u = -50; u <= 50; u += 7) {
    b.decor(cx + u, 5.5, cz - 0.05, cx + u + 0.3, 5.8, cz + 0.05, Mat.NEON, rng.pick([NEON.red, NEON.orange, NEON.magenta]));
    b.decor(cx - 0.05, 5.5, cz + u, cx + 0.05, 5.8, cz + u + 0.3, Mat.NEON, rng.pick([NEON.red, NEON.orange, NEON.magenta]));
  }
  for (let i = 0; i < 12; i++) b.crate(cx + rng.pick([-1, 1]) * rng.range(3, 50), cz + rng.range(-1.8, 1.8), rng.range(0.9, 1.3));
  for (let i = 0; i < 6; i++) b.barrel(cx + rng.range(-1.8, 1.8), cz + rng.pick([-1, 1]) * rng.range(8, 50));
  for (let i = 0; i < 4; i++) b.lamp(cx + rng.pick([-1, 1]) * rng.range(12, 50), cz + 2.2, rng.pick(NEON_LIST), 4.5);
}

function skyrail(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  // Elevated viaduct running north-south at y=7 with platforms.
  const vx = cx + 10;
  const H = 7;
  b.box(vx - 6, H - 0.6, cz - 64, vx + 6, H, cz + 64, Mat.CONCRETE, 0x3c3c4a);
  for (let z = cz - 58; z <= cz + 58; z += 14) b.block(vx, z, 5, 2, H - 0.6, Mat.CONCRETE, 0x34343e);
  // Rails.
  for (const rx of [-3.5, -2, 2, 3.5]) b.decor(vx + rx - 0.08, H, cz - 64, vx + rx + 0.08, H + 0.15, cz + 64, Mat.METAL, 0x9aa0b4);
  b.decor(vx - 0.1, H, cz - 64, vx + 0.1, H + 0.05, cz + 64, Mat.NEON, NEON.cyan);
  // Platforms on both sides of the track around the station.
  b.box(vx - 12, H - 0.6, cz - 24, vx - 6, H, cz + 24, Mat.CONCRETE, 0x4a4a58);
  b.box(vx + 6, H - 0.6, cz - 24, vx + 12, H, cz + 24, Mat.CONCRETE, 0x4a4a58);
  b.decor(vx - 6.3, H, cz - 24, vx - 6, H + 0.04, cz + 24, Mat.NEON, NEON.yellow);
  b.decor(vx + 6, H, cz - 24, vx + 6.3, H + 0.04, cz + 24, Mat.NEON, NEON.yellow);
  for (let z = cz - 20; z <= cz + 20; z += 10) {
    b.block(vx - 9, z, 0.5, 0.5, 4, Mat.METAL, 0x606070, H);
    b.block(vx + 9, z, 0.5, 0.5, 4, Mat.METAL, 0x606070, H);
  }
  b.box(vx - 12.5, H + 4, cz - 24, vx - 5.5, H + 4.3, cz + 24, Mat.PANEL, 0x30344a);
  b.box(vx + 5.5, H + 4, cz - 24, vx + 12.5, H + 4.3, cz + 24, Mat.PANEL, 0x30344a);
  for (let z = cz - 22; z <= cz + 22; z += 11) {
    b.block(vx - 10, z, 2, 0.6, 1, Mat.PANEL, 0x50566a, H);
    b.block(vx + 10, z + 5, 2, 0.6, 1, Mat.PANEL, 0x50566a, H);
  }
  b.sign(vx - 12.55, H + 2.6, cz, 10, 1.6, 1, NEON.white, "SKYRAIL CENTRAL");
  b.sign(vx + 12.55, H + 2.6, cz, 10, 1.6, 0, NEON.cyan, "LINE 7 — ORBITAL");
  b.spot(vx - 9, H + 0.05, cz - 10);
  b.spot(vx + 9, H + 0.05, cz + 12);
  // Trains parked on the track (cover on the viaduct).
  b.block(vx - 1.6, cz - 6, 3, 18, 3.4, Mat.METAL, 0xc8ccd8, H);
  b.decor(vx - 3.15, H + 1.6, cz - 15, vx - 3.05, H + 1.9, cz + 3, Mat.NEON, NEON.cyan);
  b.block(vx + 1.6, cz + 30, 3, 16, 3.4, Mat.METAL, 0xc8ccd8, H);
  b.decor(vx + 3.05, H + 1.6, cz + 22, vx + 3.15, H + 1.9, cz + 38, Mat.NEON, NEON.magenta);
  // Stairs up to platforms (west side from the concourse, east side from the street).
  b.stairs(vx - 20.4, cz - 22, "x", 1, 2.5, 0, H, Mat.CONCRETE, 0x50505c);
  b.stairs(vx + 20.4, cz + 20, "x", -1, 2.5, 0, H, Mat.CONCRETE, 0x50505c);
  b.ladder(vx - 12, cz + 18, 0, H, "w");
  b.ladder(vx + 6, cz + 50, 0, H, "e");
  // Concourse hall (enterable, 2 floors).
  b.building(cx - 46, cz - 14, 26, 18, { floors: 2, color: 0x262c40, neon: NEON.white, doors: ["e", "s", "n"], sign: "SKYRAIL" });
  // Clock tower landmark.
  b.block(cx - 33, cz + 16, 5, 5, 30, Mat.FACADE, 0x22283a);
  b.sign(cx - 33, 26, cz + 18.55, 4, 4, 2, NEON.white, "07:77", "holo");
  b.light(cx - 33, 31, cz + 16, NEON.white, 1.4);
  // Underpass ticket gates and waiting area.
  for (let z = cz - 10; z <= cz + 10; z += 4) b.block(vx - 3.5, z, 0.4, 1.6, 1.1, Mat.PANEL, 0x40465a);
  for (let i = 0; i < 6; i++) b.block(cx + rng.range(-44, -16), cz + rng.range(10, 50), 3, 0.8, 0.9, Mat.METAL, 0x50566a);
  b.building(cx + 32, cz - 50, 14, 10, { floors: 2, color: 0x2a2a3a, neon: NEON.cyan, doors: ["w", "s"], sign: "RAILYARD OPS" });
  b.building(cx - 50, cz + 34, 12, 12, { floors: 2, color: 0x2e2a3a, neon: NEON.magenta, doors: ["e", "n"], sign: "HOTEL ORBIT" });
  for (let i = 0; i < 6; i++) b.car(cx + rng.range(34, 50), cz + rng.range(-30, 50), false, rng.pick([0xc8c8d0, 0x2a2a3a, 0x8a1f3a]));
  for (let i = 0; i < 5; i++) b.barrel(cx + rng.range(-50, 50), cz + rng.range(30, 55));
}

function bay(b: MapBuilder): void {
  // Decorative lighthouse and buoys in the electrified bay (not reachable).
  b.decor(150, -2, 150, 156, 26, 156, Mat.PANEL, 0xd0d4dc);
  b.decor(149, 26, 149, 157, 29, 157, Mat.NEON, NEON.yellow);
  b.light(153, 28, 153, NEON.yellow, 2.5);
  for (let i = 0; i < 6; i++) b.light(80 + i * 18, -0.8, 90 + (i % 3) * 30, NEON.cyan, 0.6);
  // Long pier from Blacklight Market (playable during BR).
  b.box(118, -1, 64, 126, 0, 104, Mat.WOOD, 0x4a3a2e);
  b.block(122, 102, 6, 2, 1.2, Mat.METAL, 0x50566a);
  b.light(122, 2, 103, NEON.cyan, 0.8);
  b.spot(122, 0.05, 96);
}
