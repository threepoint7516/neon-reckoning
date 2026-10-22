// Small dependency-free vector helpers shared by client and server.
// Kept allocation-light because they run inside the fixed-step simulation.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy3 = (o: Vec3, a: Vec3): Vec3 => {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
  return o;
};
export const clone3 = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len3 = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const dist3 = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};
export const distXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Shortest signed difference between two angles (radians). */
export const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDiff(a, b) * t;

/**
 * Forward view vector for yaw/pitch. Yaw 0 looks toward -Z (Three.js camera
 * convention), positive yaw turns left, positive pitch looks up.
 */
export const viewDir = (yaw: number, pitch: number): Vec3 => {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
};

/** Rotates a direction by small yaw/pitch offsets (used for spread & recoil). */
export const offsetDir = (yaw: number, pitch: number, dYaw: number, dPitch: number): Vec3 =>
  viewDir(yaw + dYaw, clamp(pitch + dPitch, -1.55, 1.55));

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export const aabbOverlap = (a: AABB, b: AABB): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;

/**
 * Slab ray/AABB intersection. Returns entry distance along the (normalized)
 * direction, or -1 when there is no hit within maxDist. Rays starting inside
 * the box return 0.
 */
export function rayAABB(o: Vec3, d: Vec3, b: AABB, maxDist: number): number {
  let tmin = 0;
  let tmax = maxDist;
  // X
  if (Math.abs(d.x) < 1e-9) {
    if (o.x < b.minX || o.x > b.maxX) return -1;
  } else {
    const inv = 1 / d.x;
    let t1 = (b.minX - o.x) * inv;
    let t2 = (b.maxX - o.x) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < b.minY || o.y > b.maxY) return -1;
  } else {
    const inv = 1 / d.y;
    let t1 = (b.minY - o.y) * inv;
    let t2 = (b.maxY - o.y) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z
  if (Math.abs(d.z) < 1e-9) {
    if (o.z < b.minZ || o.z > b.maxZ) return -1;
  } else {
    const inv = 1 / d.z;
    let t1 = (b.minZ - o.z) * inv;
    let t2 = (b.maxZ - o.z) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Ray vs sphere; returns distance or -1. */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number, maxDist: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxDist) return -1;
  return t;
}
