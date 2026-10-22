import { Rng } from "../rng";
import type { Vec3 } from "../math";
import { BoxFlag, Mat } from "./types";
import type { Box, Ladder, LightSpot, MatId, Sign, SignKind, WaterRect } from "./types";

export const FLOOR_H = 4;
const STEP_RISE = 0.5;
const STEP_RUN = 0.6;
const WALL_T = 0.3;

export type Side = "n" | "s" | "w" | "e";

export interface BuildingOpts {
  floors: number;
  color: number;
  mat?: MatId;
  doors?: Side[];
  roofAccess?: boolean;
  windows?: boolean;
  neon?: number;
  sign?: string;
  parapet?: number;
}

/**
 * Low-level geometry builder used by the district generators. Every helper
 * emits axis-aligned boxes so collision stays exact and cheap.
 */
export class MapBuilder {
  boxes: Box[] = [];
  ladders: Ladder[] = [];
  signs: Sign[] = [];
  lights: LightSpot[] = [];
  water: WaterRect[] = [];
  barrels: Vec3[] = [];
  /** Interesting item spots (interiors, rooftops) — used for loot & pickups. */
  spots: Vec3[] = [];
  roads: { minX: number; minZ: number; maxX: number; maxZ: number }[] = [];
  rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MatId, color: number, flags: number = BoxFlag.SOLID): Box {
    const b: Box = {
      minX: Math.min(x0, x1), minY: Math.min(y0, y1), minZ: Math.min(z0, z1),
      maxX: Math.max(x0, x1), maxY: Math.max(y0, y1), maxZ: Math.max(z0, z1),
      mat, color, flags,
    };
    if (b.maxX - b.minX > 1e-3 && b.maxY - b.minY > 1e-3 && b.maxZ - b.minZ > 1e-3) this.boxes.push(b);
    return b;
  }

  /** Box centered on (cx, cz) in XZ with its bottom at y0. */
  block(cx: number, cz: number, w: number, d: number, h: number, mat: MatId, color: number, y0 = 0, flags: number = BoxFlag.SOLID): Box {
    return this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, mat, color, flags);
  }

  decor(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MatId, color: number): void {
    this.box(x0, y0, z0, x1, y1, z1, mat, color, BoxFlag.DECOR);
  }

  sign(x: number, y: number, z: number, w: number, h: number, face: number, color: number, text: string, kind: SignKind = "sign"): void {
    this.signs.push({ kind, x, y, z, w, h, face, color, text });
  }

  light(x: number, y: number, z: number, color: number, intensity = 1): void {
    this.lights.push({ x, y, z, color, intensity });
  }

  spot(x: number, y: number, z: number): void {
    this.spots.push({ x, y, z });
  }

  barrel(x: number, z: number, y = 0): void {
    this.barrels.push({ x, y, z });
  }

  /** Neon outline along the top edges of a rectangle (decor only). */
  neonRect(x0: number, z0: number, x1: number, z1: number, y: number, color: number, t = 0.08): void {
    this.decor(x0 - t, y, z0 - t, x1 + t, y + t, z0 + t, Mat.NEON, color);
    this.decor(x0 - t, y, z1 - t, x1 + t, y + t, z1 + t, Mat.NEON, color);
    this.decor(x0 - t, y, z0, x0 + t, y + t, z1, Mat.NEON, color);
    this.decor(x1 - t, y, z0, x1 + t, y + t, z1, Mat.NEON, color);
  }

  /**
   * Ladder climb volume against a wall. (x, z) is the point on the wall face;
   * `face` is the outward normal of the wall the ladder is mounted on.
   */
  ladder(x: number, z: number, y0: number, y1: number, face: Side): void {
    const w = 0.5;
    const depth = 0.7;
    let l: Ladder;
    if (face === "n") l = { minX: x - w, maxX: x + w, minZ: z - depth, maxZ: z, minY: y0, maxY: y1 + 1.4 };
    else if (face === "s") l = { minX: x - w, maxX: x + w, minZ: z, maxZ: z + depth, minY: y0, maxY: y1 + 1.4 };
    else if (face === "w") l = { minX: x - depth, maxX: x, minZ: z - w, maxZ: z + w, minY: y0, maxY: y1 + 1.4 };
    else l = { minX: x, maxX: x + depth, minZ: z - w, maxZ: z + w, minY: y0, maxY: y1 + 1.4 };
    this.ladders.push(l);
  }

  /**
   * Solid stair run. Starts at the leading edge (x, z) and climbs along
   * `axis` in direction `dir`. Returns the horizontal run length.
   */
  stairs(x: number, z: number, axis: "x" | "z", dir: 1 | -1, width: number, y0: number, y1: number, mat: MatId, color: number): number {
    const steps = Math.max(1, Math.ceil((y1 - y0) / STEP_RISE - 1e-6));
    const rise = (y1 - y0) / steps;
    for (let i = 0; i < steps; i++) {
      const u0 = i * STEP_RUN * dir;
      const u1 = (i + 1) * STEP_RUN * dir;
      const top = y0 + (i + 1) * rise;
      if (axis === "x") this.box(x + u0, y0, z - width / 2, x + u1, top, z + width / 2, mat, color);
      else this.box(x - width / 2, y0, z + u0, x + width / 2, top, z + u1, mat, color);
    }
    return steps * STEP_RUN;
  }

  /**
   * Wall slab spanning [a0,a1] along `axis`, [b0,b1] across, [y0,y1] up, with
   * rectangular openings given as absolute [u0,u1,v0,v1] (u along axis, v = y).
   */
  wall(axis: "x" | "z", a0: number, a1: number, b0: number, b1: number, y0: number, y1: number, openings: number[][], mat: MatId, color: number): void {
    const ops = openings
      .map((o) => [Math.max(a0, o[0]!), Math.min(a1, o[1]!), Math.max(y0, o[2]!), Math.min(y1, o[3]!)] as const)
      .filter((o) => o[1] > o[0] && o[3] > o[2])
      .sort((p, q) => p[0] - q[0]);
    const emit = (u0: number, u1: number, v0: number, v1: number) => {
      if (u1 - u0 < 1e-3 || v1 - v0 < 1e-3) return;
      if (axis === "x") this.box(u0, v0, b0, u1, v1, b1, mat, color);
      else this.box(b0, v0, u0, b1, v1, u1, mat, color);
    };
    let cur = a0;
    for (const [u0, u1, v0, v1] of ops) {
      if (u0 > cur) emit(cur, u0, y0, y1);
      emit(Math.max(u0, cur), u1, y0, v0);
      emit(Math.max(u0, cur), u1, v1, y1);
      cur = Math.max(cur, u1);
    }
    emit(cur, a1, y0, y1);
  }

  /** Horizontal slab with an optional rectangular hole. */
  slab(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatId, color: number, hole?: [number, number, number, number]): void {
    if (!hole) {
      this.box(x0, y0, z0, x1, y1, z1, mat, color);
      return;
    }
    const [hx0, hz0, hx1, hz1] = hole;
    this.box(x0, y0, z0, hx0, y1, z1, mat, color);
    this.box(hx1, y0, z0, x1, y1, z1, mat, color);
    this.box(hx0, y0, z0, hx1, y1, hz0, mat, color);
    this.box(hx0, y0, hz1, hx1, y1, z1, mat, color);
  }

  /**
   * Enterable multi-floor building with doors, windows, interior switchback
   * stairs, optional roof access and a parapet. (x0, z0) is the min corner.
   * Requires w >= 9 and d >= 7 for interior stairs.
   */
  building(x0: number, z0: number, w: number, d: number, o: BuildingOpts): void {
    const mat = o.mat ?? Mat.FACADE;
    const floors = o.floors;
    const x1 = x0 + w;
    const z1 = z0 + d;
    const t = WALL_T;
    const doors = o.doors ?? ["s"];
    const windows = o.windows ?? true;
    const hasStairs = w >= 9 && d >= 7;
    const roofAccess = (o.roofAccess ?? true) && hasStairs;
    const bandW = 1.4;
    const landing = 1.4;
    const xs = x0 + t + landing;
    const runLen = Math.ceil(FLOOR_H / STEP_RISE - 1e-6) * STEP_RUN;
    const band = (k: number): [number, number] => {
      const b0 = z0 + t + (k % 2) * bandW;
      return [b0, b0 + bandW];
    };

    for (let f = 0; f < floors; f++) {
      const y0 = f * FLOOR_H;
      const y1 = y0 + FLOOR_H;
      const win = (len: number, a0: number): number[][] => {
        if (!windows || len < 4) return [];
        const out: number[][] = [];
        const n = len > 14 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const c = a0 + (len * (i + 1)) / (n + 1);
          out.push([c - 0.75, c + 0.75, y0 + 0.9, y0 + 2.4]);
        }
        return out;
      };
      const door = (side: Side, a0: number, len: number): number[][] => {
        if (f !== 0 || !doors.includes(side)) return [];
        let c = a0 + len / 2;
        if (side === "n" && hasStairs) c = Math.max(c, xs + runLen + 1.3);
        if (side === "w" && hasStairs) c = Math.max(c, z0 + t + bandW * 2 + 1.2);
        c = Math.min(c, a0 + len - 1.2);
        return [[c - 0.95, c + 0.95, y0 - 1, y0 + 2.7]];
      };
      const filt = (wins: number[][], ds: number[][]) =>
        ds.length ? wins.filter((wo) => !ds.some((dd) => wo[1]! > dd[0]! - 0.3 && wo[0]! < dd[1]! + 0.3)) : wins;
      const dn = door("n", x0, w);
      const ds = door("s", x0, w);
      const dw = door("w", z0, d);
      const de = door("e", z0, d);
      this.wall("x", x0, x1, z0, z0 + t, y0, y1, [...dn, ...filt(win(w, x0), dn)], mat, o.color);
      this.wall("x", x0, x1, z1 - t, z1, y0, y1, [...ds, ...filt(win(w, x0), ds)], mat, o.color);
      this.wall("z", z0 + t, z1 - t, x0, x0 + t, y0, y1, [...dw, ...filt(win(d, z0), dw)], mat, o.color);
      this.wall("z", z0 + t, z1 - t, x1 - t, x1, y0, y1, [...de, ...filt(win(d, z0), de)], mat, o.color);
      this.spot(x0 + w * 0.62, y0 + 0.05, z0 + d * 0.68);
    }

    // Slabs for each upper level & roof, with a stairwell hole for the run arriving there.
    for (let L = 1; L <= floors; L++) {
      const y = L * FLOOR_H;
      const runIdx = L - 1;
      const needHole = hasStairs && (L < floors || roofAccess);
      let hole: [number, number, number, number] | undefined;
      if (needHole) {
        const [b0, b1] = band(runIdx);
        hole = [xs - 0.2, b0, xs + runLen + 0.2, b1];
      }
      this.slab(x0, z0, x1, z1, y - 0.3, y, Mat.CONCRETE, 0x3a3f4f, hole);
    }

    if (hasStairs) {
      const runs = roofAccess ? floors : floors - 1;
      for (let k = 0; k < runs; k++) {
        const [b0, b1] = band(k);
        const zc = (b0 + b1) / 2;
        if (k % 2 === 0) this.stairs(xs, zc, "x", 1, bandW, k * FLOOR_H, (k + 1) * FLOOR_H, Mat.METAL, 0x50566a);
        else this.stairs(xs + runLen, zc, "x", -1, bandW, k * FLOOR_H, (k + 1) * FLOOR_H, Mat.METAL, 0x50566a);
      }
    }

    // Roof parapet (cover for rooftop fights).
    const roofY = floors * FLOOR_H;
    const ph = o.parapet ?? 1.0;
    if (ph > 0) {
      this.box(x0, roofY, z0, x1, roofY + ph, z0 + t, Mat.CONCRETE, 0x2c3040);
      this.box(x0, roofY, z1 - t, x1, roofY + ph, z1, Mat.CONCRETE, 0x2c3040);
      this.box(x0, roofY, z0 + t, x0 + t, roofY + ph, z1 - t, Mat.CONCRETE, 0x2c3040);
      this.box(x1 - t, roofY, z0 + t, x1, roofY + ph, z1 - t, Mat.CONCRETE, 0x2c3040);
    }
    if (o.neon !== undefined) this.neonRect(x0, z0, x1, z1, roofY + ph, o.neon);
    if (roofAccess) this.spot(x0 + w * 0.7, roofY + 0.05, z0 + d * 0.7);
    if (o.sign) {
      const side = this.rng.int(0, 1);
      const cx = x0 + w / 2;
      if (side === 0) this.sign(cx, Math.min(roofY - 1.2, 3.6), z1 + 0.06, Math.min(w * 0.6, 7), 1.3, 2, o.neon ?? 0xff2bd6, o.sign);
      else this.sign(cx, Math.min(roofY - 1.2, 3.6), z0 - 0.06, Math.min(w * 0.6, 7), 1.3, 3, o.neon ?? 0x22e5ff, o.sign);
    }
    // Interior light glow.
    this.light(x0 + w / 2, 3.2, z0 + d / 2, o.neon ?? 0xffc68a, 0.5);
  }

  /** Solid high-rise with facade windows, optional exterior ladder to a lower roof. */
  tower(cx: number, cz: number, w: number, d: number, h: number, color: number, neon: number, text?: string): void {
    this.block(cx, cz, w, d, h, Mat.FACADE, color);
    this.neonRect(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, h, neon, 0.12);
    // Rooftop details.
    this.block(cx + w * 0.2, cz - d * 0.15, 2, 2, 1.5, Mat.METAL, 0x444a5c, h);
    this.decor(cx - 0.1, h, cz - 0.1, cx + 0.1, h + 6, cz + 0.1, Mat.METAL, 0x9aa0b4);
    this.light(cx, h + 6.2, cz, 0xff3b3b, 0.6);
    if (text) {
      const f = this.rng.int(0, 3);
      const y = Math.min(h * 0.6, 14);
      const vertical = this.rng.chance(0.5);
      const sw = vertical ? 1.6 : Math.min(w * 0.8, 8);
      const sh = vertical ? Math.min(h * 0.5, 10) : 2;
      if (f === 0) this.sign(cx, y, cz + d / 2 + 0.08, sw, sh, 2, neon, text, vertical ? "strip" : "sign");
      else if (f === 1) this.sign(cx, y, cz - d / 2 - 0.08, sw, sh, 3, neon, text, vertical ? "strip" : "sign");
      else if (f === 2) this.sign(cx + w / 2 + 0.08, y, cz, sw, sh, 0, neon, text, vertical ? "strip" : "sign");
      else this.sign(cx - w / 2 - 0.08, y, cz, sw, sh, 1, neon, text, vertical ? "strip" : "sign");
    }
  }

  container(cx: number, cz: number, alongX: boolean, color: number, y0 = 0): void {
    const L = 6.1;
    const W = 2.45;
    const H = 2.6;
    if (alongX) this.block(cx, cz, L, W, H, Mat.CONTAINER, color, y0);
    else this.block(cx, cz, W, L, H, Mat.CONTAINER, color, y0);
  }

  crate(cx: number, cz: number, s: number, y0 = 0, color = 0x6b5a3e): void {
    this.block(cx, cz, s, s, s, Mat.WOOD, color, y0);
  }

  barrier(cx: number, cz: number, alongX: boolean, len = 3): void {
    if (alongX) this.block(cx, cz, len, 0.6, 1.0, Mat.CONCRETE, 0x8a8f9e);
    else this.block(cx, cz, 0.6, len, 1.0, Mat.CONCRETE, 0x8a8f9e);
  }

  car(cx: number, cz: number, alongX: boolean, color: number, y0 = 0): void {
    const L = 4.4;
    const W = 1.9;
    if (alongX) {
      this.block(cx, cz, L, W, 0.95, Mat.METAL, color, y0 + 0.15);
      this.block(cx - 0.3, cz, 2.2, W - 0.2, 0.6, Mat.GLASS, 0x223040, y0 + 1.1);
      this.decor(cx + L / 2 - 0.02, y0 + 0.6, cz - 0.7, cx + L / 2 + 0.04, y0 + 0.75, cz + 0.7, Mat.NEON, 0xfff2c0);
      this.decor(cx - L / 2 - 0.04, y0 + 0.6, cz - 0.7, cx - L / 2 + 0.02, y0 + 0.75, cz + 0.7, Mat.NEON, 0xff2040);
    } else {
      this.block(cx, cz, W, L, 0.95, Mat.METAL, color, y0 + 0.15);
      this.block(cx, cz - 0.3, W - 0.2, 2.2, 0.6, Mat.GLASS, 0x223040, y0 + 1.1);
      this.decor(cx - 0.7, y0 + 0.6, cz + L / 2 - 0.02, cx + 0.7, y0 + 0.75, cz + L / 2 + 0.04, Mat.NEON, 0xfff2c0);
      this.decor(cx - 0.7, y0 + 0.6, cz - L / 2 - 0.04, cx + 0.7, y0 + 0.75, cz - L / 2 + 0.02, Mat.NEON, 0xff2040);
    }
  }

  /** Chain-link fence: blocks movement, lets bullets through. */
  fence(x0: number, z0: number, x1: number, z1: number, h = 2.6): void {
    this.box(x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, h, z1 + 0.05, Mat.FENCE, 0x8899aa, BoxFlag.BULLET_PASS);
  }

  lamp(x: number, z: number, color: number, h = 6): void {
    this.box(x - 0.12, 0, z - 0.12, x + 0.12, h, z + 0.12, Mat.METAL, 0x3a3e4a);
    this.decor(x - 0.35, h, z - 0.35, x + 0.35, h + 0.15, z + 0.35, Mat.NEON, color);
    this.light(x, h - 0.2, z, color, 0.8);
  }

  /** Stepped hill made of walkable terraces (each rise < step height). */
  hill(cx: number, cz: number, rx: number, rz: number, levels: number, mat: MatId, color: number): void {
    for (let i = 0; i < levels; i++) {
      const k = 1 - i / levels;
      this.block(cx, cz, rx * 2 * k, rz * 2 * k, 0.5, mat, color, i * 0.5);
    }
    this.spot(cx, levels * 0.5 + 0.05, cz);
  }
}
