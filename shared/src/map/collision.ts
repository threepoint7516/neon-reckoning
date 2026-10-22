import type { AABB, Vec3 } from "../math";
import type { Box, Ladder, MapData } from "./types";
import { BoxFlag } from "./types";

export interface RayHit {
  t: number;
  box: number;
  /** Surface normal axis: 0 ±X, 1 ±Y, 2 ±Z, with sign in `ns`. */
  axis: number;
  ns: number;
}

const CELL = 8;
const GRID_OFFSET = 512; // allows negative coordinates down to -4096m

/**
 * Static collision world: every map box indexed into a uniform XZ grid.
 * Supports swept AABB movement, overlap tests and DDA raycasts. Identical
 * code runs on the server (authority) and in the browser (prediction).
 */
export class CollisionWorld {
  readonly boxes: Box[];
  readonly ladders: Ladder[];
  private grid = new Map<number, number[]>();
  private stamp: Uint32Array;
  private stampId = 1;

  constructor(map: MapData) {
    this.boxes = map.boxes.filter((b) => !(b.flags & BoxFlag.DECOR));
    this.ladders = map.ladders;
    this.stamp = new Uint32Array(this.boxes.length);
    this.boxes.forEach((b, i) => {
      const x0 = Math.floor(b.minX / CELL);
      const x1 = Math.floor((b.maxX - 1e-6) / CELL);
      const z0 = Math.floor(b.minZ / CELL);
      const z1 = Math.floor((b.maxZ - 1e-6) / CELL);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const k = key(x, z);
          let cell = this.grid.get(k);
          if (!cell) this.grid.set(k, (cell = []));
          cell.push(i);
        }
    });
  }

  private nextStamp(): number {
    this.stampId++;
    if (this.stampId >= 0xffffffff) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
  }

  /** Collects indices of boxes whose XZ footprint touches the AABB. */
  query(a: AABB, out: number[]): number[] {
    out.length = 0;
    const s = this.nextStamp();
    const x0 = Math.floor(a.minX / CELL);
    const x1 = Math.floor(a.maxX / CELL);
    const z0 = Math.floor(a.minZ / CELL);
    const z1 = Math.floor(a.maxZ / CELL);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const cell = this.grid.get(key(x, z));
        if (!cell) continue;
        for (const i of cell) {
          if (this.stamp[i] === s) continue;
          this.stamp[i] = s;
          const b = this.boxes[i]!;
          if (b.maxX > a.minX && b.minX < a.maxX && b.maxZ > a.minZ && b.minZ < a.maxZ && b.maxY > a.minY && b.minY < a.maxY)
            out.push(i);
        }
      }
    return out;
  }

  overlaps(a: AABB): boolean {
    return this.query(a, scratch).length > 0;
  }

  /**
   * Moves `a` along one axis by `delta`, clipping against boxes. Returns the
   * distance actually travelled. `a` is mutated in place.
   */
  sweepAxis(a: AABB, axis: 0 | 1 | 2, delta: number): number {
    if (delta === 0) return 0;
    const q: AABB = { ...a };
    if (axis === 0) {
      if (delta > 0) q.maxX += delta;
      else q.minX += delta;
    } else if (axis === 1) {
      if (delta > 0) q.maxY += delta;
      else q.minY += delta;
    } else {
      if (delta > 0) q.maxZ += delta;
      else q.minZ += delta;
    }
    const hits = this.query(q, scratch);
    let d = delta;
    const EPS = 1e-4;
    for (const i of hits) {
      const b = this.boxes[i]!;
      if (axis === 0) {
        if (b.maxY <= a.minY || b.minY >= a.maxY || b.maxZ <= a.minZ || b.minZ >= a.maxZ) continue;
        if (d > 0 && b.minX >= a.maxX - EPS) d = Math.min(d, b.minX - a.maxX - EPS);
        else if (d < 0 && b.maxX <= a.minX + EPS) d = Math.max(d, b.maxX - a.minX + EPS);
      } else if (axis === 1) {
        if (b.maxX <= a.minX || b.minX >= a.maxX || b.maxZ <= a.minZ || b.minZ >= a.maxZ) continue;
        if (d > 0 && b.minY >= a.maxY - EPS) d = Math.min(d, b.minY - a.maxY - EPS);
        else if (d < 0 && b.maxY <= a.minY + EPS) d = Math.max(d, b.maxY - a.minY + EPS);
      } else {
        if (b.maxX <= a.minX || b.minX >= a.maxX || b.maxY <= a.minY || b.minY >= a.maxY) continue;
        if (d > 0 && b.minZ >= a.maxZ - EPS) d = Math.min(d, b.minZ - a.maxZ - EPS);
        else if (d < 0 && b.maxZ <= a.minZ + EPS) d = Math.max(d, b.maxZ - a.minZ + EPS);
      }
    }
    if (delta > 0 && d < 0) d = 0;
    if (delta < 0 && d > 0) d = 0;
    if (axis === 0) {
      a.minX += d;
      a.maxX += d;
    } else if (axis === 1) {
      a.minY += d;
      a.maxY += d;
    } else {
      a.minZ += d;
      a.maxZ += d;
    }
    return d;
  }

  /**
   * DDA raycast across the grid. `dir` must be normalized. When
   * `bulletsOnly` is set, BULLET_PASS boxes (fences) are ignored.
   */
  raycast(o: Vec3, dir: Vec3, maxDist: number, bulletsOnly = false, out?: RayHit): RayHit | null {
    const s = this.nextStamp();
    let best = maxDist;
    let bestBox = -1;
    let bestAxis = 0;
    let bestNs = 1;

    let cx = Math.floor(o.x / CELL);
    let cz = Math.floor(o.z / CELL);
    const stepX = dir.x > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dir.x) < 1e-9 ? Infinity : CELL / Math.abs(dir.x);
    const tDeltaZ = Math.abs(dir.z) < 1e-9 ? Infinity : CELL / Math.abs(dir.z);
    let tMaxX = Math.abs(dir.x) < 1e-9 ? Infinity : ((dir.x > 0 ? (cx + 1) * CELL - o.x : o.x - cx * CELL) / Math.abs(dir.x));
    let tMaxZ = Math.abs(dir.z) < 1e-9 ? Infinity : ((dir.z > 0 ? (cz + 1) * CELL - o.z : o.z - cz * CELL) / Math.abs(dir.z));
    let tCell = 0;

    for (let guard = 0; guard < 400; guard++) {
      const cell = this.grid.get(key(cx, cz));
      if (cell) {
        for (const i of cell) {
          if (this.stamp[i] === s) continue;
          this.stamp[i] = s;
          const b = this.boxes[i]!;
          if (bulletsOnly && b.flags & BoxFlag.BULLET_PASS) continue;
          const r = rayBoxNormal(o, dir, b, best);
          if (r >= 0 && r < best) {
            best = r;
            bestBox = i;
            bestAxis = hitAxis;
            bestNs = hitNs;
          }
        }
      }
      // Hits found inside or before this cell's exit are final.
      const tExit = Math.min(tMaxX, tMaxZ);
      if (bestBox >= 0 && best <= tExit) break;
      if (tExit > maxDist) break;
      tCell = tExit;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (tCell > best) break;
    }
    if (bestBox < 0) return null;
    const hit = out ?? { t: 0, box: 0, axis: 0, ns: 1 };
    hit.t = best;
    hit.box = bestBox;
    hit.axis = bestAxis;
    hit.ns = bestNs;
    return hit;
  }

  /** True when the segment a→b is unobstructed (bullets-only semantics). */
  lineOfSight(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return true;
    const d = { x: dx / len, y: dy / len, z: dz / len };
    return this.raycast(a, d, len - 0.05, true) === null;
  }

  /** Top surface height under (x,z) starting below `fromY`, or -Infinity. */
  groundHeight(x: number, z: number, fromY: number): number {
    const hit = this.raycast({ x, y: fromY, z }, DOWN, fromY + 50);
    return hit ? fromY - hit.t : -Infinity;
  }

  /** Thickness of box `i` along a ray entering at distance tEnter. */
  exitDistance(o: Vec3, dir: Vec3, i: number): number {
    const b = this.boxes[i]!;
    let tmax = Infinity;
    const axes: [number, number, number, number][] = [
      [o.x, dir.x, b.minX, b.maxX],
      [o.y, dir.y, b.minY, b.maxY],
      [o.z, dir.z, b.minZ, b.maxZ],
    ];
    for (const [oo, dd, lo, hi] of axes) {
      if (Math.abs(dd) < 1e-9) continue;
      const t1 = (lo - oo) / dd;
      const t2 = (hi - oo) / dd;
      tmax = Math.min(tmax, Math.max(t1, t2));
    }
    return tmax;
  }

  ladderAt(a: AABB): Ladder | null {
    for (const l of this.ladders) {
      if (a.minX < l.maxX && a.maxX > l.minX && a.minY < l.maxY && a.maxY > l.minY && a.minZ < l.maxZ && a.maxZ > l.minZ)
        return l;
    }
    return null;
  }
}

const DOWN: Vec3 = { x: 0, y: -1, z: 0 };
const scratch: number[] = [];
let hitAxis = 0;
let hitNs = 1;

function key(x: number, z: number): number {
  return (x + GRID_OFFSET) * 4096 + (z + GRID_OFFSET);
}

/** Slab test that also records which face was entered (module scratch vars). */
function rayBoxNormal(o: Vec3, d: Vec3, b: Box, maxDist: number): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = 0;
  let ns = 1;
  // X
  if (Math.abs(d.x) < 1e-9) {
    if (o.x < b.minX || o.x > b.maxX) return -1;
  } else {
    const t1 = (b.minX - o.x) / d.x;
    const t2 = (b.maxX - o.x) / d.x;
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    if (lo > tmin) {
      tmin = lo;
      axis = 0;
      ns = d.x > 0 ? -1 : 1;
    }
    if (hi < tmax) tmax = hi;
  }
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < b.minY || o.y > b.maxY) return -1;
  } else {
    const t1 = (b.minY - o.y) / d.y;
    const t2 = (b.maxY - o.y) / d.y;
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    if (lo > tmin) {
      tmin = lo;
      axis = 1;
      ns = d.y > 0 ? -1 : 1;
    }
    if (hi < tmax) tmax = hi;
  }
  if (Math.abs(d.z) < 1e-9) {
    if (o.z < b.minZ || o.z > b.maxZ) return -1;
  } else {
    const t1 = (b.minZ - o.z) / d.z;
    const t2 = (b.maxZ - o.z) / d.z;
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    if (lo > tmin) {
      tmin = lo;
      axis = 2;
      ns = d.z > 0 ? -1 : 1;
    }
    if (hi < tmax) tmax = hi;
  }
  if (tmax < 0 || tmin > tmax) return -1;
  const t = tmin < 0 ? 0 : tmin;
  if (t > maxDist) return -1;
  hitAxis = axis;
  hitNs = ns;
  return t;
}
