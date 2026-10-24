import { CANDY, MapBuilder, FLOOR_H, TRIM, mix } from "./builder";
import type { Side } from "./builder";
import { CollisionWorld } from "./collision";
import { overlaps, stairVolumes } from "./stairs";
import { BoxFlag, Mat } from "./types";
import type { MapData, MatId, PickupSpot } from "./types";
import type { DistrictId } from "../types";
import { Rng } from "../rng";
import { GRAVITY, PLAYER_HEIGHT, PLAYER_RADIUS } from "../constants";
import type { Vec3 } from "../math";

/*
 * NEON FRONTIER — a sunny 384 m × 384 m region laid out as a 3×3 grid of
 * 128 m cells separated by streets. Eight districts plus the bay:
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

const BRIGHT = {
  sky: 0x4cc9f0, pink: 0xff70a6, purple: 0xb388ff, green: 0x5ee35e, orange: 0xff9f1c, red: 0xff595e, yellow: 0xffca3a, white: 0xffffff,
};
const ACCENTS = Object.values(BRIGHT);

const SIGN_WORDS = [
  "SODA POP", "NOODLES", "HOTEL SUNNY", "PIXEL CAFE", "LUCKY 8", "BUBBLE TEA", "ARCADE", "TACO TOWN", "RAMEN", "COMICS",
  "OPEN", "DONUTS", "GELATO", "BAKERY", "FLOWERS", "GAMES", "PIZZA", "BOOKS", "JUICE BAR", "SURF SHOP",
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
  neon_city: { name: "Neon City", tagline: "Downtown blocks, towers, rooftops and skybridges", accent: BRIGHT.pink },
  rusthaven: { name: "Rusthaven", tagline: "Brick workshops, warehouse halls and a smokestack foundry", accent: BRIGHT.orange },
  eclipse_harbor: { name: "Eclipse Harbor", tagline: "Harbour streets, a container maze, piers and a cargo ship", accent: BRIGHT.sky },
  sector_zero: { name: "Sector Zero", tagline: "Lab blocks around a sunken underground laboratory", accent: BRIGHT.green },
  chrome_valley: { name: "Chrome Valley", tagline: "Diners, motels and garages under an elevated highway", accent: BRIGHT.yellow },
  outlands: { name: "The Outlands", tagline: "A tight old-town village around a giant radio tower", accent: BRIGHT.purple },
  blacklight: { name: "Blacklight Market", tagline: "Lantern-lit market lanes full of shops and stalls", accent: BRIGHT.red },
  skyrail: { name: "Skyrail Station", tagline: "City blocks under an elevated railway and a grand concourse", accent: BRIGHT.white },
};

export const DISTRICT_IDS = Object.keys(META) as DistrictId[];
export const districtMeta = (id: DistrictId) => META[id];

let cached: MapData | null = null;

/** Returns the (memoized) generated region. */
export function getFrontierMap(): MapData {
  if (!cached) cached = generateFrontier();
  return cached;
}

const ROAD = 0x6b7280;
const SIDEWALK = 0xdcd6c8;

export function generateFrontier(): MapData {
  const b = new MapBuilder(1337);

  // Ground per cell (bay & harbor water handled separately).
  for (const c of CELLS) {
    if (c.id === "bay") continue;
    const groundMat = c.id === "rusthaven" || c.id === "sector_zero" || c.id === "eclipse_harbor" || c.id === "chrome_valley" ? Mat.ASPHALT : Mat.TILE;
    const groundColor =
      c.id === "outlands" ? 0xbfae92 : c.id === "blacklight" ? 0xc2a98f : c.id === "neon_city" || c.id === "skyrail" ? 0x8f97a8 : 0x8a92a0;
    const x0 = c.cx - CELL_SIZE / 2;
    const z0 = c.cz - CELL_SIZE / 2;
    const x1 = c.cx + CELL_SIZE / 2;
    const z1 = c.cz + CELL_SIZE / 2;
    if (c.id === "eclipse_harbor") {
      b.box(x0, -1, z0, x1 - 34, 0, z1 - 22, groundMat, groundColor);
      b.box(x1 - 34, -1, z0, x1, 0, z0 + 18, groundMat, groundColor);
    } else if (c.id === "sector_zero") {
      // Leave a pit for the underground lab (see sectorZero()).
      b.slab(x0, z0, x1, z1, -1, 0, groundMat, groundColor, [c.cx - 18, c.cz + 6, c.cx + 18, c.cz + 26]);
    } else {
      b.box(x0, -1, z0, x1, 0, z1, groundMat, groundColor);
    }
  }

  // Water: the bay plus the harbor's east channel and south basin.
  b.water.push({ minX: 64, minZ: 64, maxX: REGION, maxZ: REGION, level: -1.4 });
  b.water.push({ minX: 30, minZ: 82, maxX: 64, maxZ: REGION, level: -1.4 });
  b.water.push({ minX: -64, minZ: 170, maxX: 30, maxZ: REGION, level: -1.4 });

  // Street network: asphalt with white dashes, sidewalks, trees and lamps.
  const roadY = 0.02;
  for (const off of [-64, 64]) {
    const zEnd = off === 64 ? 64 : REGION;
    const xEnd = off === 64 ? 30 : REGION;
    b.decor(off - 6, 0, -REGION, off + 6, roadY, zEnd, Mat.ASPHALT, ROAD);
    b.roads.push({ minX: off - 6, minZ: -REGION, maxX: off + 6, maxZ: zEnd });
    b.decor(-REGION, 0, off - 6, xEnd, roadY, off + 6, Mat.ASPHALT, ROAD);
    b.roads.push({ minX: -REGION, minZ: off - 6, maxX: xEnd, maxZ: off + 6 });
    for (let u = -REGION + 4; u < REGION - 4; u += 8) {
      if (!(off === 64 && u > 60)) b.decor(off - 0.12, roadY, u, off + 0.12, roadY + 0.01, u + 4, Mat.PAINT, 0xffffff);
      if (!(off === 64 && u > 26)) b.decor(u, roadY, off - 0.12, u + 4, roadY + 0.01, off + 0.12, Mat.PAINT, 0xffffff);
    }
    // Zebra crossings at the intersections.
    for (const cross of [-64, 64]) {
      if (off === 64 && cross === 64) continue;
      for (let k = -5; k <= 5; k += 1.4) {
        b.decor(off + k - 0.35, roadY, cross - 7.5, off + k + 0.35, roadY + 0.012, cross - 6.2, Mat.PAINT, 0xffffff);
        b.decor(cross - 7.5, roadY, off + k - 0.35, cross - 6.2, roadY + 0.012, off + k + 0.35, Mat.PAINT, 0xffffff);
      }
    }
  }
  // Street lamps and trees along the main roads.
  for (let u = -180; u <= 180; u += 24) {
    for (const off of [-64, 64]) {
      if (!(off === 64 && u > 56)) {
        b.lamp(off + 6.6, u, 0xffd59a, 6.5);
        if (Math.abs(u + 12) < 176 && Math.abs(u + 12 - off) > 10) b.tree(off - 6.8, u + 12, 0.9);
      }
      if (!(off === 64 && u > 24)) {
        b.lamp(u, off - 6.6, 0xffd59a, 6.5);
        if (Math.abs(u + 12) < 176 && Math.abs(u + 12 - off) > 10 && !(off === 64 && u + 12 > 24)) b.tree(u + 12, off + 6.8, 0.9);
      }
    }
  }

  // Region boundary force fields.
  const W = 60;
  b.box(-REGION - 2, -10, -REGION - 2, REGION + 2, W, -REGION, Mat.BARRIER, 0x7bdff2);
  b.box(-REGION - 2, -10, REGION, REGION + 2, W, REGION + 2, Mat.BARRIER, 0x7bdff2);
  b.box(-REGION - 2, -10, -REGION, -REGION, W, REGION, Mat.BARRIER, 0x7bdff2);
  b.box(REGION, -10, -REGION, REGION + 2, W, REGION, Mat.BARRIER, 0x7bdff2);

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

  const ranges: Partial<Record<DistrictId, { spots: [number, number]; roofs: [number, number]; crates: [number, number] }>> = {};
  for (const c of CELLS) {
    if (c.id === "bay") continue;
    const s0 = b.spots.length;
    const r0 = b.roofs.length;
    const c0 = b.lootCrates.length;
    b.rng = new Rng(hashId(c.id));
    gens[c.id](b, c.cx, c.cz, b.rng);
    ranges[c.id] = { spots: [s0, b.spots.length], roofs: [r0, b.roofs.length], crates: [c0, b.lootCrates.length] };
  }
  bay(b);
  b.clearStairways();

  const map: MapData = {
    name: "Neon Frontier",
    minX: -REGION, minZ: -REGION, maxX: REGION, maxZ: REGION,
    boxes: b.boxes, ladders: b.ladders, signs: b.signs, lights: b.lights, water: b.water,
    districts: [], barrels: b.barrels, loot: [], roads: b.roads, jumpPads: b.jumpPads, crates: [], stairs: b.stairRuns,
  };

  // Placement pass: pads, crates, spawns, objectives and pickups are derived
  // from the real collision geometry so nothing ever lands inside a wall.
  const world = new CollisionWorld(map);
  // Entities (barrels, crates) and jump pads never go on a stairway either.
  const stairVols = b.stairRuns.flatMap(stairVolumes);
  const onStairs = (x: number, y: number, z: number, r: number) =>
    stairVols.some((v) => overlaps({ minX: x - r, maxX: x + r, minY: y, maxY: y + 1.2, minZ: z - r, maxZ: z + r }, v));
  map.barrels = map.barrels.flatMap((p) => {
    const y = world.groundHeight(p.x, p.z, p.y + 1.5);
    if (!isFinite(y) || Math.abs(y - p.y) > 0.7 || onStairs(p.x, y, p.z, 0.5)) return [];
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
    const r = ranges[c.id]!;
    const ground0 = sampleOpenGround(world, map, minX + 3, minZ + 3, maxX - 3, maxZ - 3, 3.5);
    placeJumpPads(b, world, map, b.roofs.slice(r.roofs[0], r.roofs[1]), ground0, rng, c.cx, c.cz, (x, y, z) => onStairs(x, y, z, 1.3));
    const nearPad = (p: Vec3) => b.jumpPads.some((j) => p.x > j.minX - 2 && p.x < j.maxX + 2 && p.z > j.minZ - 2 && p.z < j.maxZ + 2 && Math.abs(p.y - j.minY) < 2);
    const ground = ground0.filter((p) => !nearPad(p));
    const spawns = farthestPoints(ground, 18, rng);
    const points = [
      nearestOpen(ground, { x: c.cx - 34, y: 0, z: c.cz }),
      nearestOpen(ground, { x: c.cx, y: 0, z: c.cz }),
      nearestOpen(ground, { x: c.cx + 34, y: 0, z: c.cz }),
    ];
    const spots = b.spots.slice(r.spots[0], r.spots[1]).filter((p) => isFree(world, p) && !nearPad(p));
    const pickups = placePickups(ground, spots, points, rng, c.cx, c.cz);
    // Loot crates: explicitly placed ones plus a scatter in rooms and on streets.
    const wanted = [...b.lootCrates.slice(r.crates[0], r.crates[1]), ...pickRandom(spots, 6, rng), ...pickRandom(ground, 6, rng)];
    for (const p of wanted) {
      const q = { x: p.x + 0.9, y: p.y, z: p.z + 0.9 };
      const y = world.groundHeight(q.x, q.z, q.y + 1.2);
      if (!isFinite(y) || Math.abs(y - q.y) > 0.6 || nearPad(q) || onStairs(q.x, y, q.z, 0.5)) continue;
      if (world.overlaps({ minX: q.x - 0.5, maxX: q.x + 0.5, minY: y + 0.05, maxY: y + 1, minZ: q.z - 0.5, maxZ: q.z + 0.5 })) continue;
      if (pickups.some((pk) => Math.hypot(pk.pos.x - q.x, pk.pos.z - q.z) < 1.5 && Math.abs(pk.pos.y - y) < 2)) continue;
      if (spawns.some((sp) => Math.hypot(sp.x - q.x, sp.z - q.z) < 1.5)) continue;
      map.crates.push({ x: q.x, y, z: q.z });
    }
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

/**
 * Jump pads: rooftop launchers beside buildings (land on the roof) plus a
 * couple of vertical "bounce" pads in open squares for vantage and fun.
 */
function placeJumpPads(
  b: MapBuilder, world: CollisionWorld, map: MapData, roofs: MapBuilder["roofs"], ground: Vec3[], rng: Rng, cx: number, cz: number,
  onStairs: (x: number, y: number, z: number) => boolean,
): void {
  const pads: Vec3[] = [];
  const clear = (x: number, z: number, h: number): number | null => {
    const y = world.groundHeight(x, z, 2);
    if (!isFinite(y) || y < -0.1 || y > 0.6 || inWater(map, x, z) || onStairs(x, y, z)) return null;
    if (world.overlaps({ minX: x - 1.1, maxX: x + 1.1, minY: y + 0.05, maxY: y + h, minZ: z - 1.1, maxZ: z + 1.1 })) return null;
    if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < 12)) return null;
    return y;
  };
  const order = [...roofs].sort(() => rng.next() - 0.5);
  let n = 0;
  for (const r of order) {
    if (n >= 6) break;
    if (r.y > 16) continue;
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const sides: [number, number, number, number, number][] = [
      // x, z, dirX, dirZ, roof depth along launch
      [(r.x0 + r.x1) / 2, r.z1 + 2.4, 0, -1, d],
      [(r.x0 + r.x1) / 2, r.z0 - 2.4, 0, 1, d],
      [r.x1 + 2.4, (r.z0 + r.z1) / 2, -1, 0, w],
      [r.x0 - 2.4, (r.z0 + r.z1) / 2, 1, 0, w],
    ];
    for (const [x, z, dx, dz, depth] of sides.sort(() => rng.next() - 0.5)) {
      if (depth < 8) continue;
      const y = clear(x, z, r.y + 4);
      if (y === null) continue;
      // Apex 2.8 m above the roof; the body's leading edge (2 m away) reaches the
      // wall at 85% of the climb — well above the parapet — then lands just inside.
      const vy = Math.sqrt(2 * GRAVITY * (r.y - y + 2.8));
      const hs = 2.0 / (0.85 * (vy / GRAVITY));
      b.jumpPad(x, z, y, dx * hs, vy, dz * hs);
      pads.push({ x, y, z });
      n++;
      break;
    }
  }
  // Bounce pads near the centre of the district.
  const central = [...ground].sort((p, q) => Math.hypot(p.x - cx, p.z - cz) - Math.hypot(q.x - cx, q.z - cz));
  let bounces = 0;
  for (const g of central) {
    if (bounces >= 2) break;
    if (Math.hypot(g.x - cx, g.z - cz) < 10) continue;
    const y = clear(g.x, g.z, 9);
    if (y === null) continue;
    const toC = Math.atan2(cz - g.z, cx - g.x);
    b.jumpPad(g.x, g.z, y, Math.cos(toC) * 1.5, 15, Math.sin(toC) * 1.5);
    pads.push({ x: g.x, y, z: g.z });
    bounces++;
  }
}

function pickRandom<T>(arr: T[], n: number, rng: Rng): T[] {
  const out: T[] = [];
  for (let i = 0; i < n && arr.length; i++) out.push(arr[rng.int(0, arr.length - 1)]!);
  return out;
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
// Shared helpers
// ---------------------------------------------------------------------------

function shopSign(b: MapBuilder, rng: Rng, x: number, y: number, z: number, w: number, face: number): void {
  b.sign(x, y, z, w, 1.1, face, rng.pick(ACCENTS), rng.pick(SIGN_WORDS));
}

function bright(rng: Rng): number {
  return rng.pick(CANDY);
}

// ---------------------------------------------------------------------------
// Dense city grid (Krunker-style): every district is a 4×4 grid of 23 m
// blocks packed with buildings, separated by 7 m streets. Blocks are split
// into lots by 2 m alleys; enterable buildings get rooms and roof access,
// neighbouring roofs are linked by bridges across alleys and streets.
// ---------------------------------------------------------------------------

const BLOCK = 23;
const HALF_BLOCK = BLOCK / 2;
const STREET = 7;
const BLOCK_U = [-45, -15, 15, 45];
const STREET_U = [-30, 0, 30];

interface Theme {
  palette: number[];
  mats: MatId[];
  floors: [number, number];
  /** Chance a lot is an enterable building (otherwise a solid block). */
  enterable: number;
  /** Chance a solid block is a tall tower. */
  tower: number;
  courtyard: number;
  hall: number;
  signs: string[];
  roofCaps?: boolean;
}

interface Lot {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  floors: number;
  enterable: boolean;
}

interface GridOpts {
  rows?: number[];
  cols?: number[];
  /** Return true when the block was built by the district itself. */
  special?: (i: number, j: number, x0: number, z0: number, x1: number, z1: number) => boolean;
}

const pickSide = (rng: Rng, sides: Side[]) => sides[rng.int(0, sides.length - 1)]!;
const opposite: Record<Side, Side> = { n: "s", s: "n", e: "w", w: "e" };

/** Places one building on a lot; doors open toward the given (street) sides. */
function lot(b: MapBuilder, rng: Rng, t: Theme, x0: number, z0: number, w: number, d: number, doors: Side[], lots: Lot[]): void {
  const floors = rng.int(t.floors[0], t.floors[1]);
  const color = rng.pick(t.palette);
  const mat = rng.pick(t.mats);
  const enterable = w >= 9 && d >= 9 && rng.next() < t.enterable;
  if (enterable) {
    const free = (["n", "s", "e", "w"] as Side[]).filter((s) => !doors.includes(s));
    b.building(x0, z0, w, d, {
      floors, color, mat, doors, neon: rng.pick(ACCENTS),
      sign: rng.chance(0.55) ? rng.pick(t.signs) : undefined,
      rooms: rng.chance(0.6),
      outsideStairs: floors >= 2 && free.length && rng.chance(0.2) ? pickSide(rng, free) : undefined,
      parapet: t.roofCaps ? 0.6 : 1,
    });
    if (t.roofCaps) b.decor(x0 - 0.2, floors * FLOOR_H + 0.6, z0 - 0.2, x0 + w + 0.2, floors * FLOOR_H + 1.0, z0 + d + 0.2, Mat.PAINT, mix(color, 0x8b3a3a, 0.55));
    lots.push({ x0, z0, x1: x0 + w, z1: z0 + d, floors, enterable: true });
    return;
  }
  // Solid block: flat roof with a low parapet, rooftop clutter, neon trim and a sign.
  const tall = rng.chance(t.tower);
  const h = floors * FLOOR_H + (tall ? rng.int(8, 22) : 0);
  b.box(x0, 0, z0, x0 + w, h, z0 + d, mat === Mat.PAINT || mat === Mat.WOOD ? Mat.FACADE : mat, color);
  const p = 0.25;
  b.box(x0, h, z0, x0 + w, h + 0.6, z0 + p, Mat.PAINT, TRIM);
  b.box(x0, h, z0 + d - p, x0 + w, h + 0.6, z0 + d, Mat.PAINT, TRIM);
  b.box(x0, h, z0 + p, x0 + p, h + 0.6, z0 + d - p, Mat.PAINT, TRIM);
  b.box(x0 + w - p, h, z0 + p, x0 + w, h + 0.6, z0 + d - p, Mat.PAINT, TRIM);
  b.block(x0 + w * 0.3, z0 + d * 0.35, 1.8, 1.4, 1.2, Mat.METAL, 0xdddddd, h);
  if (rng.chance(0.4)) b.block(x0 + w * 0.7, z0 + d * 0.65, 2, 2, 2.2, Mat.WOOD, 0x8b5a3c, h);
  b.neonRect(x0, z0, x0 + w, z0 + d, h + 0.6, rng.pick(ACCENTS), 0.08);
  if (rng.chance(0.6)) {
    const s = doors[0] ?? "s";
    const y = Math.min(3.4, h - 1);
    if (s === "s") b.sign(x0 + w / 2, y, z0 + d + 0.06, Math.min(w * 0.7, 7), 1.2, 2, rng.pick(ACCENTS), rng.pick(t.signs));
    else if (s === "n") b.sign(x0 + w / 2, y, z0 - 0.06, Math.min(w * 0.7, 7), 1.2, 3, rng.pick(ACCENTS), rng.pick(t.signs));
    else if (s === "e") b.sign(x0 + w + 0.06, y, z0 + d / 2, Math.min(d * 0.7, 7), 1.2, 0, rng.pick(ACCENTS), rng.pick(t.signs));
    else b.sign(x0 - 0.06, y, z0 + d / 2, Math.min(d * 0.7, 7), 1.2, 1, rng.pick(ACCENTS), rng.pick(t.signs));
  }
  if (tall && rng.chance(0.5)) b.sign(x0 + w + 0.08, h * 0.6, z0 + d / 2, 1.6, Math.min(h * 0.45, 9), 0, rng.pick(ACCENTS), rng.pick(t.signs), "strip");
  // Low roofs can be reached by jump pads and ladders.
  if (h <= 16) {
    b.roofs.push({ x0, z0, x1: x0 + w, z1: z0 + d, y: h });
    b.spot(x0 + w / 2, h + 0.05, z0 + d / 2);
    if (rng.chance(0.3)) {
      const s = doors[0] ?? "s";
      if (s === "s") b.ladder(x0 + w * 0.8, z0 + d, 0, h, "s");
      else if (s === "n") b.ladder(x0 + w * 0.8, z0, 0, h, "n");
      else if (s === "e") b.ladder(x0 + w, z0 + d * 0.8, 0, h, "e");
      else b.ladder(x0, z0 + d * 0.8, 0, h, "w");
    }
  }
  lots.push({ x0, z0, x1: x0 + w, z1: z0 + d, floors, enterable: false });
}

/** Roof-level plank bridge with rails between two roofs at height y. */
function bridge(b: MapBuilder, x0: number, z0: number, x1: number, z1: number, y: number, alongX: boolean): void {
  // Optional link: dropped if it would cut through someone's stairway.
  b.yielding(() => {
    b.box(x0, y - 0.3, z0, x1, y, z1, Mat.WOOD, 0xd9a066);
    if (alongX) {
      b.box(x0, y, z0, x1, y + 0.9, z0 + 0.1, Mat.PAINT, 0xffffff, BoxFlag.BULLET_PASS);
      b.box(x0, y, z1 - 0.1, x1, y + 0.9, z1, Mat.PAINT, 0xffffff, BoxFlag.BULLET_PASS);
    } else {
      b.box(x0, y, z0, x0 + 0.1, y + 0.9, z1, Mat.PAINT, 0xffffff, BoxFlag.BULLET_PASS);
      b.box(x1 - 0.1, y, z0, x1, y + 0.9, z1, Mat.PAINT, 0xffffff, BoxFlag.BULLET_PASS);
    }
    b.decor(x0, y - 0.32, z0, x1, y - 0.3, z1, Mat.NEON, 0xffd56b);
  });
}

/** Fills one block (W×D, normally 23×23) with buildings using a random layout. */
function fillBlock(b: MapBuilder, rng: Rng, t: Theme, x0: number, z0: number, W: number, D: number): Lot[] {
  const lots: Lot[] = [];
  const x1 = x0 + W;
  const z1 = z0 + D;
  const Ax = (W - 2) / 2; // lot sizes in the quad layout (2 m alleys)
  const Az = (D - 2) / 2;
  const r = rng.next();
  if (r < t.hall) {
    // One big hall/warehouse: open interior with cover.
    const floors = rng.int(1, 2);
    b.building(x0, z0, W, D, { floors, color: rng.pick(t.palette), mat: rng.pick(t.mats), doors: ["n", "s", rng.chance(0.5) ? "e" : "w"], rooms: false, sign: rng.pick(t.signs) });
    for (let k = 0; k < 6; k++) b.crate(x0 + 3 + rng.range(0, W - 6), z0 + 6 + rng.range(0, D - 10), rng.range(1, 1.6), 0, rng.pick(CANDY));
    b.block(x0 + W * 0.65, z0 + D * 0.55, 3, 3, 2.2, Mat.METAL, 0x80cbe8);
    b.lootCrate(x0 + W * 0.35, z0 + D * 0.7);
    lots.push({ x0, z0, x1, z1, floors, enterable: true });
  } else if (r < t.hall + t.courtyard) {
    // L-shaped buildings around a small courtyard (parking, cover).
    const flipX = rng.chance(0.5);
    const flipZ = rng.chance(0.5);
    const bx = flipX ? x1 - 9 : x0;
    const bz = flipZ ? z1 - 9 : z0;
    lot(b, rng, t, x0, bz, W, 9, [flipZ ? "s" : "n", "e", "w"], lots);
    const wz0 = flipZ ? z0 : z0 + 11;
    lot(b, rng, t, bx, wz0, 9, D - 11, [flipX ? "e" : "w", flipZ ? "n" : "s"], lots);
    const cxm = (flipX ? x0 : x0 + 11) + (W - 11) / 2;
    const czm = (flipZ ? z0 : z0 + 11) + (D - 11) / 2;
    b.car(cxm - 2.5, czm, false, rng.pick(CANDY));
    if (rng.chance(0.6)) b.car(cxm + 2.5, czm + 1, false, rng.pick(CANDY));
    b.block(cxm + (flipX ? 4 : -4), czm + (flipZ ? 4 : -4), 1.8, 1.1, 1.3, Mat.PAINT, 0x3a9b5c);
    b.lootCrate(cxm, czm - 3.5);
    b.spot(cxm, 0.05, czm + 3);
  } else if (r < 0.55) {
    // Two long slabs with an alley between them.
    if (rng.chance(0.5)) {
      lot(b, rng, t, x0, z0, W, Az, ["n", rng.chance(0.4) ? "s" : "e"], lots);
      lot(b, rng, t, x0, z0 + Az + 2, W, Az, ["s", rng.chance(0.4) ? "n" : "w"], lots);
      const a = lots[lots.length - 2]!;
      const c = lots[lots.length - 1]!;
      if (a.enterable && c.enterable && a.floors === c.floors && rng.chance(0.7)) bridge(b, x0 + W / 2 - 1.2, z0 + Az, x0 + W / 2 + 1.2, z0 + Az + 2, a.floors * FLOOR_H, false);
    } else {
      lot(b, rng, t, x0, z0, Ax, D, ["w", rng.chance(0.4) ? "e" : "n"], lots);
      lot(b, rng, t, x0 + Ax + 2, z0, Ax, D, ["e", rng.chance(0.4) ? "w" : "s"], lots);
      const a = lots[lots.length - 2]!;
      const c = lots[lots.length - 1]!;
      if (a.enterable && c.enterable && a.floors === c.floors && rng.chance(0.7)) bridge(b, x0 + Ax, z0 + D / 2 - 1.2, x0 + Ax + 2, z0 + D / 2 + 1.2, a.floors * FLOOR_H, true);
    }
    b.lootCrate(x0 + W / 2, z0 + D / 2);
  } else {
    // Four lots around a cross of alleys.
    const corners: [number, number, Side[]][] = [
      [x0, z0, ["n", "w"]],
      [x0 + Ax + 2, z0, ["n", "e"]],
      [x0, z0 + Az + 2, ["s", "w"]],
      [x0 + Ax + 2, z0 + Az + 2, ["s", "e"]],
    ];
    for (const [lx, lz, ds] of corners) lot(b, rng, t, lx, lz, Ax, Az, rng.chance(0.25) ? [...ds, opposite[ds[0]!]] : ds, lots);
    const [nw, ne, sw, se] = lots.slice(-4) as [Lot, Lot, Lot, Lot];
    const link = (p: Lot, q: Lot, f: () => void) => {
      if (p.enterable && q.enterable && p.floors === q.floors && rng.chance(0.7)) f();
    };
    link(nw, ne, () => bridge(b, x0 + Ax, z0 + 4, x0 + Ax + 2, z0 + 6.5, nw.floors * FLOOR_H, true));
    link(sw, se, () => bridge(b, x0 + Ax, z0 + Az + 6, x0 + Ax + 2, z0 + Az + 8.5, sw.floors * FLOOR_H, true));
    link(nw, sw, () => bridge(b, x0 + 4, z0 + Az, x0 + 6.5, z0 + Az + 2, nw.floors * FLOOR_H, false));
    link(ne, se, () => bridge(b, x0 + Ax + 6, z0 + Az, x0 + Ax + 8.5, z0 + Az + 2, ne.floors * FLOOR_H, false));
    // Alley clutter: dumpster, crates.
    b.block(x0 + Ax + 1, z0 + 3, 1.2, 1.8, 1.3, Mat.PAINT, 0x3a9b5c);
    b.crate(x0 + 3, z0 + Az + 1, 0.9, 0, rng.pick(CANDY));
    b.lootCrate(x0 + Ax + 1, z1 - 3);
  }
  return lots;
}

/** Sidewalks, parked cars, lamps and street cover along one street segment. */
function dressStreet(b: MapBuilder, rng: Rng, axis: "x" | "z", c: number, from: number, to: number, cross: [number, number][], width = STREET): void {
  const half = width / 2;
  // Wide boulevards keep a clear centre lane: props hug the curbs.
  const curb = width > STREET ? half - 2.1 : 0;
  // Sidewalk strips along both block faces, interrupted at intersections.
  const cuts = cross.map(([k, h]) => [k - h, k + h] as const).sort((p, q) => p[0] - q[0]);
  let u0 = from;
  for (const [a, z] of [...cuts, [to, to] as const]) {
    const u1 = Math.min(a, to);
    if (u1 - u0 > 0.5) {
      if (axis === "z") {
        b.sidewalk(c - half, u0, c - half + 1.2, u1);
        b.sidewalk(c + half - 1.2, u0, c + half, u1);
      } else {
        b.sidewalk(u0, c - half, u1, c - half + 1.2);
        b.sidewalk(u0, c + half - 1.2, u1, c + half);
      }
    }
    u0 = Math.max(u0, z);
  }
  for (let u = from + 2; u < to - 2; u += 2) {
    if (axis === "z") b.decor(c - 0.08, 0.02, u, c + 0.08, 0.03, u + 1, Mat.PAINT, 0xffffff);
    else b.decor(u, 0.02, c - 0.08, u + 1, 0.03, c + 0.08, Mat.PAINT, 0xffffff);
  }
  const nearCross = (u: number) => cross.some(([k, h]) => Math.abs(u - k) < h + 1.5);
  let side = rng.chance(0.5) ? 1 : -1;
  for (let u = from + 4; u < to - 3; u += rng.range(6, 11)) {
    if (nearCross(u)) continue;
    const at = (o: number): [number, number] => (axis === "z" ? [c + o, u] : [u, c + o]);
    const r = rng.next();
    if (r < 0.38) {
      const [x, z] = at(side * (curb || 1.15));
      b.car(x, z, axis === "x", rng.pick(CANDY));
    } else if (r < 0.52) {
      const [x, z] = at(side * curb);
      b.barrier(x, z, axis === "x", 2.4);
    } else if (r < 0.64) {
      const [x, z] = at(side * (curb || 1.4));
      b.crate(x, z, rng.range(0.9, 1.3), 0, rng.pick(CANDY));
    } else if (r < 0.74) {
      const [x, z] = at(side * (curb || 1.2));
      b.block(x, z, axis === "x" ? 1.8 : 1.2, axis === "x" ? 1.2 : 1.8, 1.3, Mat.PAINT, 0x3a9b5c); // dumpster
    } else if (r < 0.82) {
      const [x, z] = at(side * (curb || 1.3));
      b.lootCrate(x, z);
    } else if (r < 0.9) {
      const [x, z] = at(side * (half - 0.6));
      b.hydrant(x, z);
    } else {
      const [x, z] = at(side * (half - 0.9));
      b.bench(x, z, axis === "x");
    }
    side = -side;
  }
  for (let u = from + 7; u < to - 4; u += 15) {
    const o = (Math.floor(u / 15) % 2 ? 1 : -1) * (half - 0.4);
    const [x, z] = axis === "z" ? [c + o, u] : [u, c + o];
    b.lamp(x, z, 0xffd59a, 5.5);
  }
}

/** Width of the central east–west boulevard (main route; payload track). */
const BOULEVARD = 11;

/** Z extent of block row j: the two rows beside the boulevard are 2 m shallower. */
function rowZ(cz: number, j: number): [number, number] {
  if (j === 1) return [cz - 26.5, cz - BOULEVARD / 2];
  if (j === 2) return [cz + BOULEVARD / 2, cz + 26.5];
  return [cz + BLOCK_U[j]! - HALF_BLOCK, cz + BLOCK_U[j]! + HALF_BLOCK];
}

/** Builds the block grid for a district plus its streets. */
function cityGrid(b: MapBuilder, rng: Rng, cx: number, cz: number, t: Theme, o: GridOpts = {}): void {
  const cols = o.cols ?? [0, 1, 2, 3];
  const rows = o.rows ?? [0, 1, 2, 3];
  const blocks = new Map<string, Lot[]>();
  for (const j of rows)
    for (const i of cols) {
      const x0 = cx + BLOCK_U[i]! - HALF_BLOCK;
      const [z0, z1] = rowZ(cz, j);
      if (o.special?.(i, j, x0, z0, x0 + BLOCK, z1)) continue;
      blocks.set(`${i},${j}`, fillBlock(b, rng, t, x0, z0, BLOCK, z1 - z0));
    }
  // Streets between and around the blocks.
  const zFrom = rowZ(cz, rows[0]!)[0];
  const zTo = rowZ(cz, rows[rows.length - 1]!)[1];
  const xFrom = cx + BLOCK_U[cols[0]!]! - HALF_BLOCK;
  const xTo = cx + BLOCK_U[cols[cols.length - 1]!]! + HALF_BLOCK;
  for (const su of STREET_U) {
    if (cx + su > xFrom && cx + su < xTo) dressStreet(b, rng, "z", cx + su, zFrom, zTo, STREET_U.map((k) => [cz + k, k === 0 ? BOULEVARD / 2 : STREET / 2]));
    if (cz + su > zFrom && cz + su < zTo) dressStreet(b, rng, "x", cz + su, xFrom, xTo, STREET_U.map((k) => [cx + k, STREET / 2]), su === 0 ? BOULEVARD : STREET);
  }
  // Roof bridges across streets between facing buildings of equal height.
  const gapOk = (g: number) => g > STREET - 0.1 && g < BOULEVARD + 0.1;
  for (const [key, lots] of blocks) {
    const [i, j] = key.split(",").map(Number) as [number, number];
    const east = blocks.get(`${i + 1},${j}`);
    const south = blocks.get(`${i},${j + 1}`);
    for (const p of lots) {
      if (!p.enterable) continue;
      for (const q of east ?? []) {
        if (!q.enterable || q.floors !== p.floors || !gapOk(q.x0 - p.x1)) continue;
        const lo = Math.max(p.z0, q.z0) + 1;
        const hi = Math.min(p.z1, q.z1) - 1;
        if (hi - lo > 2.5 && rng.chance(0.35)) bridge(b, p.x1, (lo + hi) / 2 - 1.2, q.x0, (lo + hi) / 2 + 1.2, p.floors * FLOOR_H, true);
      }
      for (const q of south ?? []) {
        if (!q.enterable || q.floors !== p.floors || !gapOk(q.z0 - p.z1)) continue;
        const lo = Math.max(p.x0, q.x0) + 1;
        const hi = Math.min(p.x1, q.x1) - 1;
        if (hi - lo > 2.5 && rng.chance(0.35)) bridge(b, (lo + hi) / 2 - 1.2, p.z1, (lo + hi) / 2 + 1.2, q.z0, p.floors * FLOOR_H, false);
      }
    }
  }
}

const SHOP_SIGNS = SIGN_WORDS;

function neonCity(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  cityGrid(b, rng, cx, cz, {
    palette: CANDY, mats: [Mat.FACADE, Mat.FACADE, Mat.BRICK, Mat.PAINT], floors: [2, 4], enterable: 0.55, tower: 0.5, courtyard: 0.1, hall: 0.03, signs: SHOP_SIGNS,
  }, {
    special: (i, j, x0, z0, x1, z1) => {
      if (i !== 1 || j !== 1) return false;
      // Landmark square: striped spire with planters, kiosks and benches.
      const sx = (x0 + x1) / 2;
      const sz = (z0 + z1) / 2;
      const cols = [0xff70a6, 0xffca3a, 0x4cc9f0, 0x5ee35e, 0xb388ff];
      for (let k = 0; k < 8; k++) b.block(sx, sz, 6 - k * 0.35, 6 - k * 0.35, 6, Mat.PAINT, cols[k % cols.length]!, k * 6);
      b.light(sx, 50, sz, BRIGHT.pink, 2);
      b.sign(sx, 14, sz + 3.1, 4.6, 6, 2, BRIGHT.pink, "NEON CITY", "holo");
      b.sign(sx, 14, sz - 3.1, 4.6, 6, 3, BRIGHT.sky, "SPIRE", "holo");
      for (const [dx, dz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]] as const) {
        b.block(sx + dx, sz + dz, 3.5, 1.2, 1.0, Mat.TILE, 0xe9e4d8);
        b.decor(sx + dx - 1.7, 1.0, sz + dz - 0.55, sx + dx + 1.7, 1.25, sz + dz + 0.55, Mat.LEAF, 0x5cc85c);
      }
      b.block(sx - 8, sz, 2.4, 1.4, 1.1, Mat.PAINT, 0xff8a80);
      b.decor(sx - 9.4, 2.2, sz - 1, sx - 6.6, 2.35, sz + 1, Mat.AWNING, 0xffd166);
      b.block(sx + 8, sz, 2.4, 1.4, 1.1, Mat.PAINT, 0x7bdff2);
      b.decor(sx + 6.6, 2.2, sz - 1, sx + 9.4, 2.35, sz + 1, Mat.AWNING, 0xff70a6);
      b.spot(sx + 5, 0.05, sz - 9);
      b.lootCrate(sx - 4, sz + 9);
      return true;
    },
  });
}

function rusthaven(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  cityGrid(b, rng, cx, cz, {
    palette: [0xd0643f, 0xc85a3a, 0xe07a5f, 0x80cbe8, 0xffd166, 0xb07a4a], mats: [Mat.BRICK, Mat.BRICK, Mat.PANEL, Mat.METAL], floors: [1, 3], enterable: 0.6, tower: 0.12,
    courtyard: 0.25, hall: 0.25, signs: ["WORKSHOP", "GARAGE", "WELDING", "PARTS", "FOUNDRY", "IRONWORKS", "TOOLS"],
  }, {
    special: (i, j, x0, z0) => {
      if (i !== 2 || j !== 0) return false;
      // Factory with brick smokestacks (landmark).
      b.building(x0, z0, BLOCK, 13, { floors: 2, color: 0xe07a5f, mat: Mat.BRICK, neon: BRIGHT.orange, doors: ["s", "w", "n"], sign: "FOUNDRY 7" });
      for (const [dx, h] of [[4, 30], [11.5, 38], [19, 26]] as const) {
        b.block(x0 + dx, z0 + 18, 3.2, 3.2, h, Mat.BRICK, 0xc85a3a);
        for (let y = 6; y < h; y += 6) b.decor(x0 + dx - 1.65, y, z0 + 16.35, x0 + dx + 1.65, y + 0.8, z0 + 19.65, Mat.PAINT, 0xffffff);
        b.light(x0 + dx, h + 1, z0 + 18, BRIGHT.red, 0.8);
      }
      b.container(x0 + 8, z0 + 21.3, true, 0xff595e);
      b.barrel(x0 + 15, z0 + 21);
      return true;
    },
  });
}

function eclipseHarbor(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  const theme: Theme = {
    palette: [0x7bdff2, 0xffffff, 0xff595e, 0x80cbe8, 0xffd166, 0xb2f7ef], mats: [Mat.PANEL, Mat.FACADE, Mat.BRICK, Mat.CONTAINER], floors: [1, 3], enterable: 0.6,
    tower: 0.1, courtyard: 0.25, hall: 0.15, signs: ["FISH & CHIPS", "DOCK 9", "PORT OFFICE", "BAIT & TACKLE", "SURF SHOP", "SEAFOOD"],
  };
  cityGrid(b, rng, cx, cz, theme, {
    cols: [0, 1, 2],
    rows: [0, 1, 2],
    special: (i, j, x0, z0) => {
      if (i !== 0 || j !== 0) return false;
      // Container yard: stacks with ladders make a vertical maze.
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 2; c++) {
          const px = x0 + 5 + c * 13;
          const pz = z0 + 3 + r * 8;
          b.container(px, pz, true, rng.pick(CANDY));
          const stack = rng.int(0, 2);
          for (let s = 1; s <= stack; s++) b.container(px, pz, true, rng.pick(CANDY), s * 2.6);
          if (stack) {
            b.ladder(px - 3.05, pz, 0, stack * 2.6 + 2.6, "w");
            b.spot(px, stack * 2.6 + 2.65, pz);
          }
        }
      return true;
    },
  });
  // Waterfront strip south of the grid: sheds and stacked containers.
  for (let k = 0; k < 3; k++) {
    const x0 = cx + BLOCK_U[k]! - HALF_BLOCK;
    if (rng.chance(0.6)) b.building(x0, cz + 33.5, BLOCK, 8, { floors: rng.int(1, 2), color: rng.pick(theme.palette), mat: Mat.PANEL, doors: ["n", "s"], sign: rng.pick(theme.signs) });
    else for (let s = 0; s < 3; s++) b.container(x0 + 4 + s * 7.5, cz + 37.5, false, rng.pick(CANDY), 0);
  }
  dressStreet(b, rng, "x", cz + 30, cx - 56.5, cx + 26.5, [[cx - 30, STREET / 2], [cx, STREET / 2]]);
  // Quay, piers and the moored cargo ship.
  const edgeX = cx + 30;
  b.decor(edgeX - 0.3, 0, cz - 46, edgeX + 0.1, 0.25, cz + 42, Mat.PAINT, 0xffca3a);
  for (const pz of [-30, 0, 18]) {
    b.box(edgeX, -1, cz + pz - 4, edgeX + 26, 0, cz + pz + 4, Mat.WOOD, 0xc49a6c);
    b.block(edgeX + 24, cz + pz, 1, 1, 1, Mat.PAINT, 0xff595e);
    b.crate(edgeX + 10, cz + pz + 2, 1.3, 0, rng.pick(CANDY));
    b.lootCrate(edgeX + 16, cz + pz - 2);
    b.light(edgeX + 25, 1.6, cz + pz, 0xffd59a, 0.7);
  }
  const sx0 = edgeX + 8;
  const sz0 = cz + 26;
  b.box(sx0, -3, sz0, sx0 + 40, 1.5, sz0 + 12, Mat.PAINT, 0xe63946);
  b.box(sx0, 1.5, sz0, sx0 + 40, 5.5, sz0 + 12, Mat.PAINT, 0x1d3557);
  b.box(sx0 + 30, 5.5, sz0 + 1, sx0 + 38, 12, sz0 + 11, Mat.PAINT, 0xffffff);
  b.sign(sx0 + 30 - 0.08, 10, sz0 + 6, 6, 1.4, 1, BRIGHT.sky, "SUNNY LINE");
  b.container(sx0 + 8, sz0 + 6, true, 0xff595e, 5.5);
  b.container(sx0 + 16, sz0 + 3.5, true, 0x4cc9f0, 5.5);
  b.container(sx0 + 16, sz0 + 8.5, true, 0xffca3a, 5.5);
  b.container(sx0 + 23, sz0 + 6, true, 0x5ee35e, 5.5);
  // Gangway: the top step meets the deck edge; the pier gives a landing at the bottom.
  b.stairs(sx0 - 0.1, sz0 - 6.6, "z", 1, 2, 0, 5.5, Mat.WOOD, 0xc98f5a);
  b.box(sx0 - 1.1, -1, sz0 - 7.8, sx0 + 0.9, 0, sz0, Mat.WOOD, 0xc49a6c);
  b.spot(sx0 + 12, 5.55, sz0 + 6);
  b.ladder(sx0 + 34, sz0 + 0.95, 5.5, 12, "n");
  // Gantry crane over the quay (landmark).
  const gx = cx + 42;
  for (const lz of [-61, -49]) {
    b.block(gx - 9, cz + lz, 1.4, 1.4, 26, Mat.PAINT, 0xffca3a);
    b.block(gx + 9, cz + lz, 1.4, 1.4, 26, Mat.PAINT, 0xffca3a);
  }
  b.box(gx - 10, 26, cz - 62, gx - 8, 28, cz - 48, Mat.PAINT, 0xffca3a);
  b.box(gx + 8, 26, cz - 62, gx + 10, 28, cz - 48, Mat.PAINT, 0xffca3a);
  b.box(gx - 10, 26, cz - 57, gx + 10, 28, cz - 53, Mat.PAINT, 0xffca3a);
  b.ladder(gx - 9, cz - 48.3, 0, 26, "s");
  b.spot(gx - 9, 28.05, cz - 55);
}

function sectorZero(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  cityGrid(b, rng, cx, cz, {
    palette: [0xffffff, 0xb2f7ef, 0x80cbe8, 0x8fd3a8, 0x95d5b2, 0xffe8a3], mats: [Mat.PAINT, Mat.PANEL, Mat.FACADE], floors: [1, 3], enterable: 0.65, tower: 0.15,
    courtyard: 0.2, hall: 0.08, signs: ["LAB A", "LAB B", "BIOTECH", "ROBOTICS", "CAFETERIA", "ARCHIVE", "OPTICS"],
  }, {
    special: (i, j, x0, z0, _x1, z1) => {
      if (i === 0 && j === 0) {
        // Glass observatory dome (stepped), landmark.
        const sx = x0 + HALF_BLOCK;
        const sz = z0 + HALF_BLOCK;
        for (let k = 0; k < 6; k++) {
          const s = 20 - k * 3;
          b.block(sx, sz, s, s, 2.6, k % 2 ? Mat.GLASS : Mat.PAINT, k % 2 ? 0xbfe6ff : 0xffffff, k * 2.6);
        }
        b.light(sx, 18, sz, BRIGHT.green, 1.6);
        b.stairs(sx, z0 + 21.5 + 3.6, "z", -1, 2, 0, 2.6, Mat.WOOD, 0xc98f5a);
        b.spot(sx, 2.65, z0 + 20.8);
        return true;
      }
      // The two blocks over the underground lab are a sunken courtyard.
      if (j === 2 && (i === 1 || i === 2)) {
        // Small labs flank the pit.
        const lx = i === 1 ? x0 : x0 + BLOCK - 7.5;
        b.building(lx, z0, 7.5, z1 - z0, { floors: 1, color: i === 1 ? 0xb2f7ef : 0x8fd3a8, doors: [i === 1 ? "w" : "e", "s"], sign: "LAB" });
        b.lootCrate(i === 1 ? x0 + 9 : x0 + BLOCK - 9, z0 + 1.2);
        return true;
      }
      return false;
    },
  });
  // Underground lab: pit [cx-18, cz+6]..[cx+18, cz+26], floor at y=-5.
  const px0 = cx - 18;
  const px1 = cx + 18;
  const pz0 = cz + 6;
  const pz1 = cz + 26;
  const D = -5;
  const lab = 0xeef3f6;
  b.box(px0, D - 1, pz0, px1, D, pz1, Mat.TILE, 0xdfe8ee);
  b.box(px0, D, pz0, px0 + 0.5, 0, pz1, Mat.PAINT, lab);
  b.box(px1 - 0.5, D, pz0, px1, 0, pz1, Mat.PAINT, lab);
  b.box(px0, D, pz0, px1, 0, pz0 + 0.5, Mat.PAINT, lab);
  b.box(px0, D, pz1 - 0.5, px1, 0, pz1, Mat.PAINT, lab);
  b.box(px0 + 7, -0.4, pz0, px1 - 7, 0, pz1, Mat.CONCRETE, 0xbcd0b0);
  b.stairs(px0 + 2, pz0 + 6.5, "z", -1, 3, D, 0, Mat.WOOD, 0xc98f5a);
  b.stairs(px1 - 2, pz1 - 6.5, "z", 1, 3, D, 0, Mat.WOOD, 0xc98f5a);
  b.wall("z", pz0 + 0.5, pz1 - 0.5, cx - 4, cx - 3.7, D, -0.4, [[pz0 + 3, pz0 + 6, D - 1, D + 2.6], [pz1 - 7, pz1 - 4, D - 1, D + 2.6]], Mat.PAINT, 0xb2f7ef);
  b.wall("z", pz0 + 0.5, pz1 - 0.5, cx + 3.7, cx + 4, D, -0.4, [[pz0 + 8, pz0 + 11, D - 1, D + 2.6]], Mat.PAINT, 0xffd166);
  for (let k = 0; k < 4; k++) b.block(cx + rng.range(-12, 12), pz0 + rng.range(4, 16), 2.4, 0.9, 1.0, Mat.TILE, 0xffffff, D);
  b.block(cx, pz0 + 10, 2.2, 2.2, 3, Mat.GLASS, 0x5ee35e, D);
  b.light(cx, D + 3, pz0 + 10, BRIGHT.green, 1.5);
  b.spot(cx, D + 0.05, pz0 + 5);
  b.spot(cx - 9, D + 0.05, pz1 - 6);
  b.lootCrate(cx + 10, pz0 + 6, D);
  b.box(px0 + 4, 0, pz0 - 0.2, px0 + 7, 1.0, pz0, Mat.PAINT, 0xffca3a);
  b.box(px1 - 7, 0, pz1, px1 - 4, 1.0, pz1 + 0.2, Mat.PAINT, 0xffca3a);
  b.box(px0 - 0.2, 0, pz0, px0, 1.0, pz1, Mat.PAINT, 0xffca3a);
  b.box(px1, 0, pz0, px1 + 0.2, 1.0, pz1, Mat.PAINT, 0xffca3a);
}

function chromeValley(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  cityGrid(b, rng, cx, cz, {
    palette: [0xffd166, 0xff8a80, 0x7bdff2, 0xf7a072, 0x80cbe8, 0xffffff], mats: [Mat.PAINT, Mat.FACADE, Mat.BRICK, Mat.PANEL], floors: [1, 2], enterable: 0.7, tower: 0.1,
    courtyard: 0.35, hall: 0.12, signs: ["DINER", "MOTEL", "GARAGE", "FUEL-X", "TIRES", "CAR WASH", "BURGERS", "DRIVE-IN"],
  });
  // Elevated highway above the northern east-west street (y = 8).
  const H = 8;
  const hz = cz - 30; // over the northern cross street, leaving the boulevard clear
  const he = 51.5; // ramps end ~3 m short of the district wall
  b.box(cx - he, H - 0.6, hz - 3.5, cx + he, H, hz + 3.5, Mat.ASPHALT, 0x6b7280);
  b.box(cx - he, H, hz - 3.5, cx + he, H + 1, hz - 3.2, Mat.PAINT, 0xffffff);
  b.box(cx - he, H, hz + 3.2, cx + he, H + 1, hz + 3.5, Mat.PAINT, 0xffffff);
  for (let x = cx - he + 2; x < cx + he - 4; x += 8) b.decor(x, H, hz - 0.1, x + 4, H + 0.01, hz + 0.1, Mat.PAINT, 0xffca3a);
  for (let x = cx - 52; x <= cx + 52; x += 14) {
    if (Math.abs(x - cx) > he - 0.5) continue; // the ladders below sit on these pillars
    b.block(x, hz - 3.2, 0.8, 0.8, H - 0.6, Mat.CONCRETE, 0xc9d1d8);
    b.block(x, hz + 3.2, 0.8, 0.8, H - 0.6, Mat.CONCRETE, 0xc9d1d8);
  }
  b.sign(cx - 20, H + 3.5, hz + 3.6, 9, 2, 2, BRIGHT.green, "CHROME VALLEY EXPWY");
  // Ramps (stairs) at both ends on the arterial roads, ladders on pillars.
  b.stairs(cx - he - 9.6, hz, "x", 1, 3, 0, H, Mat.CONCRETE, 0xd8d2c4);
  b.stairs(cx + he + 9.6, hz, "x", -1, 3, 0, H, Mat.CONCRETE, 0xd8d2c4);
  b.ladder(cx - 24, hz - 3.5, 0, H, "n");
  b.ladder(cx + 18, hz + 3.5, 0, H, "s");
  for (let k = 0; k < 6; k++) {
    const x = cx + rng.range(-he + 3, he - 3);
    if (rng.chance(0.6)) b.car(x, hz + rng.pick([-1.4, 1.4]), true, rng.pick(CANDY), H);
    else b.block(x, hz, 3, 0.6, 1, Mat.PAINT, 0xff9f1c, H);
  }
  b.spot(cx - 30, H + 0.05, hz);
  b.spot(cx + 22, H + 0.05, hz + 1);
  b.lootCrate(cx - 8, hz + 1.5, H);
}

function outlands(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  cityGrid(b, rng, cx, cz, {
    palette: [0xffd166, 0xff8a80, 0xb2f7ef, 0xffb4a2, 0x8fd3a8, 0xffe8a3, 0x95d5b2], mats: [Mat.PAINT, Mat.PAINT, Mat.WOOD, Mat.BRICK], floors: [1, 2], enterable: 0.75,
    tower: 0, courtyard: 0.25, hall: 0.1, roofCaps: true, signs: ["BAKERY", "INN", "POST", "MARKET", "TAVERN", "FLOWERS", "GENERAL STORE"],
  }, {
    special: (i, j, x0, z0, x1, z1) => {
      if (i !== 2 || j !== 1) return false;
      // Village square with the giant red & white radio tower.
      const tx = (x0 + x1) / 2;
      const tz = (z0 + z1) / 2;
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const)
        for (let y = 0; y < 42; y += 6) b.block(tx + dx, tz + dz, 0.5, 0.5, 6, Mat.PAINT, (y / 6) % 2 ? 0xffffff : 0xff595e, y);
      b.block(tx, tz, 7, 7, 0.4, Mat.METAL, 0xdddddd, 8);
      b.block(tx, tz, 7, 7, 0.4, Mat.METAL, 0xdddddd, 16);
      b.box(tx - 3.5, 8.4, tz - 3.5, tx + 3.5, 9.4, tz - 3.4, Mat.PAINT, 0xffffff);
      b.box(tx - 3.5, 16.4, tz + 3.4, tx + 3.5, 17.4, tz + 3.5, Mat.PAINT, 0xffffff);
      b.ladder(tx, tz + 3.5, 0, 8.4, "s");
      b.ladder(tx + 3.5, tz, 8.4, 16.4, "e");
      b.light(tx, 43, tz, BRIGHT.red, 2);
      b.spot(tx - 2, 8.45, tz - 2);
      b.spot(tx + 2, 16.45, tz + 1);
      // Market stalls around the tower.
      for (const [dx, dz] of [[-8, -8], [8, 8], [-8, 8]] as const) {
        b.block(tx + dx, tz + dz, 3, 1.2, 1.0, Mat.WOOD, 0xd9a066);
        b.box(tx + dx - 1.8, 2.6, tz + dz - 1.4, tx + dx + 1.8, 2.8, tz + dz + 1.4, Mat.AWNING, rng.pick(CANDY));
      }
      b.lootCrate(tx + 8, tz - 8);
      return true;
    },
  });
}

function blacklight(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  // Pagoda landmark in a small central courtyard.
  const tiers = [0xff595e, 0xffca3a, 0xff595e, 0xffca3a, 0xff595e, 0xffca3a];
  for (let i = 0; i < 6; i++) {
    const s = 9 - i * 1.2;
    b.block(cx, cz, s, s, 3.5, Mat.PAINT, i % 2 ? 0xfff4e0 : 0xffe0b0, i * 3.5);
    b.decor(cx - s / 2 - 0.8, i * 3.5 + 3.2, cz - s / 2 - 0.8, cx + s / 2 + 0.8, i * 3.5 + 3.5, cz + s / 2 + 0.8, Mat.PAINT, tiers[i]!);
  }
  b.light(cx, 22, cz, BRIGHT.red, 1.8);
  b.sign(cx, 6, cz + 4.6, 4, 1.2, 2, BRIGHT.red, "BLACKLIGHT");
  // Dense shop grid with lanes (12.5 m lattice).
  for (let gx = -4; gx <= 4; gx++)
    for (let gz = -4; gz <= 4; gz++) {
      if (Math.abs(gx) <= 1 && Math.abs(gz) <= 1) continue;
      if (gx === 0 || gz === 0) continue;
      const x = cx + gx * 12.5;
      const z = cz + gz * 12.5;
      const r = rng.next();
      const color = rng.pick(CANDY);
      if (r < 0.4) {
        b.building(x - 5, z - 5, 10, 10, { floors: rng.int(2, 3), color, doors: [rng.pick(["n", "s"] as const), rng.pick(["e", "w"] as const)], sign: rng.pick(SIGN_WORDS) });
      } else if (r < 0.65) {
        b.building(x - 4.75, z - 4, 9.5, 8, { floors: 1, color, doors: [rng.pick(["n", "s"] as const), rng.pick(["e", "w"] as const)], sign: rng.pick(SIGN_WORDS) });
      } else if (r < 0.9) {
        const h = rng.int(5, 12);
        b.block(x, z, 9, 9, h, Mat.FACADE, color);
        shopSign(b, rng, x, 3.2, z + 4.58, 5, 2);
        b.decor(x - 3, 2.6, z + 4.5, x + 3, 2.75, z + 5.7, Mat.AWNING, bright(rng));
        if (h <= 12) b.roofs.push({ x0: x - 4.5, z0: z - 4.5, x1: x + 4.5, z1: z + 4.5, y: h });
      } else {
        b.block(x, z - 1.5, 5, 1.2, 1.1, Mat.WOOD, 0xd9a066);
        b.box(x - 3, 3, z - 3.5, x + 3, 3.2, z + 1, Mat.AWNING, bright(rng));
        b.crate(x + 1.5, z + 2, 1, 0, bright(rng));
        b.light(x, 2.6, z - 1.5, 0xffd59a, 0.6);
        b.spot(x, 0.05, z + 0.5);
        b.lootCrate(x - 1.8, z + 1.8);
      }
    }
  for (let u = -50; u <= 50; u += 5) {
    b.decor(cx + u, 5.5, cz - 0.15, cx + u + 0.35, 5.9, cz + 0.15, Mat.NEON, rng.pick([BRIGHT.red, BRIGHT.orange, BRIGHT.yellow, BRIGHT.pink]));
    b.decor(cx - 0.15, 5.5, cz + u, cx + 0.15, 5.9, cz + u + 0.35, Mat.NEON, rng.pick([BRIGHT.red, BRIGHT.orange, BRIGHT.yellow, BRIGHT.pink]));
  }
  for (let i = 0; i < 10; i++) b.crate(cx + rng.pick([-1, 1]) * rng.range(3, 50), cz + rng.range(-1.8, 1.8), rng.range(0.9, 1.3), 0, bright(rng));
  for (let i = 0; i < 4; i++) b.barrel(cx + rng.range(-1.8, 1.8), cz + rng.pick([-1, 1]) * rng.range(8, 50));
  for (let i = 0; i < 4; i++) b.lamp(cx + rng.pick([-1, 1]) * rng.range(12, 50), cz + 2.2, 0xffd59a, 4.5);
}

function skyrail(b: MapBuilder, cx: number, cz: number, rng: Rng): void {
  cityGrid(b, rng, cx, cz, {
    palette: [0xffe8a3, 0x80cbe8, 0xff8a80, 0xb2f7ef, 0xffffff, 0x8fd3a8], mats: [Mat.FACADE, Mat.BRICK, Mat.PAINT], floors: [2, 3], enterable: 0.6, tower: 0.25,
    courtyard: 0.15, hall: 0.06, signs: ["PIXEL CAFE", "HOTEL SUNNY", "TICKETS", "NEWS", "BUBBLE TEA", "LOCKERS", "RAIL OPS"],
  }, {
    special: (i, j, x0, z0, x1, z1) => {
      if (i !== 1 || j !== 1) return false;
      // Grand concourse hall.
      b.building(x0, z0, x1 - x0, z1 - z0, { floors: 2, color: 0xffe8a3, doors: ["n", "s", "e", "w"], sign: "SKYRAIL CENTRAL", rooms: false });
      for (let k = 0; k < 4; k++) b.block(x0 + 6 + (k % 2) * 11, z0 + 8 + Math.floor(k / 2) * 8, 3, 0.8, 0.9, Mat.WOOD, 0xd9a066);
      return true;
    },
  });
  // Elevated rail viaduct over the central north-south street.
  const vx = cx;
  const H = 8;
  const ve = 51.5; // stairs end ~3 m short of the district wall
  b.box(vx - 3.5, H - 0.6, cz - ve, vx + 3.5, H, cz + ve, Mat.CONCRETE, 0xe5e0d5);
  for (let z = cz - 49; z <= cz + 49; z += 14) {
    b.block(vx - 2.9, z, 0.8, 0.8, H - 0.6, Mat.CONCRETE, 0xd8d2c4);
    b.block(vx + 2.9, z, 0.8, 0.8, H - 0.6, Mat.CONCRETE, 0xd8d2c4);
  }
  for (const rx of [-1.6, -0.6, 0.6, 1.6]) b.decor(vx + rx - 0.06, H, cz - ve, vx + rx + 0.06, H + 0.12, cz + ve, Mat.METAL, 0x9aa5b1);
  b.box(vx - 3.5, H, cz - ve, vx - 3.3, H + 1, cz + ve, Mat.PAINT, 0xffffff, BoxFlag.BULLET_PASS);
  b.box(vx + 3.3, H, cz - ve, vx + 3.5, H + 1, cz + ve, Mat.PAINT, 0xffffff, BoxFlag.BULLET_PASS);
  b.block(vx, cz - 20, 2.6, 16, 3.2, Mat.PAINT, 0xffffff, H);
  b.decor(vx - 1.35, H + 1.5, cz - 28, vx - 1.29, H + 2.1, cz - 12, Mat.PAINT, 0x4cc9f0);
  b.block(vx, cz + 30, 2.6, 14, 3.2, Mat.PAINT, 0xffffff, H);
  b.decor(vx + 1.29, H + 1.5, cz + 23, vx + 1.35, H + 2.1, cz + 37, Mat.PAINT, 0xff70a6);
  b.stairs(vx, cz - ve - 9.6, "z", 1, 3, 0, H, Mat.TILE, 0xe5e0d5);
  b.stairs(vx, cz + ve + 9.6, "z", -1, 3, 0, H, Mat.TILE, 0xe5e0d5);
  b.ladder(vx - 3.5, cz + 8, 0, H, "w");
  b.ladder(vx + 3.5, cz - 8, 0, H, "e");
  b.spot(vx, H + 0.05, cz + 5);
  b.lootCrate(vx - 1.5, cz + 12, H);
  b.sign(vx - 3.6, H + 2.5, cz, 6, 1.4, 1, BRIGHT.sky, "LINE 7");
}

function bay(b: MapBuilder): void {
  // Lighthouse and buoys in the bay (not reachable).
  for (let i = 0; i < 6; i++) b.decor(150, -2 + i * 4.5, 150, 156, 2.5 + i * 4.5, 156, Mat.PAINT, i % 2 ? 0xffffff : 0xff595e);
  b.decor(149, 25, 149, 157, 28, 157, Mat.NEON, BRIGHT.yellow);
  b.light(153, 27, 153, BRIGHT.yellow, 2.5);
  for (let i = 0; i < 6; i++) b.decor(80 + i * 18, -1.5, 90 + (i % 3) * 30, 81 + i * 18, -0.4, 91 + (i % 3) * 30, Mat.PAINT, 0xff595e);
  // Long pier from Blacklight Market (playable during BR).
  b.box(118, -1, 64, 126, 0, 104, Mat.WOOD, 0xc49a6c);
  b.block(122, 102, 6, 2, 1.2, Mat.PAINT, 0x4cc9f0);
  b.bench(120, 90, false);
  b.light(122, 2, 103, 0xffd59a, 0.8);
  b.spot(122, 0.05, 96);
}
