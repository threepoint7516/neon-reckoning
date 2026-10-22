import type { WeaponId } from "../types";

export type FireMode = "auto" | "semi" | "burst" | "pump" | "bolt";
export type WeaponSlotKind = "primary" | "secondary" | "power";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  category: string;
  blurb: string;
  /** Identity color for glow strips, tracers and UI. */
  color: number;
  slot: WeaponSlotKind;
  fireMode: FireMode;
  /** Seconds between shots (or bursts). */
  fireInterval: number;
  burstCount?: number;
  burstInterval?: number;
  damage: number;
  headMult: number;
  pellets: number;
  /** Damage falloff: full until rangeStart, linear to minDamageMult at rangeEnd. */
  rangeStart: number;
  rangeEnd: number;
  minDamageMult: number;
  maxRange: number;
  mag: number;
  reserve: number;
  reloadTime: number;
  /** If set, reloads one round at a time (interruptible by firing). */
  reloadPerRound?: number;
  // Spread in degrees.
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  spreadAir: number;
  spreadPerShot: number;
  spreadMax: number;
  spreadRecovery: number;
  /** Fixed pellet cone for shotguns (degrees), independent of bloom. */
  pelletCone?: number;
  // Camera recoil (client-side, degrees). Pattern climbs vertically and sways.
  recoilUp: number;
  recoilSide: number;
  recoilRecover: number;
  adsTime: number;
  /** FOV multiplier while fully aimed. */
  adsZoom: number;
  moveMult: number;
  swapTime: number;
  /** Projectile weapons (Nova Cannon). */
  projectile?: { speed: number; gravity: number; splashRadius: number; splashDamage: number };
  /** Chain lightning (Arcstorm). */
  chain?: { range: number; damage: number; max: number };
  /** Number of extra players a round can pass through (Railspike). */
  pierce?: number;
  /** Max thickness (m) of cover a round can punch through. */
  wallPen?: number;
  /** Magazines restored per ammo pickup (0 = power weapon, no refills). */
  ammoPickupMags: number;
  /** Relative synth parameters for the procedural gunshot. */
  sound: { pitch: number; body: number; crack: number; tail: number; kind: "ballistic" | "energy" | "heavy" };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pulse9: {
    id: "pulse9", name: "Pulse-9", category: "Assault Rifle",
    blurb: "Balanced full-auto rifle. Controllable climb, reliable at mid range.",
    color: 0x22e5ff, slot: "primary", fireMode: "auto", fireInterval: 0.1,
    damage: 24, headMult: 1.6, pellets: 1, rangeStart: 28, rangeEnd: 70, minDamageMult: 0.7, maxRange: 220,
    mag: 30, reserve: 150, reloadTime: 1.9,
    spreadHip: 2.4, spreadAds: 0.35, spreadMove: 1.6, spreadAir: 4, spreadPerShot: 0.22, spreadMax: 3.2, spreadRecovery: 9,
    recoilUp: 0.55, recoilSide: 0.25, recoilRecover: 7, adsTime: 0.22, adsZoom: 0.78, moveMult: 1, swapTime: 0.45,
    ammoPickupMags: 2, sound: { pitch: 1, body: 0.8, crack: 0.7, tail: 0.5, kind: "ballistic" },
  },
  viper: {
    id: "viper", name: "Viper SMG", category: "Submachine Gun",
    blurb: "Blistering fire rate and light handling. Dominates close quarters, fades fast at range.",
    color: 0x7dff3a, slot: "primary", fireMode: "auto", fireInterval: 0.066,
    damage: 17, headMult: 1.4, pellets: 1, rangeStart: 12, rangeEnd: 32, minDamageMult: 0.55, maxRange: 140,
    mag: 35, reserve: 175, reloadTime: 1.6,
    spreadHip: 2.6, spreadAds: 1.1, spreadMove: 0.6, spreadAir: 2.4, spreadPerShot: 0.18, spreadMax: 4, spreadRecovery: 11,
    recoilUp: 0.32, recoilSide: 0.35, recoilRecover: 9, adsTime: 0.16, adsZoom: 0.88, moveMult: 1.07, swapTime: 0.35,
    ammoPickupMags: 2, sound: { pitch: 1.35, body: 0.5, crack: 0.6, tail: 0.3, kind: "ballistic" },
  },
  breachmaker: {
    id: "breachmaker", name: "Breachmaker", category: "Shotgun",
    blurb: "Pump-action door kicker. Nine pellets, devastating inside ten metres.",
    color: 0xff8a1f, slot: "primary", fireMode: "pump", fireInterval: 0.8,
    damage: 12, headMult: 1.25, pellets: 9, rangeStart: 7, rangeEnd: 20, minDamageMult: 0.2, maxRange: 60,
    mag: 6, reserve: 30, reloadTime: 2.8, reloadPerRound: 0.48,
    spreadHip: 0.5, spreadAds: 0.2, spreadMove: 0.4, spreadAir: 1, spreadPerShot: 0, spreadMax: 1, spreadRecovery: 10, pelletCone: 5.5,
    recoilUp: 3.2, recoilSide: 0.8, recoilRecover: 6, adsTime: 0.2, adsZoom: 0.9, moveMult: 1.02, swapTime: 0.5,
    ammoPickupMags: 2, sound: { pitch: 0.7, body: 1, crack: 0.9, tail: 0.8, kind: "heavy" },
  },
  longshot: {
    id: "longshot", name: "Longshot-X", category: "Sniper Rifle",
    blurb: "Bolt-action precision. One headshot ends any fight, but hip-fire is a gamble.",
    color: 0xb36bff, slot: "primary", fireMode: "bolt", fireInterval: 1.25,
    damage: 98, headMult: 2.5, pellets: 1, rangeStart: 300, rangeEnd: 400, minDamageMult: 1, maxRange: 400,
    mag: 5, reserve: 25, reloadTime: 2.6,
    spreadHip: 7, spreadAds: 0, spreadMove: 3, spreadAir: 8, spreadPerShot: 0, spreadMax: 0, spreadRecovery: 10,
    recoilUp: 4.5, recoilSide: 0.6, recoilRecover: 4, adsTime: 0.32, adsZoom: 0.3, moveMult: 0.92, swapTime: 0.6,
    ammoPickupMags: 1, sound: { pitch: 0.55, body: 1, crack: 1, tail: 1, kind: "heavy" },
  },
  helix47: {
    id: "helix47", name: "Helix-47", category: "Burst Rifle",
    blurb: "Three-round bursts with tight grouping. Rewards rhythm and tracking.",
    color: 0x00ffb3, slot: "primary", fireMode: "burst", fireInterval: 0.34, burstCount: 3, burstInterval: 0.065,
    damage: 30, headMult: 1.5, pellets: 1, rangeStart: 35, rangeEnd: 80, minDamageMult: 0.72, maxRange: 220,
    mag: 30, reserve: 150, reloadTime: 2.1,
    spreadHip: 2, spreadAds: 0.25, spreadMove: 1.4, spreadAir: 4, spreadPerShot: 0.12, spreadMax: 1.6, spreadRecovery: 8,
    recoilUp: 0.7, recoilSide: 0.15, recoilRecover: 8, adsTime: 0.24, adsZoom: 0.75, moveMult: 0.98, swapTime: 0.45,
    ammoPickupMags: 2, sound: { pitch: 1.1, body: 0.7, crack: 0.8, tail: 0.5, kind: "ballistic" },
  },
  titan: {
    id: "titan", name: "Titan Drum", category: "Light Machine Gun",
    blurb: "100-round drum for suppression. Heavy, slow to aim, relentless once it sings.",
    color: 0xff3b6b, slot: "primary", fireMode: "auto", fireInterval: 0.085,
    damage: 22, headMult: 1.4, pellets: 1, rangeStart: 30, rangeEnd: 75, minDamageMult: 0.7, maxRange: 220,
    mag: 100, reserve: 200, reloadTime: 4.2,
    spreadHip: 3.2, spreadAds: 0.6, spreadMove: 2.2, spreadAir: 5, spreadPerShot: 0.12, spreadMax: 3.2, spreadRecovery: 6,
    recoilUp: 0.45, recoilSide: 0.4, recoilRecover: 6, adsTime: 0.36, adsZoom: 0.8, moveMult: 0.86, swapTime: 0.7,
    ammoPickupMags: 1, sound: { pitch: 0.85, body: 1, crack: 0.6, tail: 0.6, kind: "ballistic" },
  },
  phantom: {
    id: "phantom", name: "Phantom Sidearm", category: "Pistol",
    blurb: "Quick-draw semi-auto. Swap to it when your primary runs dry.",
    color: 0xe8f0ff, slot: "secondary", fireMode: "semi", fireInterval: 0.14,
    damage: 27, headMult: 1.75, pellets: 1, rangeStart: 18, rangeEnd: 45, minDamageMult: 0.6, maxRange: 140,
    mag: 12, reserve: 72, reloadTime: 1.25,
    spreadHip: 1.4, spreadAds: 0.5, spreadMove: 0.6, spreadAir: 2.5, spreadPerShot: 0.35, spreadMax: 2.5, spreadRecovery: 10,
    recoilUp: 1.4, recoilSide: 0.3, recoilRecover: 10, adsTime: 0.14, adsZoom: 0.88, moveMult: 1.06, swapTime: 0.22,
    ammoPickupMags: 2, sound: { pitch: 1.25, body: 0.5, crack: 0.8, tail: 0.3, kind: "ballistic" },
  },
  railspike: {
    id: "railspike", name: "Railspike", category: "Marksman Rifle",
    blurb: "Magnetic slugs pierce bodies and thin cover. Semi-auto precision for patient players.",
    color: 0x3d8bff, slot: "primary", fireMode: "semi", fireInterval: 0.36,
    damage: 52, headMult: 2, pellets: 1, rangeStart: 60, rangeEnd: 140, minDamageMult: 0.85, maxRange: 300,
    mag: 10, reserve: 50, reloadTime: 2.3,
    spreadHip: 3.5, spreadAds: 0.05, spreadMove: 2.5, spreadAir: 6, spreadPerShot: 0.5, spreadMax: 2, spreadRecovery: 8,
    recoilUp: 2.2, recoilSide: 0.4, recoilRecover: 6, adsTime: 0.28, adsZoom: 0.55, moveMult: 0.95, swapTime: 0.5,
    pierce: 2, wallPen: 0.6,
    ammoPickupMags: 1, sound: { pitch: 0.9, body: 0.6, crack: 1, tail: 0.9, kind: "energy" },
  },
  arcstorm: {
    id: "arcstorm", name: "Arcstorm", category: "Energy Weapon",
    blurb: "Power weapon. Lightning arcs leap to up to two nearby enemies. Hard 35 m range.",
    color: 0x6af0ff, slot: "power", fireMode: "auto", fireInterval: 0.1,
    damage: 15, headMult: 1.2, pellets: 1, rangeStart: 20, rangeEnd: 35, minDamageMult: 0.8, maxRange: 35,
    mag: 60, reserve: 60, reloadTime: 2.2,
    spreadHip: 1, spreadAds: 0.6, spreadMove: 0.3, spreadAir: 1, spreadPerShot: 0, spreadMax: 1, spreadRecovery: 10,
    recoilUp: 0.15, recoilSide: 0.12, recoilRecover: 10, adsTime: 0.2, adsZoom: 0.9, moveMult: 0.95, swapTime: 0.5,
    chain: { range: 7, damage: 9, max: 2 },
    ammoPickupMags: 0, sound: { pitch: 1.6, body: 0.3, crack: 0.4, tail: 0.4, kind: "energy" },
  },
  nova: {
    id: "nova", name: "Nova Cannon", category: "Experimental",
    blurb: "Power weapon. Slow plasma orb with a huge blast. Only six shots — make them count.",
    color: 0xff2bd6, slot: "power", fireMode: "semi", fireInterval: 0.95,
    damage: 60, headMult: 1, pellets: 1, rangeStart: 999, rangeEnd: 999, minDamageMult: 1, maxRange: 200,
    mag: 3, reserve: 3, reloadTime: 2.8,
    spreadHip: 0.6, spreadAds: 0.1, spreadMove: 0.6, spreadAir: 1, spreadPerShot: 0, spreadMax: 0, spreadRecovery: 10,
    recoilUp: 5, recoilSide: 1, recoilRecover: 4, adsTime: 0.3, adsZoom: 0.85, moveMult: 0.9, swapTime: 0.65,
    projectile: { speed: 42, gravity: 4, splashRadius: 5, splashDamage: 105 },
    ammoPickupMags: 0, sound: { pitch: 0.4, body: 1, crack: 0.3, tail: 1, kind: "energy" },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const PRIMARY_IDS = WEAPON_IDS.filter((w) => WEAPONS[w].slot === "primary");
export const SECONDARY_IDS = WEAPON_IDS.filter((w) => WEAPONS[w].slot === "secondary");
export const POWER_IDS = WEAPON_IDS.filter((w) => WEAPONS[w].slot === "power");
/** Stable numeric index for compact snapshots. */
export const weaponIndex = (id: WeaponId | null | undefined): number => (id ? WEAPON_IDS.indexOf(id) : -1);
export const weaponFromIndex = (i: number): WeaponId | null => (i >= 0 && i < WEAPON_IDS.length ? WEAPON_IDS[i]! : null);

/** Damage of one pellet/round at a given distance, before head multiplier & armor. */
export function damageAtRange(def: WeaponDef, dist: number): number {
  if (dist <= def.rangeStart) return def.damage;
  if (dist >= def.rangeEnd) return def.damage * def.minDamageMult;
  const t = (dist - def.rangeStart) / (def.rangeEnd - def.rangeStart);
  return def.damage * (1 + (def.minDamageMult - 1) * t);
}
