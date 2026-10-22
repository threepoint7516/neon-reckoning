import {
  AIR_ACCEL, AIR_MAX_SPEED, Btn, CROUCH_EYE_HEIGHT, CROUCH_HEIGHT, CROUCH_SPEED, EYE_HEIGHT, FALL_DAMAGE_PER_MS,
  FALL_DAMAGE_THRESHOLD, GLIDE_AIR_SPEED, GLIDE_FALL_SPEED, GRAVITY, GROUND_ACCEL, GROUND_FRICTION, JUMP_VELOCITY,
  LADDER_SPEED, MAX_HEALTH, PLAYER_HEIGHT, PLAYER_RADIUS, SLIDE_BOOST, SLIDE_COOLDOWN, SLIDE_FRICTION, SLIDE_MIN_SPEED,
  SLIDE_TIME, SPAWN_ARMOR, SPRINT_SPEED, STEP_HEIGHT, WALK_SPEED,
} from "../constants";
import type { AABB, Vec3 } from "../math";
import { clamp, offsetDir, viewDir } from "../math";
import { hash01 } from "../rng";
import type { CollisionWorld } from "../map/collision";
import { WEAPONS } from "../balance/weapons";
import type { WeaponDef } from "../balance/weapons";
import { GRENADES, GRENADE_IDS, INJECTOR, PLATE, TACTICALS } from "../balance/equipment";
import type { GrenadeId, Loadout, PlayerInput, TacticalId, WeaponId } from "../types";

export interface WeaponSlot {
  id: WeaponId;
  mag: number;
  reserve: number;
}

/**
 * Complete simulated state of one player. Plain data so it can be cloned for
 * prediction replay and serialized into the owner's snapshot.
 */
export interface PlayerState {
  id: number;
  team: number;
  alive: boolean;
  downed: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  crouched: boolean;
  slideT: number;
  slideCd: number;
  gliding: boolean;
  ladderCd: number;
  sprinting: boolean;
  prevB: number;
  health: number;
  armor: number;
  slots: (WeaponSlot | null)[];
  active: number;
  swapT: number;
  fireCd: number;
  reloadT: number;
  burstLeft: number;
  burstT: number;
  spread: number;
  sprayN: number;
  sprayT: number;
  ads: number;
  nades: Record<GrenadeId, number>;
  nadeSel: GrenadeId;
  nadeCd: number;
  tactical: TacticalId;
  tacCd: number;
  injectors: number;
  plates: number;
  chan: "" | "heal" | "plate";
  chanT: number;
  spawnProt: number;
  shotN: number;
  flash: number;
  emp: number;
  overdrive: number;
  seed: number;
}

export interface StepEnv {
  world: CollisionWorld;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  gravity: number;
  tacticalRate: number;
  maxArmor: number;
}

/** Visual/audio cues raised by the simulation (used for local effects). */
export type SimFx = "shot" | "reload" | "dry" | "jump" | "land" | "swap" | "slide" | "heal" | "plate" | "throw" | "chanDone";

/**
 * Authority hooks. On the server these resolve hits, spawn projectiles and
 * apply damage; during client prediction they only produce visual feedback.
 */
export interface SimHooks {
  fireHitscan(p: PlayerState, def: WeaponDef, origin: Vec3, dirs: Vec3[]): void;
  fireProjectile(p: PlayerState, def: WeaponDef, origin: Vec3, dir: Vec3): void;
  throwGrenade(p: PlayerState, type: GrenadeId, origin: Vec3, dir: Vec3): void;
  useTactical(p: PlayerState): boolean;
  interact(p: PlayerState, held: boolean, pressed: boolean): void;
  fallDamage(p: PlayerState, amount: number): void;
  fx(p: PlayerState, fx: SimFx, extra?: number): void;
}

export interface SpawnKit {
  armor: number;
  injectors: number;
  plates: number;
  grenades: boolean;
  weapons: boolean;
}

export const ARENA_KIT: SpawnKit = { armor: SPAWN_ARMOR, injectors: INJECTOR.spawnCount, plates: PLATE.spawnCount, grenades: true, weapons: true };
export const BR_KIT: SpawnKit = { armor: 0, injectors: 0, plates: 0, grenades: false, weapons: false };

export function makeSlot(id: WeaponId, full = true): WeaponSlot {
  const d = WEAPONS[id];
  return { id, mag: d.mag, reserve: full ? d.reserve : d.mag };
}

export function createPlayerState(id: number, team: number, loadout: Loadout): PlayerState {
  return {
    id, team, alive: false, downed: false,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    onGround: false, crouched: false, slideT: 0, slideCd: 0, gliding: false, ladderCd: 0, sprinting: false, prevB: 0,
    health: MAX_HEALTH, armor: 0,
    slots: [makeSlot(loadout.primary), makeSlot(loadout.secondary), null], active: 0,
    swapT: 0, fireCd: 0, reloadT: 0, burstLeft: 0, burstT: 0, spread: 0, sprayN: 0, sprayT: 0, ads: 0,
    nades: { frag: 0, smoke: 0, flash: 0, emp: 0 }, nadeSel: "frag", nadeCd: 0,
    tactical: loadout.tactical, tacCd: 0, injectors: 0, plates: 0, chan: "", chanT: 0,
    spawnProt: 0, shotN: 0, flash: 0, emp: 0, overdrive: 0, seed: (id * 7919 + 17) | 0,
  };
}

/** Resets vitals/inventory for a (re)spawn. */
export function resetForSpawn(p: PlayerState, loadout: Loadout, kit: SpawnKit, pos: Vec3, yaw: number): void {
  p.alive = true;
  p.downed = false;
  p.x = pos.x;
  p.y = pos.y;
  p.z = pos.z;
  p.vx = p.vy = p.vz = 0;
  p.yaw = yaw;
  p.pitch = 0;
  p.onGround = false;
  p.crouched = false;
  p.slideT = p.slideCd = 0;
  p.gliding = false;
  p.health = MAX_HEALTH;
  p.armor = kit.armor;
  p.injectors = kit.injectors;
  p.plates = kit.plates;
  if (kit.weapons) p.slots = [makeSlot(loadout.primary), makeSlot(loadout.secondary), null];
  else p.slots = [null, makeSlot("phantom", false), null];
  p.active = p.slots[0] ? 0 : 1;
  p.tactical = loadout.tactical;
  p.tacCd = 0;
  p.swapT = 0.3;
  p.fireCd = p.reloadT = p.burstLeft = p.burstT = p.spread = p.sprayN = 0;
  p.ads = 0;
  p.chan = "";
  p.chanT = 0;
  p.flash = p.emp = p.overdrive = 0;
  for (const g of GRENADE_IDS) p.nades[g] = kit.grenades ? GRENADES[g].spawnCount : 0;
  p.nadeSel = "frag";
}

export const eyeHeight = (p: PlayerState) => (p.downed ? 0.6 : p.crouched ? CROUCH_EYE_HEIGHT : EYE_HEIGHT);
export const bodyHeight = (p: PlayerState) => (p.downed ? 0.8 : p.crouched ? CROUCH_HEIGHT : PLAYER_HEIGHT);
export const eyePos = (p: PlayerState): Vec3 => ({ x: p.x, y: p.y + eyeHeight(p), z: p.z });

export function playerAABB(p: PlayerState, h = bodyHeight(p)): AABB {
  return { minX: p.x - PLAYER_RADIUS, maxX: p.x + PLAYER_RADIUS, minY: p.y, maxY: p.y + h, minZ: p.z - PLAYER_RADIUS, maxZ: p.z + PLAYER_RADIUS };
}

export function activeWeapon(p: PlayerState): WeaponDef | null {
  const s = p.slots[p.active];
  return s ? WEAPONS[s.id] : null;
}

const scratchDirs: Vec3[] = [];

/** Advances one player by one fixed step (SIM_DT). Deterministic. */
export function stepPlayer(p: PlayerState, inp: PlayerInput, env: StepEnv, hooks: SimHooks, dt: number): void {
  const b = inp.b;
  const edge = b & ~p.prevB;
  p.prevB = b;
  p.yaw = inp.yaw;
  p.pitch = clamp(inp.pitch, -1.55, 1.55);
  if (!p.alive) return;

  // Timers.
  p.slideCd = Math.max(0, p.slideCd - dt);
  p.ladderCd = Math.max(0, p.ladderCd - dt);
  p.spawnProt = Math.max(0, p.spawnProt - dt);
  p.flash = Math.max(0, p.flash - dt);
  p.emp = Math.max(0, p.emp - dt);
  p.overdrive = Math.max(0, p.overdrive - dt);
  p.nadeCd = Math.max(0, p.nadeCd - dt);
  if (p.emp <= 0) p.tacCd = Math.max(0, p.tacCd - dt * env.tacticalRate);

  move(p, inp, edge, env, hooks, dt);
  if (!p.downed) {
    weapons(p, inp, edge, env, hooks, dt);
    equipment(p, inp, edge, env, hooks, dt);
  }
  hooks.interact(p, (b & Btn.USE) !== 0, (edge & Btn.USE) !== 0);
}

function move(p: PlayerState, inp: PlayerInput, edge: number, env: StepEnv, hooks: SimHooks, dt: number): void {
  const b = inp.b;
  const world = env.world;
  const mx = clamp(inp.mx, -1, 1);
  const mz = clamp(inp.mz, -1, 1);
  const sy = Math.sin(p.yaw);
  const cy = Math.cos(p.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  let wx = -sy * mz + cy * mx;
  let wz = -cy * mz - sy * mx;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) {
    wx /= wl;
    wz /= wl;
  }
  const wishLen = Math.min(1, wl);
  const hspeed = Math.hypot(p.vx, p.vz);
  const def = activeWeapon(p);

  // Crouch / slide.
  const wantCrouch = (b & Btn.CROUCH) !== 0 || p.downed;
  if ((edge & Btn.CROUCH) && p.onGround && hspeed >= SLIDE_MIN_SPEED && p.slideCd <= 0 && !p.downed) {
    p.slideT = SLIDE_TIME;
    p.slideCd = SLIDE_TIME + SLIDE_COOLDOWN;
    const k = Math.min(hspeed + SLIDE_BOOST, 13) / (hspeed || 1);
    p.vx *= k;
    p.vz *= k;
    hooks.fx(p, "slide");
  }
  if (p.slideT > 0) {
    p.slideT -= dt;
    if (!wantCrouch || !p.onGround) p.slideT = Math.min(p.slideT, 0);
  }
  if (wantCrouch) p.crouched = true;
  else if (p.crouched && !world.overlaps(playerAABB(p, PLAYER_HEIGHT))) p.crouched = false;

  // Sprint.
  const firing = (b & Btn.FIRE) !== 0;
  p.sprinting =
    (b & Btn.SPRINT) !== 0 && mz > 0.1 && !p.crouched && p.ads < 0.3 && !firing && p.chan === "" && !p.downed && p.burstLeft === 0;
  if (p.sprinting && p.reloadT > 0 && def?.reloadPerRound) p.reloadT = 0;

  let maxSpeed = p.downed ? 1.4 : p.sprinting ? SPRINT_SPEED : p.crouched ? CROUCH_SPEED : WALK_SPEED;
  if (def) maxSpeed *= def.moveMult * (1 - 0.35 * p.ads);
  if (p.chan) maxSpeed *= 0.6;
  if (p.overdrive > 0) maxSpeed *= 1.15;
  const wishSpeed = maxSpeed * wishLen;

  // Ladders.
  const box = playerAABB(p);
  const ladder = p.ladderCd <= 0 && !p.downed ? world.ladderAt(box) : null;
  let onLadder = false;
  if (ladder && (mz !== 0 || !p.onGround)) {
    onLadder = true;
    p.gliding = false;
    p.vy = mz * LADDER_SPEED;
    p.vx = wx * 2.2;
    p.vz = wz * 2.2;
    if (edge & Btn.JUMP) {
      p.ladderCd = 0.35;
      p.vy = 4.5;
      p.vx = sy * 4;
      p.vz = cy * 4;
    }
  }

  if (!onLadder) {
    if (p.gliding) {
      // Insertion glide: slow fall with strong air control.
      p.vy = Math.max(p.vy - GRAVITY * 0.35 * dt, -GLIDE_FALL_SPEED);
      const tx = wx * GLIDE_AIR_SPEED;
      const tz = wz * GLIDE_AIR_SPEED;
      p.vx += (tx - p.vx) * Math.min(1, 2.5 * dt);
      p.vz += (tz - p.vz) * Math.min(1, 2.5 * dt);
    } else if (p.onGround) {
      if (p.slideT > 0) {
        const s = Math.hypot(p.vx, p.vz);
        if (s > 0) {
          const ns = Math.max(0, s - SLIDE_FRICTION * dt * Math.max(s, 2));
          p.vx *= ns / s;
          p.vz *= ns / s;
        }
        // Light steering while sliding.
        p.vx += wx * 4 * dt;
        p.vz += wz * 4 * dt;
        if (hSpeed(p) < CROUCH_SPEED) p.slideT = 0;
      } else {
        const s = Math.hypot(p.vx, p.vz);
        if (s > 0) {
          const drop = Math.max(s, 2.5) * GROUND_FRICTION * dt;
          const nsp = Math.max(0, s - drop);
          p.vx *= nsp / s;
          p.vz *= nsp / s;
        }
        accelerate(p, wx, wz, wishSpeed, GROUND_ACCEL * wishSpeed * dt);
      }
      if ((b & Btn.JUMP) && !p.downed && !(p.crouched && p.slideT <= 0 && world.overlaps(playerAABB(p, PLAYER_HEIGHT)))) {
        p.vy = JUMP_VELOCITY * Math.sqrt(env.gravity);
        p.onGround = false;
        p.slideT = 0;
        hooks.fx(p, "jump");
      }
    } else {
      // Air: Quake-style capped acceleration enables subtle air-strafing.
      const cur = p.vx * wx + p.vz * wz;
      const add = Math.min(AIR_MAX_SPEED, wishSpeed) - cur;
      if (add > 0 && wishLen > 0) {
        const a = Math.min(add, AIR_ACCEL * dt * Math.max(wishSpeed, 1));
        p.vx += wx * a;
        p.vz += wz * a;
      }
    }
    if (!p.gliding) p.vy -= GRAVITY * env.gravity * dt;
  }

  // Hard cap horizontal speed (anti-exploit).
  const hs = Math.hypot(p.vx, p.vz);
  const cap = p.gliding ? GLIDE_AIR_SPEED + 1 : 16;
  if (hs > cap) {
    p.vx *= cap / hs;
    p.vz *= cap / hs;
  }

  // Collision: X/Z with step-up, then Y.
  const a = playerAABB(p);
  const dx = p.vx * dt;
  const dz = p.vz * dt;
  const start: AABB = { ...a };
  const mxd = world.sweepAxis(a, 0, dx);
  const mzd = world.sweepAxis(a, 2, dz);
  let blockedX = Math.abs(mxd - dx) > 1e-5;
  let blockedZ = Math.abs(mzd - dz) > 1e-5;
  if ((blockedX || blockedZ) && (p.onGround || onLadder) && !p.gliding) {
    const s: AABB = { ...start };
    const up = world.sweepAxis(s, 1, STEP_HEIGHT);
    const sx = world.sweepAxis(s, 0, dx);
    const sz = world.sweepAxis(s, 2, dz);
    world.sweepAxis(s, 1, -up);
    const gainA = Math.abs(mxd) + Math.abs(mzd);
    const gainS = Math.abs(sx) + Math.abs(sz);
    if (gainS > gainA + 1e-4) {
      Object.assign(a, s);
      blockedX = Math.abs(sx - dx) > 1e-5;
      blockedZ = Math.abs(sz - dz) > 1e-5;
    }
  }
  if (blockedX) p.vx = 0;
  if (blockedZ) p.vz = 0;

  const dy = p.vy * dt;
  const myd = world.sweepAxis(a, 1, dy);
  const wasGround = p.onGround;
  if (dy < 0 && myd > dy + 1e-5) {
    const impact = -p.vy;
    p.vy = 0;
    if (!p.onGround) {
      if (p.gliding) p.gliding = false;
      else if (impact > FALL_DAMAGE_THRESHOLD) hooks.fallDamage(p, (impact - FALL_DAMAGE_THRESHOLD) * FALL_DAMAGE_PER_MS);
      if (impact > 4) hooks.fx(p, "land", impact);
    }
    p.onGround = true;
  } else if (dy > 0 && myd < dy - 1e-5) {
    p.vy = 0;
    p.onGround = false;
  } else {
    p.onGround = false;
    // Stick to stairs/slopes when walking down.
    if (wasGround && p.vy <= 0 && !onLadder) {
      const s: AABB = { ...a };
      const down = world.sweepAxis(s, 1, -STEP_HEIGHT);
      if (down > -STEP_HEIGHT + 1e-4) {
        Object.assign(a, s);
        p.onGround = true;
        p.vy = 0;
      }
    }
  }
  if (onLadder) p.onGround = false;

  p.x = (a.minX + a.maxX) / 2;
  p.y = a.minY;
  p.z = (a.minZ + a.maxZ) / 2;

  // Arena bounds.
  const B = env.bounds;
  if (p.x < B.minX + PLAYER_RADIUS) (p.x = B.minX + PLAYER_RADIUS), (p.vx = Math.max(0, p.vx));
  if (p.x > B.maxX - PLAYER_RADIUS) (p.x = B.maxX - PLAYER_RADIUS), (p.vx = Math.min(0, p.vx));
  if (p.z < B.minZ + PLAYER_RADIUS) (p.z = B.minZ + PLAYER_RADIUS), (p.vz = Math.max(0, p.vz));
  if (p.z > B.maxZ - PLAYER_RADIUS) (p.z = B.maxZ - PLAYER_RADIUS), (p.vz = Math.min(0, p.vz));
}

const hSpeed = (p: PlayerState) => Math.hypot(p.vx, p.vz);

function accelerate(p: PlayerState, wx: number, wz: number, wishSpeed: number, accel: number): void {
  if (wishSpeed <= 0) return;
  const cur = p.vx * wx + p.vz * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(add, accel);
  p.vx += wx * a;
  p.vz += wz * a;
}

function startSwap(p: PlayerState, slot: number, hooks: SimHooks): void {
  const s = p.slots[slot];
  if (!s || slot === p.active) return;
  p.active = slot;
  p.swapT = WEAPONS[s.id].swapTime * (p.overdrive > 0 ? 0.7 : 1);
  p.reloadT = 0;
  p.burstLeft = 0;
  p.chan = "";
  p.chanT = 0;
  hooks.fx(p, "swap");
}

function weapons(p: PlayerState, inp: PlayerInput, edge: number, _env: StepEnv, hooks: SimHooks, dt: number): void {
  const b = inp.b;
  if (edge & Btn.SLOT1) startSwap(p, 0, hooks);
  else if (edge & Btn.SLOT2) startSwap(p, 1, hooks);
  else if (edge & Btn.SLOT3) startSwap(p, 2, hooks);

  // Fall back to any available weapon if the active slot was emptied (pickup swap, etc).
  if (!p.slots[p.active]) {
    const i = p.slots.findIndex((s) => s);
    if (i < 0) return;
    p.active = i;
  }
  const slot = p.slots[p.active]!;
  const def = WEAPONS[slot.id];
  const speedK = p.overdrive > 0 ? 0.7 : 1;

  p.swapT = Math.max(0, p.swapT - dt);
  // Keep a small negative carry so fire rates stay exact on a 60 Hz step.
  p.fireCd = Math.max(-dt, p.fireCd - dt);
  p.sprayT += dt;
  if (p.sprayT > 0.4) p.sprayN = 0;
  p.spread = Math.max(0, p.spread - def.spreadRecovery * dt);

  const adsTarget = (b & Btn.ADS) && !p.sprinting && p.swapT <= 0 && !p.chan ? 1 : 0;
  const adsRate = dt / (def.adsTime * speedK);
  p.ads = adsTarget ? Math.min(1, p.ads + adsRate) : Math.max(0, p.ads - adsRate * 1.4);

  // Reload progress.
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      if (def.reloadPerRound) {
        if (slot.reserve > 0 && slot.mag < def.mag) {
          slot.mag++;
          slot.reserve--;
        }
        p.reloadT = slot.mag < def.mag && slot.reserve > 0 ? def.reloadPerRound * speedK : 0;
        hooks.fx(p, "reload", 1);
      } else {
        const n = Math.min(def.mag - slot.mag, slot.reserve);
        slot.mag += n;
        slot.reserve -= n;
        p.reloadT = 0;
      }
    }
  }

  const firePressed = (edge & Btn.FIRE) !== 0;
  const fireHeld = (b & Btn.FIRE) !== 0;
  const canStartReload = p.reloadT <= 0 && slot.mag < def.mag && slot.reserve > 0 && p.swapT <= 0 && p.burstLeft === 0;
  if (canStartReload && ((edge & Btn.RELOAD) || (slot.mag === 0 && p.fireCd <= 1e-6))) {
    p.reloadT = (def.reloadPerRound ? def.reloadPerRound + 0.2 : def.reloadTime) * speedK;
    p.chan = "";
    hooks.fx(p, "reload", 0);
  }

  // Burst continuation.
  if (p.burstLeft > 0) {
    p.burstT -= dt;
    if (p.burstT <= 1e-6) {
      if (slot.mag > 0) fireOne(p, slot, def, hooks);
      p.burstLeft--;
      p.burstT += def.burstInterval ?? 0.07;
    }
    return;
  }

  const wants = def.fireMode === "auto" ? fireHeld : firePressed;
  if (!wants) return;
  if (p.swapT > 0 || p.fireCd > 1e-6 || p.chan) return;
  if (p.reloadT > 0 && !def.reloadPerRound) return;
  if (slot.mag <= 0) {
    if (firePressed) hooks.fx(p, "dry");
    return;
  }
  if (p.reloadT > 0) p.reloadT = 0; // shotgun: firing interrupts shell loading
  fireOne(p, slot, def, hooks);
  if (def.fireMode === "burst") {
    p.burstLeft = (def.burstCount ?? 3) - 1;
    p.burstT = def.burstInterval ?? 0.07;
    p.fireCd = Math.min(0, p.fireCd) + def.fireInterval + p.burstLeft * p.burstT;
  } else {
    p.fireCd = Math.min(0, p.fireCd) + def.fireInterval;
  }
}

function fireOne(p: PlayerState, slot: WeaponSlot, def: WeaponDef, hooks: SimHooks): void {
  slot.mag--;
  p.shotN = (p.shotN + 1) | 0;
  p.sprayN++;
  p.sprayT = 0;
  p.spawnProt = 0;
  p.sprinting = false;
  const moving = Math.min(1.5, Math.hypot(p.vx, p.vz) / WALK_SPEED);
  const base = def.spreadHip + (def.spreadAds - def.spreadHip) * p.ads + p.spread + moving * def.spreadMove * (1 - 0.5 * p.ads) + (p.onGround ? 0 : def.spreadAir);
  const DEG = Math.PI / 180;
  const origin = eyePos(p);
  scratchDirs.length = 0;
  for (let i = 0; i < def.pellets; i++) {
    const cone = def.pelletCone ? def.pelletCone * (1 - 0.25 * p.ads) + base * 0.3 : base;
    const ang = hash01(p.seed, p.shotN, i * 2) * Math.PI * 2;
    const r = Math.sqrt(hash01(p.seed, p.shotN, i * 2 + 1)) * cone * 0.5 * DEG;
    scratchDirs.push(offsetDir(p.yaw, p.pitch, Math.cos(ang) * r, Math.sin(ang) * r));
  }
  p.spread = Math.min(def.spreadMax, p.spread + def.spreadPerShot);
  if (def.projectile) hooks.fireProjectile(p, def, origin, scratchDirs[0]!);
  else hooks.fireHitscan(p, def, origin, scratchDirs);
  hooks.fx(p, "shot", p.sprayN);
}

function equipment(p: PlayerState, inp: PlayerInput, edge: number, env: StepEnv, hooks: SimHooks, dt: number): void {
  const b = inp.b;
  if (edge & Btn.CYCLE_NADE) {
    const i = GRENADE_IDS.indexOf(p.nadeSel);
    for (let k = 1; k <= GRENADE_IDS.length; k++) {
      const g = GRENADE_IDS[(i + k) % GRENADE_IDS.length]!;
      if (p.nades[g] > 0 || k === GRENADE_IDS.length) {
        p.nadeSel = g;
        break;
      }
    }
  }
  if (p.nades[p.nadeSel] <= 0) {
    const g = GRENADE_IDS.find((id) => p.nades[id] > 0);
    if (g) p.nadeSel = g;
  }
  if ((edge & Btn.GRENADE) && p.nadeCd <= 0 && p.nades[p.nadeSel] > 0 && p.swapT <= 0 && !p.chan) {
    p.nades[p.nadeSel]--;
    p.nadeCd = 0.9;
    p.spawnProt = 0;
    const dir = viewDir(p.yaw, Math.min(1.4, p.pitch + 0.12));
    const o = eyePos(p);
    hooks.throwGrenade(p, p.nadeSel, { x: o.x + dir.x * 0.5, y: o.y - 0.1, z: o.z + dir.z * 0.5 }, dir);
    hooks.fx(p, "throw");
  }
  if ((edge & Btn.TACTICAL) && p.emp <= 0) {
    if (hooks.useTactical(p)) p.spawnProt = 0;
  }
  // Consumables: healing injector & armor plate (channelled, cancellable).
  if (!p.chan) {
    if ((edge & Btn.HEAL) && p.injectors > 0 && p.health < MAX_HEALTH) {
      p.chan = "heal";
      p.chanT = INJECTOR.channel;
      p.reloadT = 0;
      hooks.fx(p, "heal");
    } else if ((edge & Btn.PLATE) && p.plates > 0 && p.armor < env.maxArmor) {
      p.chan = "plate";
      p.chanT = PLATE.channel;
      p.reloadT = 0;
      hooks.fx(p, "plate");
    }
  } else {
    if ((edge & Btn.FIRE) || p.sprinting) {
      p.chan = "";
      p.chanT = 0;
    } else {
      p.chanT -= dt;
      if (p.chanT <= 0) {
        if (p.chan === "heal" && p.injectors > 0) {
          p.injectors--;
          p.health = Math.min(MAX_HEALTH, p.health + INJECTOR.heal);
        } else if (p.chan === "plate" && p.plates > 0) {
          p.plates--;
          p.armor = Math.min(env.maxArmor, p.armor + PLATE.armor);
        }
        p.chan = "";
        p.chanT = 0;
        hooks.fx(p, "chanDone");
      }
    }
  }
}

export const tacticalCooldown = (id: TacticalId) => TACTICALS[id].cooldown;

/** Deep clone for prediction replay. */
export function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    slots: p.slots.map((s) => (s ? { ...s } : null)),
    nades: { ...p.nades },
  };
}
