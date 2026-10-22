import type { Vec3 } from "../math";
import type { DistrictId, WeaponId } from "../types";

/** Material ids drive rendering (texture/shader) and impact effects/sounds. */
export const Mat = {
  CONCRETE: 0,
  METAL: 1,
  FACADE: 2,
  CONTAINER: 3,
  GLASS: 4,
  NEON: 5,
  ASPHALT: 6,
  GROUND: 7,
  WOOD: 8,
  DIRT: 9,
  TRIM: 10,
  PANEL: 11,
  ROCK: 12,
  FENCE: 13,
  BARRIER: 14,
} as const;
export type MatId = (typeof Mat)[keyof typeof Mat];

export const BoxFlag = {
  /** Blocks movement and bullets. */
  SOLID: 1,
  /** Blocks movement but bullets/grenades pass (chain-link fences, grates). */
  BULLET_PASS: 2,
  /** Rendered only (no collision): neon trims, signs backing, distant props. */
  DECOR: 4,
} as const;

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  mat: MatId;
  /** RGB tint (0xRRGGBB). */
  color: number;
  flags: number;
}

export interface Ladder {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export type SignKind = "sign" | "holo" | "billboard" | "strip";

/** Non-colliding visual decoration placed on surfaces. */
export interface Sign {
  kind: SignKind;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  /** Facing direction of the sign (unit axis vector index: 0 +X, 1 -X, 2 +Z, 3 -Z, 4 up). */
  face: number;
  color: number;
  text: string;
}

export interface LightSpot {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
}

export type PickupKind = "weapon" | "ammo" | "health" | "armor" | "grenade" | "power";

export interface PickupSpot {
  pos: Vec3;
  kind: PickupKind;
  weapon?: WeaponId;
}

export interface District {
  id: DistrictId;
  name: string;
  tagline: string;
  /** Playable rectangle for arena modes. */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  accent: number;
  spawns: Vec3[];
  pickups: PickupSpot[];
  /** Domination control points A, B, C. */
  points: Vec3[];
  /** Landmark position (shown on the map overlay). */
  landmark: Vec3;
}

export interface WaterRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  level: number;
}

export interface MapData {
  name: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  boxes: Box[];
  ladders: Ladder[];
  signs: Sign[];
  lights: LightSpot[];
  water: WaterRect[];
  districts: District[];
  /** Explosive barrel positions (entities at runtime). */
  barrels: Vec3[];
  /** Battle royale loot positions across the whole region. */
  loot: Vec3[];
  /** Raised street/road network for the map overlay. */
  roads: { minX: number; minZ: number; maxX: number; maxZ: number }[];
}
