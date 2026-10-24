import type { Vec3 } from "../math";
import type { CollisionWorld } from "../map/collision";
import type { District } from "../map/types";
import type { NavGrid } from "../ai/nav";

/** Escort radius: attackers within this many metres push the payload. */
export const PAYLOAD_RADIUS = 5;
/** Push speed (m/s) for one escort; more escorts push a little faster. */
export const PAYLOAD_SPEED = 1.4;
/** Roll-back speed (m/s) after the payload is left alone. */
export const PAYLOAD_ROLLBACK = 0.35;
/** Seconds without escorts before the payload starts rolling back. */
export const PAYLOAD_ROLLBACK_DELAY = 8;
/** Seconds added to the clock when the attackers reach a checkpoint. */
export const PAYLOAD_CHECKPOINT_BONUS = 60;
/** Checkpoints as fractions of the track length. */
export const PAYLOAD_CHECKPOINTS = [1 / 3, 2 / 3];
/** Half-extent of the cart's footprint used for clearance checks. */
export const PAYLOAD_HALF = 0.7;

export interface PayloadTrack {
  /** Polyline from the attackers' start to the delivery point. */
  pts: Vec3[];
  /** Cumulative distance at each point. */
  cum: number[];
  length: number;
  /** Checkpoint distances along the track. */
  checkpoints: number[];
}

/**
 * Derives the payload track for a district: A* on the walkability grid
 * (restricted to roomy cells, no big drops) from the west edge through the
 * A, B and C objective spots to the east edge, then string-pulled into long
 * straight segments that stay clear of geometry. Fully deterministic, so the
 * server, offline Practice and every client derive the same track.
 */
export function buildPayloadTrack(nav: NavGrid, world: CollisionWorld, d: District): PayloadTrack {
  const cz = (d.minZ + d.maxZ) / 2;
  const edge = (x: number) => {
    let best = d.spawns[0] ?? { x, y: 0, z: cz };
    let bd = Infinity;
    for (const s of d.spawns) {
      const dd = Math.hypot(s.x - x, (s.z - cz) * 0.8);
      if (dd < bd) {
        bd = dd;
        best = s;
      }
    }
    return best;
  };
  // Cells the cart may occupy: roomy, flat, and clear of geometry.
  const cartOk = new Map<number, boolean>();
  const allow = (k: number): boolean => {
    let v = cartOk.get(k);
    if (v === undefined) {
      v = nav.roomy(k) && flatAround(nav, k) && !cartBlocked(world, nav.center(k).x, nav.height[k]!, nav.center(k).z);
      cartOk.set(k, v);
    }
    return v;
  };
  // Track ends sit on the district's central boulevard (the main east–west street).
  const stops = [{ x: d.minX + 6, y: 0, z: cz }, ...d.points, { x: d.maxX - 6, y: 0, z: cz }].map((p) => snapCell(nav, p, allow)).filter((p): p is Vec3 => !!p);
  const cells: Vec3[] = [];
  for (let i = 0; i < stops.length; i++) {
    if (i === 0) {
      cells.push(stops[0]!);
      continue;
    }
    const from = cells[cells.length - 1]!;
    const seg =
      nav.path(from, stops[i]!, 20000, { allow, maxDrop: 0.6, thin: false }) ??
      nav.path(from, stops[i]!, 20000, { allow: (k) => nav.roomy(k), maxDrop: 1.25, thin: false });
    if (!seg) continue; // Unreachable stop: skip it and route to the next one.
    for (const c of seg) {
      // Remove loops where consecutive legs overlap.
      const back = cells.findIndex((p) => p.x === c.x && p.z === c.z);
      if (back >= 0) cells.length = back;
      cells.push(c);
    }
  }
  const pts = pull(cells, nav, world);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  const length = cum[cum.length - 1]!;
  return { pts, cum, length, checkpoints: PAYLOAD_CHECKPOINTS.map((f) => f * length) };
}

/** Position and heading at `dist` metres along the track. */
export function trackPoint(t: PayloadTrack, dist: number): { x: number; y: number; z: number; yaw: number } {
  const n = t.pts.length;
  if (n === 1) return { ...t.pts[0]!, yaw: 0 };
  const d = Math.max(0, Math.min(t.length, dist));
  let i = 1;
  while (i < n - 1 && t.cum[i]! < d) i++;
  const a = t.pts[i - 1]!;
  const b = t.pts[i]!;
  const seg = t.cum[i]! - t.cum[i - 1]! || 1;
  const k = (d - t.cum[i - 1]!) / seg;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
}

function flatAround(nav: NavGrid, k: number): boolean {
  const i = k % nav.w;
  const j = Math.floor(k / nav.w);
  const h = nav.height[k]!;
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++) if (Math.abs(nav.height[(j + dj) * nav.w + i + di]! - h) > 0.35) return false;
  return true;
}

function snapCell(nav: NavGrid, p: Vec3, allow: (k: number) => boolean): Vec3 | null {
  const c = nav.index(p.x, p.z);
  if (nav.walkable(c) && allow(c) && Math.abs(nav.height[c]! - p.y) < 1.5) return nav.center(c);
  let best = -1;
  let bd = Infinity;
  for (let dz = -12; dz <= 12; dz += 2)
    for (let dx = -12; dx <= 12; dx += 2) {
      const k = nav.index(p.x + dx, p.z + dz);
      if (!nav.walkable(k) || !allow(k)) continue;
      const dd = dx * dx + dz * dz + Math.abs(nav.height[k]! - p.y) * 20;
      if (dd < bd) {
        bd = dd;
        best = k;
      }
    }
  if (best >= 0) return nav.center(best);
  const k = nav.nearest(p.x, p.z, p.y);
  return k >= 0 ? nav.center(k) : null;
}

/** Straight run from a to b keeps the cart on walkable, unobstructed ground. */
function clearRun(a: Vec3, b: Vec3, nav: NavGrid, world: CollisionWorld): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.25));
  for (let s = 0; s <= n; s++) {
    const k = s / n;
    const x = a.x + (b.x - a.x) * k;
    const z = a.z + (b.z - a.z) * k;
    const y = a.y + (b.y - a.y) * k;
    const c = nav.index(x, z);
    if (!nav.walkable(c) || Math.abs(nav.height[c]! - y) > 0.35) return false;
    if (cartBlocked(world, x, y, z)) return false;
  }
  return true;
}

/** Whether the cart's body would intersect solid geometry at this spot. */
export function cartBlocked(world: CollisionWorld, x: number, y: number, z: number): boolean {
  const h = PAYLOAD_HALF;
  return world.overlaps({ minX: x - h, maxX: x + h, minY: y + 0.4, maxY: y + 1.5, minZ: z - h, maxZ: z + h });
}

/** Greedy string-pulling: jump to the farthest cell reachable in a clear straight line. */
function pull(cells: Vec3[], nav: NavGrid, world: CollisionWorld): Vec3[] {
  if (cells.length <= 2) return cells.map((c) => ({ ...c }));
  const out: Vec3[] = [{ ...cells[0]! }];
  let i = 0;
  while (i < cells.length - 1) {
    let j = i + 1;
    for (let k = Math.min(cells.length - 1, i + 40); k > i + 1; k--) {
      if (clearRun(cells[i]!, cells[k]!, nav, world)) {
        j = k;
        break;
      }
    }
    out.push({ ...cells[j]! });
    i = j;
  }
  return out;
}
