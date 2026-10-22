import type { CollisionWorld } from "../map/collision";
import type { Vec3 } from "../math";
import type { MapData } from "../map/types";
import { Rng } from "../rng";

/**
 * Walkability grid (2 m cells) sampled from the real collision world, with
 * A* pathfinding. Heights per cell let bots use stairs, docks and the
 * underground lab; steep height jumps are treated as non-traversable.
 */
export class NavGrid {
  readonly cell = 2;
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  readonly height: Float32Array;
  private open: Uint8Array;

  constructor(world: CollisionWorld, map: MapData, b: { minX: number; minZ: number; maxX: number; maxZ: number }) {
    this.x0 = b.minX;
    this.z0 = b.minZ;
    this.w = Math.max(1, Math.floor((b.maxX - b.minX) / this.cell));
    this.h = Math.max(1, Math.floor((b.maxZ - b.minZ) / this.cell));
    this.height = new Float32Array(this.w * this.h).fill(NaN);
    this.open = new Uint8Array(this.w * this.h);
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const x = this.x0 + (i + 0.5) * this.cell;
        const z = this.z0 + (j + 0.5) * this.cell;
        const y = world.groundHeight(x, z, 2.6);
        if (!isFinite(y) || y < -8) continue;
        if (map.water.some((wr) => x > wr.minX && x < wr.maxX && z > wr.minZ && z < wr.maxZ) && y < 0) continue;
        const blocked = world.overlaps({ minX: x - 0.42, maxX: x + 0.42, minY: y + 0.08, maxY: y + 1.75, minZ: z - 0.42, maxZ: z + 0.42 });
        if (blocked) continue;
        const k = j * this.w + i;
        this.height[k] = y;
        this.open[k] = 1;
      }
  }

  index(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  center(k: number): Vec3 {
    const i = k % this.w;
    const j = Math.floor(k / this.w);
    return { x: this.x0 + (i + 0.5) * this.cell, y: this.height[k]!, z: this.z0 + (j + 0.5) * this.cell };
  }

  walkable(k: number): boolean {
    return k >= 0 && this.open[k] === 1;
  }

  /** Nearest walkable cell to (x,z) within a small search radius. */
  nearest(x: number, z: number, y?: number): number {
    const c = this.index(x, z);
    if (this.walkable(c) && (y === undefined || Math.abs(this.height[c]! - y) < 2.5)) return c;
    const ci = Math.floor((x - this.x0) / this.cell);
    const cj = Math.floor((z - this.z0) / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let r = 1; r <= 6; r++) {
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const k = j * this.w + i;
          if (!this.open[k]) continue;
          const d = di * di + dj * dj + (y !== undefined ? Math.abs(this.height[k]! - y) * 4 : 0);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
      if (best >= 0) return best;
    }
    return -1;
  }

  randomCell(rng: Rng, near?: Vec3, radius = 30): number {
    for (let tries = 0; tries < 60; tries++) {
      let k: number;
      if (near) {
        k = this.index(near.x + rng.range(-radius, radius), near.z + rng.range(-radius, radius));
      } else k = rng.int(0, this.w * this.h - 1);
      if (this.walkable(k)) return k;
    }
    return -1;
  }

  /** A* over the 8-connected grid. Returns world waypoints (excluding start). */
  path(from: Vec3, to: Vec3, maxExpand = 5000): Vec3[] | null {
    const s = this.nearest(from.x, from.z, from.y);
    const g = this.nearest(to.x, to.z, to.y);
    if (s < 0 || g < 0) return null;
    if (s === g) return [this.center(g)];
    const W = this.w;
    const gi = g % W;
    const gj = Math.floor(g / W);
    const gScore = new Map<number, number>();
    const came = new Map<number, number>();
    const heap = new MinHeap();
    gScore.set(s, 0);
    heap.push(s, 0);
    let expanded = 0;
    let found = false;
    while (heap.size > 0 && expanded < maxExpand) {
      const cur = heap.pop();
      if (cur === g) {
        found = true;
        break;
      }
      expanded++;
      const ci = cur % W;
      const cj = Math.floor(cur / W);
      const ch = this.height[cur]!;
      const cg = gScore.get(cur)!;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
          const nk = nj * W + ni;
          if (!this.open[nk]) continue;
          const dh = this.height[nk]! - ch;
          if (dh > 1.25 || dh < -4) continue;
          // No corner cutting.
          if (di && dj && (!this.open[cj * W + ni] || !this.open[nj * W + ci])) continue;
          const cost = cg + (di && dj ? 1.414 : 1) + Math.max(0, dh) * 0.5;
          const prev = gScore.get(nk);
          if (prev !== undefined && prev <= cost) continue;
          gScore.set(nk, cost);
          came.set(nk, cur);
          const hx = Math.abs(ni - gi);
          const hz = Math.abs(nj - gj);
          heap.push(nk, cost + Math.max(hx, hz) + 0.414 * Math.min(hx, hz));
        }
    }
    if (!found) return null;
    const out: Vec3[] = [];
    let k = g;
    while (k !== s) {
      out.push(this.center(k));
      k = came.get(k)!;
    }
    out.reverse();
    // Thin straight runs to keep waypoint lists short.
    const thin: Vec3[] = [];
    for (let i = 0; i < out.length; i++) if (i % 3 === 2 || i === out.length - 1 || Math.abs(out[i]!.y - (out[i - 1]?.y ?? out[i]!.y)) > 0.3) thin.push(out[i]!);
    return thin;
  }
}

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, pri: number): void {
    this.k.push(key);
    this.p.push(pri);
    let i = this.k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.p[par]! <= this.p[i]!) break;
      this.swap(i, par);
      i = par;
    }
  }
  pop(): number {
    const top = this.k[0]!;
    const lk = this.k.pop()!;
    const lp = this.p.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.p[l]! < this.p[m]!) m = l;
        if (r < this.k.length && this.p[r]! < this.p[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b]!, this.k[a]!];
    [this.p[a], this.p[b]] = [this.p[b]!, this.p[a]!];
  }
}
