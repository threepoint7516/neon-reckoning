import type { AABB } from "../math";
import type { StairRun } from "./types";

/** Clear height kept above every step and landing (player height + margin). */
const HEADROOM = 1.85;
/** Player radius plus a little slack: the body overhangs the step it stands on. */
const BODY = 0.4;
/** Landing length kept clear before the first and after the last step. */
const LANDING = 0.9;
/** Boxes up to this height at a landing are curbs/thresholds the player steps over. */
const STEPPABLE = 0.55;

/**
 * The space a player needs to walk a flight of stairs: above each step
 * (stretched by the body radius, so the head clears the next step) plus a
 * landing at both ends. Anything solid in here blocks or snags players.
 */
export function stairVolumes(r: StairRun): AABB[] {
  const run = r.len / r.steps;
  const rise = (r.y1 - r.y0) / r.steps;
  const hw = r.width / 2 - 0.05;
  const vol = (u0: number, u1: number, floor: number): AABB => {
    const a = r.dir > 0 ? u0 : -u1;
    const b = r.dir > 0 ? u1 : -u0;
    return r.axis === "x"
      ? { minX: r.x + a, maxX: r.x + b, minY: floor + 0.02, maxY: floor + HEADROOM, minZ: r.z - hw, maxZ: r.z + hw }
      : { minX: r.x - hw, maxX: r.x + hw, minY: floor + 0.02, maxY: floor + HEADROOM, minZ: r.z + a, maxZ: r.z + b };
  };
  const out: AABB[] = [];
  for (let i = 0; i < r.steps; i++) out.push(vol(i * run - BODY, (i + 1) * run + BODY, r.y0 + (i + 1) * rise));
  const start = vol(-LANDING, -0.05, r.y0);
  const end = vol(r.len + 0.05, r.len + LANDING, r.y1);
  start.minY += STEPPABLE;
  end.minY += STEPPABLE;
  out.push(start, end);
  return out;
}

/** Bounding box of all of a run's volumes. */
export function stairBounds(vols: AABB[]): AABB {
  const b = { ...vols[0]! };
  for (const v of vols) {
    b.minX = Math.min(b.minX, v.minX);
    b.minY = Math.min(b.minY, v.minY);
    b.minZ = Math.min(b.minZ, v.minZ);
    b.maxX = Math.max(b.maxX, v.maxX);
    b.maxY = Math.max(b.maxY, v.maxY);
    b.maxZ = Math.max(b.maxZ, v.maxZ);
  }
  return b;
}

export const overlaps = (a: AABB, b: AABB) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
