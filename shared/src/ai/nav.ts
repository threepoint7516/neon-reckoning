import type { CollisionWorld } from "../map/collision";
import type { Vec3 } from "../math";
import type { MapData } from "../map/types";
import { Rng } from "../rng";
import { STEP_HEIGHT } from "../constants";

/** Path waypoint; `door` marks a doorway point that must be hit precisely. */
export interface NavPoint extends Vec3 {
  door?: boolean;
}

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
  private gs: Float32Array | null = null;
  private came: Int32Array | null = null;
  private seen: Uint32Array | null = null;
  private closed: Uint32Array | null = null;
  private stamp = 0;
  /**
   * Per-cell clear links: bit 1 → +X neighbour, 2 → +Z neighbour, 4 → +X
   * two cells over and 8 → +Z two cells over (through a doorway whose wall
   * line blocks the cell in between).
   */
  private edges: Uint8Array;
  /** Doorway waypoints for links that are not straight centre-to-centre (key: cell * 4 + link). */
  private doors = new Map<number, Vec3>();

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
        // Ignore curbs/ledges the player can simply step onto (step height 0.55 m).
        const blocked = world.overlaps({ minX: x - 0.42, maxX: x + 0.42, minY: y + 0.3, maxY: y + 1.75, minZ: z - 0.42, maxZ: z + 0.42 });
        if (blocked) continue;
        const k = j * this.w + i;
        this.height[k] = y;
        this.open[k] = 1;
      }
    // Thin walls and counters can sit between two open cell centres; test the
    // gap between neighbours at body height so A* never routes through them.
    // Side lanes catch doorways that are off the grid lines.
    this.edges = new Uint8Array(this.w * this.h);
    const corridor = (x: number, z: number, di: number, dj: number, len: number, y: number): number | null => {
      for (const o of [0, -0.6, 0.6]) {
        const free = !world.overlaps({
          minX: di ? x : x + o - 0.3, maxX: di ? x + len : x + o + 0.3, minY: y, maxY: y + 1.2,
          minZ: dj ? z : z + o - 0.3, maxZ: dj ? z + len : z + o + 0.3,
        });
        if (free) return o;
      }
      return null;
    };
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const k = j * this.w + i;
        if (!this.open[k]) continue;
        const x = this.x0 + (i + 0.5) * this.cell;
        const z = this.z0 + (j + 0.5) * this.cell;
        for (const [link, di, dj] of [[0, 1, 0], [1, 0, 1]] as const) {
          for (const step of [1, 2]) {
            if (i + di * step >= this.w || j + dj * step >= this.h) continue;
            const nk = (j + dj * step) * this.w + i + di * step;
            if (!this.open[nk]) continue;
            // Two-cell hops only across a single blocked cell (a wall on the grid line).
            if (step === 2 && this.open[(j + dj) * this.w + i + di]) continue;
            const ha = this.height[k]!;
            const hb = this.height[nk]!;
            if (Math.abs(hb - ha) > 1.25) continue;
            const len = this.cell * step;
            const o = corridor(x, z, di, dj, len, Math.max(ha, hb) + STEP_HEIGHT);
            if (o === null) continue;
            const id = link + (step === 2 ? 2 : 0);
            this.edges[k] |= 1 << id;
            if (o !== 0 || step === 2) this.doors.set(k * 4 + id, { x: x + (di ? len / 2 : o), y: (ha + hb) / 2, z: z + (dj ? len / 2 : o) });
          }
        }
      }
  }

  /** Link id (0..3) for an orthogonal move a → b, with the lower-index cell owning it. */
  private linkOf(a: number, b: number): { owner: number; id: number } | null {
    const d = b - a;
    const lo = Math.min(a, b);
    const ad = Math.abs(d);
    if (ad === 1) return { owner: lo, id: 0 };
    if (ad === this.w) return { owner: lo, id: 1 };
    if (ad === 2) return { owner: lo, id: 2 };
    if (ad === 2 * this.w) return { owner: lo, id: 3 };
    return null;
  }

  /** Whether moving between orthogonally linked cells a → b is unobstructed. */
  private edgeClear(a: number, b: number): boolean {
    const l = this.linkOf(a, b);
    return !!l && (this.edges[l.owner]! & (1 << l.id)) !== 0;
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

  /** True when the cell and all 8 neighbours are walkable (≈2 m of clearance). */
  roomy(k: number): boolean {
    if (!this.walkable(k)) return false;
    const i = k % this.w;
    const j = Math.floor(k / this.w);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h || !this.open[nj * this.w + ni]) return false;
      }
    return true;
  }

  /**
   * A* over the 8-connected grid. Returns world waypoints (excluding start).
   * `allow` restricts the search to a subset of walkable cells and `maxDrop`
   * caps downward steps (both used for the payload track); `thin: false`
   * returns every cell instead of a thinned waypoint list.
   */
  path(from: Vec3, to: Vec3, maxExpand = 5000, opts: { allow?: (k: number) => boolean; maxDrop?: number; thin?: boolean } = {}): NavPoint[] | null {
    const allow = opts.allow;
    const ok = (k: number) => this.open[k] === 1 && (!allow || allow(k));
    const maxDrop = opts.maxDrop ?? 4;
    const s = this.nearest(from.x, from.z, from.y);
    const g = this.nearest(to.x, to.z, to.y);
    if (s < 0 || g < 0) return null;
    if (s === g) return [this.center(g)];
    const W = this.w;
    const gi = g % W;
    const gj = Math.floor(g / W);
    // Reusable typed-array scratch (stamped) instead of per-search Maps: A* on the
    // 192×192 battle-royale grid runs several times per second per bot.
    const N = this.w * this.h;
    if (!this.gs || this.gs.length !== N) {
      this.gs = new Float32Array(N);
      this.came = new Int32Array(N);
      this.seen = new Uint32Array(N);
      this.closed = new Uint32Array(N);
    }
    const stamp = ++this.stamp;
    const gs = this.gs;
    const came = this.came!;
    const seen = this.seen!;
    const closed = this.closed!;
    const gGet = (k: number) => (seen[k] === stamp ? gs[k]! : Infinity);
    const heap = new MinHeap();
    seen[s] = stamp;
    gs[s] = 0;
    heap.push(s, 0);
    let expanded = 0;
    let found = false;
    while (heap.size > 0 && expanded < maxExpand) {
      const cur = heap.pop();
      if (cur === g) {
        found = true;
        break;
      }
      if (closed[cur] === stamp) continue; // stale heap entry
      closed[cur] = stamp;
      expanded++;
      const ci = cur % W;
      const cj = Math.floor(cur / W);
      const ch = this.height[cur]!;
      const cg = gs[cur]!;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
          const nk = nj * W + ni;
          if (!ok(nk)) continue;
          const dh = this.height[nk]! - ch;
          if (dh > 1.25 || dh < -maxDrop) continue;
          if (!di || !dj) {
            if (!this.edgeClear(cur, nk)) continue;
          } else {
            // No corner cutting: both orthogonal detours must be open and clear.
            const sa = cj * W + ni;
            const sb = nj * W + ci;
            if (!ok(sa) || !ok(sb)) continue;
            if (!this.edgeClear(cur, sa) || !this.edgeClear(cur, sb) || !this.edgeClear(sa, nk) || !this.edgeClear(sb, nk)) continue;
          }
          const cost = cg + (di && dj ? 1.414 : 1) + Math.max(0, dh) * 0.5;
          if (gGet(nk) <= cost) continue;
          seen[nk] = stamp;
          gs[nk] = cost;
          came[nk] = cur;
          const hx = Math.abs(ni - gi);
          const hz = Math.abs(nj - gj);
          heap.push(nk, cost + Math.max(hx, hz) + 0.414 * Math.min(hx, hz));
        }
      // Doorway hops across a wall that sits on a cell centre line.
      for (const [di, dj] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni;
        if (!ok(nk) || !this.edgeClear(cur, nk)) continue;
        const dh = this.height[nk]! - ch;
        if (dh < -maxDrop) continue;
        const cost = cg + 2 + Math.max(0, dh) * 0.5;
        if (gGet(nk) <= cost) continue;
        seen[nk] = stamp;
        gs[nk] = cost;
        came[nk] = cur;
        const hx = Math.abs(ni - gi);
        const hz = Math.abs(nj - gj);
        heap.push(nk, cost + Math.max(hx, hz) + 0.414 * Math.min(hx, hz));
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let k = g; k !== s; k = came[k]!) cells.push(k);
    cells.push(s);
    cells.reverse();
    const out: NavPoint[] = [];
    for (let i = 1; i < cells.length; i++) {
      // Off-centre doorways get entry, centre and exit points on the clear
      // lane so bots line up with the gap instead of clipping the frame.
      const a = cells[i - 1]!;
      const b = cells[i]!;
      const l = this.linkOf(a, b);
      const door = l ? this.doors.get(l.owner * 4 + l.id) : undefined;
      if (l && door) {
        const sgn = b > a ? 1 : -1;
        const dx = l.id % 2 === 0 ? sgn * 0.9 : 0;
        const dz = l.id % 2 === 1 ? sgn * 0.9 : 0;
        for (const k of [-1, 0, 1]) out.push({ x: door.x + dx * k, y: door.y, z: door.z + dz * k, door: true });
      }
      out.push(this.center(b));
    }
    if (opts.thin === false) return out;
    // Thin straight runs to keep waypoint lists short.
    const thin: NavPoint[] = [];
    for (let i = 0; i < out.length; i++)
      if (i % 3 === 2 || i === out.length - 1 || out[i]!.door || Math.abs(out[i]!.y - (out[i - 1]?.y ?? out[i]!.y)) > 0.3) thin.push(out[i]!);
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
