import {
  ASSIST_WINDOW, DOWNED_BLEEDOUT, DOWNED_HEALTH, GRAVITY, HEAD_RADIUS, INTEREST_RADIUS, KILL_PLANE_Y, MAX_ARMOR,
  MAX_HEALTH, MAX_INPUT_BANK, MAX_INPUT_QUEUE, MAX_REWIND, PICKUP_INTEREST_RADIUS, REGEN_DELAY, REGEN_RATE, REVIVE_TIME,
  SIM_DT, SPAWN_PROTECTION, TICK_DT,
} from "../constants";
import type { Vec3 } from "../math";
import { clamp, dist3, distXZ, rayAABB, raySphere, viewDir } from "../math";
import { Rng } from "../rng";
import { CollisionWorld } from "../map/collision";
import type { District, MapData } from "../map/types";
import { WEAPONS, damageAtRange, POWER_IDS, PRIMARY_IDS } from "../balance/weapons";
import type { WeaponDef } from "../balance/weapons";
import { BARREL, GRENADES, GRENADE_IDS, INJECTOR, MINE, PLATE, RECON, REMOTE, SHIELD, TACTICALS } from "../balance/equipment";
import {
  ARENA_KIT, BR_KIT, activeWeapon, bodyHeight, createPlayerState, eyeHeight, makeSlot, playerAABB, resetForSpawn, stepPlayer,
} from "./player";
import type { PlayerState, SimHooks, StepEnv } from "./player";
import type { GrenadeId, Loadout, MatchConfig, PlayerInput, WeaponId } from "../types";
import { DEFAULT_LOADOUT } from "../types";
import type {
  CPSnap, DeploySnap, GameEvent, MatchResults, PayloadSnap, PickupSnap, PlayerSnap, ProjSnap, ResultRow, RosterEntry, ScoreRow, SmokeSnap,
  Snapshot,
} from "../protocol";
import { PF } from "../protocol";
import { BotBrain, botName } from "../ai/bot";
import { NavGrid } from "../ai/nav";
import {
  PAYLOAD_CHECKPOINT_BONUS, PAYLOAD_RADIUS, PAYLOAD_ROLLBACK, PAYLOAD_ROLLBACK_DELAY, PAYLOAD_SPEED, buildPayloadTrack, trackPoint,
} from "./payload";
import type { PayloadTrack } from "./payload";
import { ASSIST_SCORE, GUN_LADDER, HEADSHOT_BONUS, KILL_SCORE, MEDAL_SCORES, isSoloMode } from "./config";

export interface PlayerStats {
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  score: number;
  shots: number;
  hits: number;
  headshots: number;
  streak: number;
  bestStreak: number;
  captures: number;
  revives: number;
  medals: Record<string, number>;
  weaponKills: Record<string, number>;
}

export interface MatchPlayer {
  id: number;
  name: string;
  isBot: boolean;
  squad: number;
  team: number;
  st: PlayerState;
  loadout: Loadout;
  inputs: PlayerInput[];
  credits: number;
  lastSeq: number;
  history: { t: number; x: number; y: number; z: number; cr: boolean; dn: boolean }[];
  stats: PlayerStats;
  respawnAt: number;
  connected: boolean;
  damageLog: Map<number, { dmg: number; t: number }>;
  lastHurt: number;
  revealed: Map<number, number>;
  downedT: number;
  reviveTarget: number;
  reviveT: number;
  lastKillT: number;
  multi: number;
  lastKilledBy: number;
  eliminated: boolean;
  placement: number;
  bot: BotBrain | null;
  lastVt: number;
  /** Gun Game ladder position. */
  gunTier: number;
  /** Kills by each opponent on this player (for Nemesis). */
  killedBy: Map<number, number>;
}

interface Projectile {
  id: number;
  kind: GrenadeId | "nova";
  owner: number;
  team: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  age: number;
}

interface Deployable {
  id: number;
  kind: "shield" | "mine" | "remote";
  owner: number;
  team: number;
  x: number;
  y: number;
  z: number;
  ax: number;
  hp: number;
  t: number;
  until: number;
  trigger: number;
}

interface Smoke {
  id: number;
  x: number;
  y: number;
  z: number;
  r: number;
  until: number;
}

interface Pickup {
  id: number;
  kind: "weapon" | "ammo" | "health" | "armor" | "grenade" | "power" | "injector" | "plate";
  weapon?: WeaponId;
  mag?: number;
  reserve?: number;
  x: number;
  y: number;
  z: number;
  active: boolean;
  respawnAt: number;
  respawn: number;
  /** Dropped items expire instead of respawning. */
  expireAt: number;
}

/** Breakable loot crate: shoot or blast it open for a random pickup. */
interface Crate {
  id: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
}

const CRATE = { hp: 30, respawn: 25, half: 0.45 };

interface Barrel {
  id: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  fuse: number;
  lastHitBy: number;
}

interface ControlPoint {
  x: number;
  y: number;
  z: number;
  owner: number;
  prog: number;
  contested: boolean;
}

interface Zone {
  x: number;
  z: number;
  r: number;
  fromX: number;
  fromZ: number;
  fromR: number;
  tx: number;
  tz: number;
  tr: number;
  phase: number;
  shrinking: boolean;
  nextAt: number;
  dps: number;
}

const ZONE_PHASES = [
  { wait: 50, shrink: 35, r: 140, dps: 2 },
  { wait: 40, shrink: 30, r: 85, dps: 4 },
  { wait: 35, shrink: 25, r: 48, dps: 7 },
  { wait: 30, shrink: 22, r: 22, dps: 10 },
  { wait: 25, shrink: 20, r: 0, dps: 16 },
];

type TargetSnap = { m: MatchPlayer; x: number; y: number; z: number; cr: boolean; dn: boolean };
type Ev = GameEvent;

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Authoritative match simulation. Runs on the game server for online play
 * and inside the browser for offline Practice — the exact same rules code.
 */
export class Match {
  readonly cfg: MatchConfig;
  readonly map: MapData;
  readonly world: CollisionWorld;
  readonly district: District | null;
  readonly bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  readonly env: StepEnv;
  readonly rng: Rng;
  nav: NavGrid | null = null;
  time = 0;
  tick = 0;
  phase: "starting" | "live" | "ended" = "starting";
  private phaseEnd = 5;
  private liveStart = 5;
  players = new Map<number, MatchPlayer>();
  teamScores: number[];
  private projectiles: Projectile[] = [];
  private deployables: Deployable[] = [];
  private smokes: Smoke[] = [];
  private pickups: Pickup[] = [];
  private barrels: Barrel[] = [];
  private crates: Crate[] = [];
  private points: ControlPoint[] = [];
  private overclocked = 0;
  private overclockAt = 0;
  private domTickAt = 0;
  zone: Zone | null = null;
  /** Payload track (payload mode only). Team 0 attacks, team 1 defends. */
  track: PayloadTrack | null = null;
  /** Cart state: distance along the track, checkpoints reached, escort counts. */
  private cart = { d: 0, reached: 0, state: 0, idleT: 0, att: 0, def: 0, overtime: false };
  /** Seconds added to the time limit (payload checkpoints). */
  private timeBonus = 0;
  private cache: { x: number; y: number; z: number; until: number } | null = null;
  private nextCacheAt = 0;
  private stormUntil = 0;
  private nextStormAt = 0;
  private stormWarned = false;
  private events: Ev[] = [];
  recentShots: { x: number; y: number; z: number; p: number; t: number }[] = [];
  results: MatchResults | null = null;
  rosterVersion = 0;
  private nextId = 1;
  private firstBlood = false;
  private cur: MatchPlayer | null = null;
  private curInput: PlayerInput | null = null;
  private teamsEliminated = 0;
  private botCounter = 0;
  readonly hooks: SimHooks;
  onEnd: ((r: MatchResults) => void) | null = null;

  constructor(cfg: MatchConfig, map: MapData) {
    this.cfg = cfg;
    this.map = map;
    this.world = new CollisionWorld(map);
    this.rng = new Rng(cfg.seed);
    this.district = cfg.arena === "frontier" ? null : map.districts.find((d) => d.id === cfg.arena) ?? map.districts[0]!;
    this.bounds = this.district
      ? { minX: this.district.minX, minZ: this.district.minZ, maxX: this.district.maxX, maxZ: this.district.maxZ }
      : { minX: map.minX, minZ: map.minZ, maxX: map.maxX, maxZ: map.maxZ };
    const has = (m: string) => cfg.modifiers.includes(m as never);
    this.env = {
      world: this.world,
      bounds: this.bounds,
      gravity: has("lowgrav") ? 0.55 : 1,
      tacticalRate: has("overcharge") ? 2 : 1,
      maxArmor: has("glass") ? 0 : MAX_ARMOR,
    };
    this.teamScores = new Array(isSoloMode(cfg.mode) ? 0 : cfg.teamCount).fill(0);
    this.hooks = this.makeHooks();
    this.setupWorld();
  }

  private has(mod: string): boolean {
    return this.cfg.modifiers.includes(mod as never);
  }

  get isBR() {
    return this.cfg.mode === "br";
  }
  get isFFA() {
    return isSoloMode(this.cfg.mode);
  }
  get isGunGame() {
    return this.cfg.mode === "gungame";
  }
  get respawns() {
    return this.cfg.mode !== "br";
  }
  get isPayload() {
    return this.cfg.mode === "payload";
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private setupWorld(): void {
    const inArena = (p: Vec3) => p.x > this.bounds.minX && p.x < this.bounds.maxX && p.z > this.bounds.minZ && p.z < this.bounds.maxZ;
    for (const c of this.map.crates ?? []) {
      if (!inArena(c)) continue;
      this.crates.push({ id: this.nextId++, x: c.x, y: c.y, z: c.z, hp: CRATE.hp, alive: true, respawnAt: 0 });
    }
    for (const b of this.map.barrels) {
      if (!inArena(b)) continue;
      this.barrels.push({ id: this.nextId++, x: b.x, y: b.y, z: b.z, hp: BARREL.hp, alive: true, respawnAt: 0, fuse: -1, lastHitBy: -1 });
    }
    if (this.isBR) {
      // Loot scattered across the whole region.
      for (const p of this.map.loot) {
        const r = this.rng.next();
        if (r < 0.32) this.addPickup("weapon", p, this.rng.pick(PRIMARY_IDS), 0);
        else if (r < 0.5) this.addPickup("ammo", p, undefined, 0);
        else if (r < 0.64) this.addPickup("plate", p, undefined, 0);
        else if (r < 0.78) this.addPickup("injector", p, undefined, 0);
        else if (r < 0.88) this.addPickup("armor", p, undefined, 0);
        else if (r < 0.96) this.addPickup("grenade", p, undefined, 0);
        else this.addPickup("power", p, this.rng.pick(POWER_IDS), 0);
      }
      const R = 280;
      this.zone = { x: 0, z: 0, r: R, fromX: 0, fromZ: 0, fromR: R, tx: 0, tz: 0, tr: R, phase: -1, shrinking: false, nextAt: 0, dps: 1 };
    } else if (this.district) {
      const respawnFor: Record<string, number> = { weapon: 22, ammo: 15, health: 20, armor: 25, grenade: 20, power: 75 };
      for (const s of this.district.pickups) {
        // Gun Game hands out weapons by ladder tier only.
        if (this.isGunGame && (s.kind === "weapon" || s.kind === "power")) continue;
        this.addPickup(s.kind, s.pos, s.weapon, respawnFor[s.kind] ?? 20, s.kind === "power");
      }
      if (this.cfg.mode === "dom") {
        for (const p of this.district.points) this.points.push({ x: p.x, y: p.y, z: p.z, owner: -1, prog: 0, contested: false });
      }
      if (this.isPayload) this.track = buildPayloadTrack(this.ensureNav(), this.world, this.district);
    }
    if (this.has("neonstorm")) this.nextStormAt = this.liveStart + 45;
    this.nextCacheAt = this.liveStart + (this.has("powersurge") ? 25 : 45);
    this.overclockAt = this.liveStart + 60;
  }

  private addPickup(kind: Pickup["kind"], p: Vec3, weapon: WeaponId | undefined, respawn: number, delayed = false): Pickup {
    const pk: Pickup = {
      id: this.nextId++, kind, weapon, x: p.x, y: p.y, z: p.z, active: !delayed, respawnAt: delayed ? this.liveStart + 30 : 0,
      respawn, expireAt: 0,
    };
    this.pickups.push(pk);
    return pk;
  }

  ensureNav(): NavGrid {
    if (!this.nav) this.nav = new NavGrid(this.world, this.map, this.bounds);
    return this.nav;
  }

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------

  addPlayer(o: { id: number; name: string; isBot?: boolean; squad: number; team: number; loadout?: Loadout; difficulty?: MatchConfig["botDifficulty"] }): MatchPlayer {
    const loadout = o.loadout ?? DEFAULT_LOADOUT;
    const isBot = !!o.isBot;
    const mp: MatchPlayer = {
      id: o.id, name: o.name, isBot, squad: o.squad, team: o.team,
      st: createPlayerState(o.id, o.team, loadout), loadout,
      inputs: [], credits: 0, lastSeq: -1, history: [],
      stats: { kills: 0, deaths: 0, assists: 0, damage: 0, score: 0, shots: 0, hits: 0, headshots: 0, streak: 0, bestStreak: 0, captures: 0, revives: 0, medals: {}, weaponKills: {} },
      respawnAt: this.time, connected: true, damageLog: new Map(), lastHurt: -99, revealed: new Map(),
      downedT: 0, reviveTarget: -1, reviveT: 0, lastKillT: -99, multi: 0, lastKilledBy: -1, eliminated: false, placement: 0,
      bot: isBot ? new BotBrain(this.cfg.seed + o.id * 31, o.difficulty ?? this.cfg.botDifficulty, this.cfg.mode === "training") : null,
      lastVt: 0, gunTier: 0, killedBy: new Map(),
    };
    this.players.set(o.id, mp);
    if (isBot) this.ensureNav();
    this.rosterVersion++;
    if (this.isBR) {
      if (this.phase === "starting") this.spawnBR(mp);
    } else this.spawn(mp);
    return mp;
  }

  /** Adds a clearly-labelled AI player. */
  addBot(team: number, squad: number): MatchPlayer {
    const id = 10000 + this.botCounter;
    const loadouts: Loadout[] = [
      { primary: "pulse9", secondary: "phantom", tactical: "recon" },
      { primary: "viper", secondary: "phantom", tactical: "mine" },
      { primary: "helix47", secondary: "phantom", tactical: "shield" },
      { primary: "breachmaker", secondary: "phantom", tactical: "recon" },
      { primary: "railspike", secondary: "phantom", tactical: "mine" },
      { primary: "titan", secondary: "phantom", tactical: "shield" },
      { primary: "longshot", secondary: "phantom", tactical: "recon" },
    ];
    const lo = this.cfg.mode === "training" ? loadouts[0]! : loadouts[this.botCounter % loadouts.length]!;
    const mp = this.addPlayer({ id, name: botName(this.botCounter), isBot: true, squad, team, loadout: lo });
    this.botCounter++;
    return mp;
  }

  removePlayer(id: number): void {
    const mp = this.players.get(id);
    if (!mp) return;
    if (this.isBR && mp.st.alive && this.phase === "live") {
      this.dropLoot(mp);
      mp.st.alive = false;
      mp.eliminated = true;
      this.checkTeamElimination(mp.team);
    }
    this.players.delete(id);
    this.rosterVersion++;
    this.checkEnd();
  }

  setConnected(id: number, c: boolean): void {
    const mp = this.players.get(id);
    if (mp) {
      mp.connected = c;
      if (!c) mp.inputs.length = 0;
    }
  }

  setLoadout(id: number, l: Loadout): void {
    const mp = this.players.get(id);
    if (mp) mp.loadout = l;
  }

  pushInputs(id: number, inputs: PlayerInput[]): void {
    const mp = this.players.get(id);
    if (!mp || mp.isBot) return;
    for (const i of inputs) if (i.seq > mp.lastSeq) mp.inputs.push(i);
    if (mp.inputs.length > MAX_INPUT_QUEUE) mp.inputs.splice(0, mp.inputs.length - MAX_INPUT_QUEUE);
  }

  roster(): RosterEntry[] {
    return [...this.players.values()].map((p) => ({ i: p.id, n: p.name, t: p.team, bot: p.isBot, sq: p.squad }));
  }

  private teamOf(id: number): number {
    return this.players.get(id)?.team ?? -1;
  }

  isRevealedTo(p: MatchPlayer, team: number): boolean {
    const u = p.revealed.get(team);
    return u !== undefined && u > this.time;
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  private spawn(mp: MatchPlayer): void {
    const pos = this.pickSpawn(mp);
    const kit = { ...ARENA_KIT, armor: Math.min(ARENA_KIT.armor, this.env.maxArmor) };
    if (this.has("overcharge")) kit.grenades = true;
    if (this.isGunGame) kit.grenades = false;
    resetForSpawn(mp.st, mp.loadout, kit, pos, this.faceCenterYaw(pos));
    if (this.isGunGame) this.giveGunTier(mp, false);
    mp.st.spawnProt = SPAWN_PROTECTION;
    mp.st.team = mp.team;
    mp.respawnAt = -1;
    mp.damageLog.clear();
    mp.history.length = 0;
    mp.bot?.reset(mp.st.yaw);
    this.emit({ k: "spawn", p: mp.id });
  }

  /** Gun Game: equips the weapon for the player's current ladder tier. */
  private giveGunTier(mp: MatchPlayer, swap = true): void {
    const id = GUN_LADDER[Math.min(mp.gunTier, GUN_LADDER.length - 1)]!;
    const st = mp.st;
    const slot = makeSlot(id);
    slot.reserve = Math.max(slot.reserve, WEAPONS[id].mag * 4);
    st.slots = [slot, null, null];
    st.active = 0;
    st.reloadT = st.burstLeft = 0;
    if (swap) st.swapT = Math.min(0.35, WEAPONS[id].swapTime);
  }

  private faceCenterYaw(p: Vec3): number {
    const c = this.district ? { x: (this.bounds.minX + this.bounds.maxX) / 2, z: (this.bounds.minZ + this.bounds.maxZ) / 2 } : { x: 0, z: 0 };
    const toCenter = Math.atan2(-(c.x - p.x), -(c.z - p.z));
    // In the dense street grid the centre is often behind a building: face the
    // most open street direction, preferring the one closest to the centre.
    const eye = { x: p.x, y: p.y + 1.6, z: p.z };
    let best = toCenter;
    let bestScore = -Infinity;
    for (const yaw of [toCenter, 0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
      const open = Math.min(this.world.raycast(eye, dir, 30)?.t ?? 30, 30);
      const off = Math.abs(Math.atan2(Math.sin(yaw - toCenter), Math.cos(yaw - toCenter)));
      const score = open - off * 4;
      if (score > bestScore) {
        bestScore = score;
        best = yaw;
      }
    }
    return best;
  }

  /** Fair spawn selection: far from living enemies, out of their sight, near teammates. */
  private pickSpawn(mp: MatchPlayer): Vec3 {
    const spawns = this.district?.spawns ?? this.map.districts[0]!.spawns;
    const enemies = [...this.players.values()].filter((p) => p !== mp && p.st.alive && (this.isFFA || p.team !== mp.team));
    const mates = [...this.players.values()].filter((p) => p !== mp && p.st.alive && !this.isFFA && p.team === mp.team);
    const scored = spawns.map((s) => {
      let minE = 60;
      let seen = 0;
      for (const e of enemies) {
        const d = distXZ(s, e.st);
        minE = Math.min(minE, d);
        if (d < 50 && this.world.lineOfSight({ x: e.st.x, y: e.st.y + 1.6, z: e.st.z }, { x: s.x, y: s.y + 1.5, z: s.z })) seen++;
      }
      let mateBonus = 0;
      for (const m of mates) mateBonus = Math.max(mateBonus, 12 - Math.min(12, Math.abs(distXZ(s, m.st) - 12)));
      // Payload: attackers spawn behind the cart, defenders ahead of it.
      let side = 0;
      if (this.track) {
        side = distXZ(s, trackPoint(this.track, this.cart.d + (mp.team === 0 ? -25 : 35))) * 0.9;
        if (distXZ(s, trackPoint(this.track, this.cart.d)) < 4) side += 40; // never inside the cart
      }
      return { s, score: minE - seen * 25 + mateBonus * 0.6 - side + this.rng.next() * 6 };
    });
    scored.sort((a, b) => b.score - a.score);
    const s = scored[0]?.s ?? { x: 0, y: 0, z: 0 };
    return { x: s.x, y: s.y + 0.05, z: s.z };
  }

  /** Battle royale insertion: squads glide in from above a random land area. */
  private spawnBR(mp: MatchPlayer): void {
    const anchorKey = `sq${mp.squad}`;
    let anchor = this.brAnchors.get(anchorKey);
    if (!anchor) {
      const d = this.map.districts[this.rng.int(0, this.map.districts.length - 1)]!;
      anchor = { x: (d.minX + d.maxX) / 2 + this.rng.range(-40, 40), z: (d.minZ + d.maxZ) / 2 + this.rng.range(-40, 40) };
      this.brAnchors.set(anchorKey, anchor);
    }
    const n = [...this.players.values()].filter((p) => p.squad === mp.squad).length;
    const pos = { x: anchor.x + (n % 2) * 3, y: 70, z: anchor.z + Math.floor(n / 2) * 3 };
    resetForSpawn(mp.st, mp.loadout, { ...BR_KIT }, pos, this.rng.range(-Math.PI, Math.PI));
    mp.st.gliding = true;
    mp.st.team = mp.team;
    mp.respawnAt = -1;
    mp.bot?.reset(mp.st.yaw);
  }
  private brAnchors = new Map<string, { x: number; z: number }>();

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  /** Advances the match by one server tick (TICK_DT). */
  step(): void {
    if (this.phase === "ended") {
      this.time += TICK_DT;
      this.tick++;
      return;
    }
    if (this.phase === "starting" && this.time >= this.phaseEnd) {
      this.phase = "live";
      this.liveStart = this.time;
      this.emit({ k: "ann", t: "FIGHT", c: "start" });
      if (this.isBR) this.advanceZone();
    }

    // Players: consume queued inputs (bounded by credits → anti speed-hack).
    const steps = Math.round(TICK_DT / SIM_DT);
    for (const mp of this.players.values()) {
      if (mp.isBot) {
        for (let k = 0; k < steps; k++) {
          const inp = mp.bot!.think(this, mp, SIM_DT);
          this.stepOne(mp, inp);
        }
        continue;
      }
      mp.credits = Math.min(MAX_INPUT_BANK, mp.credits + steps);
      while (mp.inputs.length > 0 && mp.credits >= 1) {
        const inp = mp.inputs.shift()!;
        if (inp.seq <= mp.lastSeq) continue;
        mp.credits -= 1;
        mp.lastSeq = inp.seq;
        this.stepOne(mp, inp);
      }
    }
    this.cur = null;
    this.curInput = null;

    this.updateProjectiles(TICK_DT);
    this.updateDeployables(TICK_DT);
    this.updateWorldEntities(TICK_DT);
    this.updatePlayersTick(TICK_DT);
    this.updateMode(TICK_DT);

    this.time += TICK_DT;
    this.tick++;
    for (const mp of this.players.values()) {
      const s = mp.st;
      mp.history.push({ t: this.time, x: s.x, y: s.y, z: s.z, cr: s.crouched, dn: s.downed });
      if (mp.history.length > 20) mp.history.shift();
    }
    if (this.recentShots.length > 40) this.recentShots.splice(0, this.recentShots.length - 40);
    this.checkEnd();
  }

  private stepOne(mp: MatchPlayer, inp: PlayerInput): void {
    this.cur = mp;
    this.curInput = inp;
    mp.lastVt = inp.vt;
    if (this.phase === "starting" && !this.isBR) {
      // Pre-match freeze: look around only.
      mp.st.yaw = inp.yaw;
      mp.st.pitch = clamp(inp.pitch, -1.55, 1.55);
      mp.st.prevB = inp.b;
      return;
    }
    const st = mp.st;
    if (!st.alive) {
      st.prevB = inp.b;
      return;
    }
    stepPlayer(st, inp, this.env, this.hooks, SIM_DT);
    // Hazards: void and electrified water.
    if (st.alive) {
      if (st.y < KILL_PLANE_Y) this.environmentalKill(mp, "void");
      else if (this.inWater(st.x, st.z) && st.y < -0.6) this.environmentalKill(mp, "water");
    }
  }

  private inWater(x: number, z: number): boolean {
    return this.map.water.some((w) => x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ);
  }

  private environmentalKill(mp: MatchPlayer, cause: string): void {
    mp.st.downed = false;
    mp.st.health = 0;
    const killer = this.recentAttacker(mp);
    this.kill(mp, killer, cause, false);
  }

  private recentAttacker(mp: MatchPlayer): MatchPlayer | null {
    let best: MatchPlayer | null = null;
    let bt = -1;
    for (const [id, e] of mp.damageLog) {
      if (this.time - e.t < 6 && e.t > bt && id !== mp.id) {
        bt = e.t;
        best = this.players.get(id) ?? null;
      }
    }
    return best;
  }

  private updatePlayersTick(dt: number): void {
    const regen = this.respawns && this.cfg.mode !== "training" ? true : this.cfg.mode === "training";
    for (const mp of this.players.values()) {
      const st = mp.st;
      // Respawn timers.
      if (!st.alive) {
        if (this.respawns && mp.respawnAt >= 0 && this.time >= mp.respawnAt && this.phase === "live" && (mp.connected || mp.isBot)) this.spawn(mp);
        continue;
      }
      // Regeneration in arena modes.
      if (regen && !st.downed && this.time - mp.lastHurt > REGEN_DELAY && st.health < MAX_HEALTH) st.health = Math.min(MAX_HEALTH, st.health + REGEN_RATE * dt);
      // Downed bleed-out.
      if (st.downed) {
        mp.downedT -= dt;
        if (mp.downedT <= 0) this.kill(mp, this.recentAttacker(mp), "bleedout", false);
      }
      // Storm (BR zone) damage.
      if (this.zone && this.phase === "live" && Math.hypot(st.x - this.zone.x, st.z - this.zone.z) > this.zone.r) {
        this.applyDamage(mp, this.zone.dps * dt, null, "storm", { src: { x: this.zone.x, y: st.y, z: this.zone.z }, ignoreArmor: true });
      }
      // Neon storm event.
      if (this.stormUntil > this.time) st.emp = Math.max(st.emp, this.stormUntil - this.time);
      // Auto pickups (walk-over).
      this.autoPickups(mp);
      // Data cache.
      if (this.cache && distXZ(st, this.cache) < 1.8 && Math.abs(st.y - this.cache.y) < 2 && !st.downed) this.claimCache(mp);
    }
  }

  // -------------------------------------------------------------------------
  // Hooks (authority)
  // -------------------------------------------------------------------------

  private makeHooks(): SimHooks {
    return {
      fireHitscan: (p, def, origin, dirs) => this.fireHitscan(p, def, origin, dirs),
      fireProjectile: (p, def, origin, dir) => {
        if (!def.projectile) return;
        const mp = this.players.get(p.id)!;
        mp.stats.shots++;
        this.projectiles.push({
          id: this.nextId++, kind: "nova", owner: p.id, team: mp.team,
          x: origin.x + dir.x * 0.6, y: origin.y + dir.y * 0.6, z: origin.z + dir.z * 0.6,
          vx: dir.x * def.projectile.speed, vy: dir.y * def.projectile.speed, vz: dir.z * def.projectile.speed, fuse: 4, age: 0,
        });
        this.recentShots.push({ x: p.x, y: p.y, z: p.z, p: p.id, t: this.time });
        this.emit({ k: "shot", p: p.id, w: def.id, o: [r2(origin.x), r2(origin.y), r2(origin.z)], e: [] });
      },
      throwGrenade: (p, type, origin, dir) => {
        const g = GRENADES[type];
        const mp = this.players.get(p.id)!;
        this.projectiles.push({
          id: this.nextId++, kind: type, owner: p.id, team: mp.team, x: origin.x, y: origin.y, z: origin.z,
          vx: dir.x * g.throwSpeed + p.vx * 0.5, vy: dir.y * g.throwSpeed + 2, vz: dir.z * g.throwSpeed + p.vz * 0.5, fuse: g.fuse, age: 0,
        });
        this.emit({ k: "throw", p: p.id });
      },
      useTactical: (p) => this.useTactical(p),
      interact: (p, held, pressed) => this.interact(p, held, pressed),
      fallDamage: (p, amount) => {
        const mp = this.players.get(p.id);
        if (mp) this.applyDamage(mp, amount, null, "fall", { src: { x: p.x, y: p.y - 1, z: p.z }, ignoreArmor: true });
      },
      fx: () => {},
    };
  }

  /** Rewinds other players to the shooter's view time (lag compensation). */
  private rewound(shooter: MatchPlayer): TargetSnap[] {
    const out: TargetSnap[] = [];
    const vt = shooter.isBot ? this.time : clamp(this.curInput?.vt ?? this.time, this.time - MAX_REWIND, this.time);
    for (const m of this.players.values()) {
      if (m === shooter || !m.st.alive) continue;
      const h = m.history;
      let snap: TargetSnap = { m, x: m.st.x, y: m.st.y, z: m.st.z, cr: m.st.crouched, dn: m.st.downed };
      if (h.length > 0 && vt < this.time - 1e-4) {
        let a = h[0]!;
        let b = h[h.length - 1]!;
        for (let i = h.length - 1; i > 0; i--) {
          if (h[i - 1]!.t <= vt) {
            a = h[i - 1]!;
            b = h[i]!;
            break;
          }
        }
        if (vt <= a.t) snap = { m, x: a.x, y: a.y, z: a.z, cr: a.cr, dn: a.dn };
        else {
          const k = clamp((vt - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);
          snap = { m, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, cr: k < 0.5 ? a.cr : b.cr, dn: b.dn };
        }
      }
      out.push(snap);
    }
    return out;
  }

  private fireHitscan(p: PlayerState, def: WeaponDef, origin: Vec3, dirs: Vec3[]): void {
    const shooter = this.players.get(p.id);
    if (!shooter) return;
    shooter.stats.shots++;
    const targets = this.rewound(shooter);
    const perVictim = new Map<number, { dmg: number; head: boolean; dist: number }>();
    const ends: number[][] = [];
    let firstHitPoint: Vec3 | null = null;
    let firstVictim: MatchPlayer | null = null;
    for (const dir of dirs) {
      const res = this.trace(shooter, def, origin, dir, targets);
      ends.push([r2(res.end.x), r2(res.end.y), r2(res.end.z), res.type]);
      for (const h of res.hits) {
        const mult = h.head ? def.headMult * (this.has("headhunter") ? 1.4 : 1) : this.has("headhunter") ? 0.9 : 1;
        const d = damageAtRange(def, h.dist) * mult;
        const e = perVictim.get(h.victim.id) ?? { dmg: 0, head: false, dist: h.dist };
        e.dmg += d;
        e.head = e.head || h.head;
        perVictim.set(h.victim.id, e);
        if (!firstHitPoint) {
          firstHitPoint = h.point;
          firstVictim = h.victim;
        }
      }
    }
    this.recentShots.push({ x: p.x, y: p.y, z: p.z, p: p.id, t: this.time });
    this.emit({ k: "shot", p: p.id, w: def.id, o: [r2(origin.x), r2(origin.y), r2(origin.z)], e: ends });
    if (perVictim.size > 0) shooter.stats.hits++;
    for (const [vid, e] of perVictim) {
      const v = this.players.get(vid);
      if (!v) continue;
      if (e.head) shooter.stats.headshots++;
      this.applyDamage(v, e.dmg, shooter, def.id, { head: e.head, src: origin, dist: e.dist });
    }
    // Arcstorm chain lightning.
    if (def.chain && firstHitPoint && firstVictim) {
      const pts: number[][] = [[r2(firstHitPoint.x), r2(firstHitPoint.y), r2(firstHitPoint.z)]];
      let from = firstHitPoint;
      const hit = new Set([firstVictim.id]);
      for (let n = 0; n < def.chain.max; n++) {
        let best: MatchPlayer | null = null;
        let bd = def.chain.range;
        for (const m of this.players.values()) {
          if (hit.has(m.id) || m === shooter || !m.st.alive || (!this.isFFA && m.team === shooter.team)) continue;
          const c = { x: m.st.x, y: m.st.y + 1.1, z: m.st.z };
          const d = dist3(from, c);
          if (d < bd && this.world.lineOfSight(from, c)) {
            bd = d;
            best = m;
          }
        }
        if (!best) break;
        hit.add(best.id);
        const c = { x: best.st.x, y: best.st.y + 1.1, z: best.st.z };
        pts.push([r2(c.x), r2(c.y), r2(c.z)]);
        this.applyDamage(best, def.chain.damage, shooter, def.id, { src: from });
        from = c;
      }
      if (pts.length > 1) this.emit({ k: "arc", p: p.id, pts });
    }
  }

  /** Traces one round through players, deployables, barrels and cover. */
  private trace(shooter: MatchPlayer, def: WeaponDef, origin: Vec3, dir: Vec3, targets: TargetSnap[]) {
    const hits: { victim: MatchPlayer; head: boolean; dist: number; point: Vec3 }[] = [];
    let o = { ...origin };
    let traveled = 0;
    let pierce = def.pierce ?? 0;
    let wallPen = def.wallPen ?? 0;
    const excluded = new Set<number>();
    let end: Vec3 = { x: o.x + dir.x * def.maxRange, y: o.y + dir.y * def.maxRange, z: o.z + dir.z * def.maxRange };
    let type = 2;
    for (let iter = 0; iter < 6; iter++) {
      const remaining = def.maxRange - traveled;
      if (remaining <= 0) break;
      const wh = this.world.raycast(o, dir, remaining, true);
      let best = wh ? wh.t : remaining;
      let kind: "world" | "none" | "player" | "deploy" | "barrel" | "crate" = wh ? "world" : "none";
      let crate: Crate | null = null;
      let tgt: TargetSnap | null = null;
      let head = false;
      let dep: Deployable | null = null;
      let bar: Barrel | null = null;
      for (const t of targets) {
        if (excluded.has(t.m.id)) continue;
        if (!this.cfg.friendlyFire && !this.isFFA && t.m.team === shooter.team) continue;
        const eh = t.dn ? 0.5 : t.cr ? 1.0 : 1.58;
        const th = raySphere(o, dir, { x: t.x, y: t.y + eh, z: t.z }, HEAD_RADIUS, best);
        if (th >= 0 && th < best) {
          best = th;
          tgt = t;
          head = true;
          kind = "player";
        }
        const top = t.dn ? 0.6 : t.cr ? 0.85 : 1.38;
        const tb = rayAABB(o, dir, { minX: t.x - 0.42, maxX: t.x + 0.42, minY: t.y, maxY: t.y + top, minZ: t.z - 0.42, maxZ: t.z + 0.42 }, best);
        if (tb >= 0 && tb < best) {
          best = tb;
          tgt = t;
          head = false;
          kind = "player";
        }
      }
      for (const d of this.deployables) {
        if (d.kind === "shield" && d.team === shooter.team && !this.isFFA) continue;
        const t = rayAABB(o, dir, this.deployBox(d), best);
        if (t >= 0 && t < best) {
          best = t;
          dep = d;
          kind = "deploy";
        }
      }
      for (const b of this.barrels) {
        if (!b.alive) continue;
        const t = rayAABB(o, dir, { minX: b.x - 0.4, maxX: b.x + 0.4, minY: b.y, maxY: b.y + 1.15, minZ: b.z - 0.4, maxZ: b.z + 0.4 }, best);
        if (t >= 0 && t < best) {
          best = t;
          bar = b;
          kind = "barrel";
        }
      }
      for (const c of this.crates) {
        if (!c.alive) continue;
        const h = CRATE.half;
        const t = rayAABB(o, dir, { minX: c.x - h, maxX: c.x + h, minY: c.y, maxY: c.y + h * 2, minZ: c.z - h, maxZ: c.z + h }, best);
        if (t >= 0 && t < best) {
          best = t;
          crate = c;
          kind = "crate";
        }
      }
      const point = { x: o.x + dir.x * best, y: o.y + dir.y * best, z: o.z + dir.z * best };
      if (kind === "player" && tgt) {
        hits.push({ victim: tgt.m, head, dist: traveled + best, point });
        if (pierce > 0) {
          pierce--;
          excluded.add(tgt.m.id);
          o = { x: point.x + dir.x * 0.05, y: point.y + dir.y * 0.05, z: point.z + dir.z * 0.05 };
          traveled += best + 0.05;
          continue;
        }
        end = point;
        type = 1;
        break;
      }
      if (kind === "deploy" && dep) {
        dep.hp -= def.damage;
        if (dep.hp <= 0) this.destroyDeployable(dep, dep.kind !== "shield", shooter.id);
        end = point;
        type = 3;
        break;
      }
      if (kind === "crate" && crate) {
        crate.hp -= def.damage;
        if (crate.hp <= 0) this.breakCrate(crate);
        end = point;
        type = 0;
        break;
      }
      if (kind === "barrel" && bar) {
        bar.hp -= def.damage * def.pellets;
        bar.lastHitBy = shooter.id;
        if (bar.hp <= 0 && bar.fuse < 0) bar.fuse = 0.12;
        end = point;
        type = 0;
        break;
      }
      if (kind === "world" && wh) {
        const thick = this.world.exitDistance(o, dir, wh.box) - wh.t;
        if (wallPen > 0 && thick <= wallPen) {
          wallPen = 0;
          const adv = wh.t + thick + 0.05;
          o = { x: o.x + dir.x * adv, y: o.y + dir.y * adv, z: o.z + dir.z * adv };
          traveled += adv;
          continue;
        }
        end = point;
        type = 0;
        break;
      }
      end = point;
      type = 2;
      break;
    }
    return { end, type, hits };
  }

  private deployBox(d: Deployable) {
    if (d.kind === "shield") {
      const hw = SHIELD.width / 2;
      const ht = SHIELD.thickness / 2;
      return d.ax === 0
        ? { minX: d.x - hw, maxX: d.x + hw, minY: d.y, maxY: d.y + SHIELD.height, minZ: d.z - ht, maxZ: d.z + ht }
        : { minX: d.x - ht, maxX: d.x + ht, minY: d.y, maxY: d.y + SHIELD.height, minZ: d.z - hw, maxZ: d.z + hw };
    }
    const s = d.kind === "mine" ? 0.3 : 0.25;
    return { minX: d.x - s, maxX: d.x + s, minY: d.y, maxY: d.y + 0.25, minZ: d.z - s, maxZ: d.z + s };
  }

  // -------------------------------------------------------------------------
  // Damage, downs, kills
  // -------------------------------------------------------------------------

  applyDamage(
    v: MatchPlayer, amount: number, attacker: MatchPlayer | null, cause: string,
    o: { head?: boolean; src: Vec3; explosive?: boolean; dist?: number; ignoreArmor?: boolean },
  ): number {
    const st = v.st;
    if (!st.alive || amount <= 0) return 0;
    if (this.phase !== "live") return 0;
    if (st.spawnProt > 0 && attacker && attacker !== v) return 0;
    if (attacker && attacker !== v && !this.isFFA && attacker.team === v.team && !this.cfg.friendlyFire) return 0;
    if (attacker === v) amount *= 0.5;
    let toArmor = 0;
    if (!o.ignoreArmor && !st.downed) {
      toArmor = Math.min(st.armor, amount);
      st.armor -= toArmor;
    }
    const before = st.health;
    st.health -= amount - toArmor;
    const dealt = Math.min(amount, before + toArmor);
    v.lastHurt = this.time;
    if (attacker && attacker !== v) {
      attacker.stats.damage += dealt;
      const e = v.damageLog.get(attacker.id) ?? { dmg: 0, t: 0 };
      e.dmg += dealt;
      e.t = this.time;
      v.damageLog.set(attacker.id, e);
    }
    this.emit({ k: "dmg", to: v.id, s: [r2(o.src.x), r2(o.src.y), r2(o.src.z)], d: Math.round(dealt) });
    if (st.health <= 0) {
      const canDown = this.isBR && !st.downed && [...this.players.values()].some((p) => p !== v && p.team === v.team && p.st.alive && !p.st.downed);
      if (canDown) {
        this.down(v, attacker);
        if (attacker && attacker !== v) this.emit({ k: "hit", to: attacker.id, v: v.id, d: Math.round(dealt), h: !!o.head, x: true });
      } else {
        if (attacker && attacker !== v) this.emit({ k: "hit", to: attacker.id, v: v.id, d: Math.round(dealt), h: !!o.head, x: true });
        this.kill(v, attacker && attacker !== v ? attacker : attacker === v ? v : this.recentAttacker(v), cause, !!o.head, o);
      }
    } else if (attacker && attacker !== v) {
      this.emit({ k: "hit", to: attacker.id, v: v.id, d: Math.round(dealt), h: !!o.head, x: false, sh: toArmor > 0 && st.armor <= 0 });
    }
    return dealt;
  }

  private down(v: MatchPlayer, by: MatchPlayer | null): void {
    v.st.downed = true;
    v.st.health = DOWNED_HEALTH;
    v.st.chan = "";
    v.st.ads = 0;
    v.st.reloadT = 0;
    v.downedT = DOWNED_BLEEDOUT;
    this.emit({ k: "down", v: v.id, by: by?.id ?? -1 });
    this.checkTeamElimination(v.team);
  }

  private kill(v: MatchPlayer, killer: MatchPlayer | null, cause: string, head: boolean, o?: { src: Vec3; dist?: number }): void {
    const st = v.st;
    if (!st.alive) return;
    const wasStreak = v.stats.streak;
    st.alive = false;
    st.downed = false;
    st.health = 0;
    v.stats.deaths++;
    v.stats.streak = 0;
    v.lastKilledBy = killer && killer !== v ? killer.id : -1;
    v.respawnAt = this.respawns ? this.time + this.cfg.respawnDelay : -1;
    const assists: number[] = [];
    for (const [aid, e] of v.damageLog) {
      if (killer && aid === killer.id) continue;
      if (aid === v.id || this.time - e.t > ASSIST_WINDOW || e.dmg < 20) continue;
      const a = this.players.get(aid);
      if (!a) continue;
      a.stats.assists++;
      a.stats.score += ASSIST_SCORE;
      assists.push(aid);
    }
    v.damageLog.clear();
    if (killer && killer !== v) {
      const ks = killer.stats;
      ks.kills++;
      ks.streak++;
      ks.bestStreak = Math.max(ks.bestStreak, ks.streak);
      ks.score += KILL_SCORE + (head ? HEADSHOT_BONUS : 0);
      v.killedBy.set(killer.id, (v.killedBy.get(killer.id) ?? 0) + 1);
      ks.weaponKills[cause] = (ks.weaponKills[cause] ?? 0) + 1;
      this.awardKillMedals(killer, v, cause, head, wasStreak, o);
      // Kills score for the team in TDM only; Domination is scored by objectives.
      if (this.cfg.mode === "tdm") this.teamScores[killer.team] = (this.teamScores[killer.team] ?? 0) + 1;
      if (this.isGunGame) this.promote(killer);
    } else if (this.cfg.mode === "ffa" && v.stats.kills > 0 && cause !== "storm") {
      // Suicides cost a point in FFA.
      v.stats.kills = Math.max(0, v.stats.kills - 1);
    } else if (this.isGunGame && v.gunTier > 0) {
      // Gun Game: a self-inflicted death knocks you back one weapon.
      v.gunTier--;
      this.emit({ k: "msg", to: v.id, t: "Demoted — back one weapon" });
    }
    this.emit({ k: "kill", kr: killer && killer !== v ? killer.id : -1, v: v.id, w: cause, h: head, as: assists });
    this.dropOnDeath(v);
    if (this.isBR) {
      v.eliminated = true;
      this.checkTeamElimination(v.team);
    }
  }

  /** Gun Game: advance the killer one weapon; a kill with the last one wins (see checkEnd). */
  private promote(k: MatchPlayer): void {
    k.gunTier++;
    if (k.gunTier >= GUN_LADDER.length) return;
    this.giveGunTier(k);
    this.medal(k, "promoted");
    if (k.gunTier === GUN_LADDER.length - 1) {
      this.medal(k, "final_tier");
      this.emit({ k: "ann", t: `${k.name} is on the FINAL weapon`, c: "bounty" });
    }
  }

  private medal(mp: MatchPlayer, m: string, score = MEDAL_SCORES[m] ?? 0): void {
    mp.stats.medals[m] = (mp.stats.medals[m] ?? 0) + 1;
    mp.stats.score += score;
    this.emit({ k: "medal", to: mp.id, m });
  }

  private awardKillMedals(k: MatchPlayer, v: MatchPlayer, cause: string, head: boolean, victimStreak: number, o?: { src: Vec3; dist?: number }): void {
    if (!this.firstBlood) {
      this.firstBlood = true;
      this.medal(k, "first_blood");
      this.emit({ k: "ann", t: `${k.name} drew FIRST BLOOD`, c: "info" });
    }
    if (this.time - k.lastKillT < 4) k.multi++;
    else k.multi = 1;
    k.lastKillT = this.time;
    if (k.multi === 2) this.medal(k, "double_kill");
    else if (k.multi === 3) this.medal(k, "triple_kill");
    else if (k.multi >= 4) this.medal(k, "rampage");
    if (head) this.medal(k, "headshot");
    if (o?.dist && o.dist > 45) this.medal(k, "longshot");
    if (v.id === k.lastKilledBy) {
      this.medal(k, "revenge");
      k.lastKilledBy = -1;
    }
    if (victimStreak >= 5) {
      this.medal(k, "shutdown");
      this.emit({ k: "ann", t: `${k.name} collected the bounty on ${v.name}`, c: "bounty" });
    }
    if (cause === "frag" || cause === "nova" || cause === "mine" || cause === "remote" || cause === "barrel") this.medal(k, "demolition");
    if (k.st.health > 0 && k.st.health < 25) this.medal(k, "clutch");
    if (!k.st.onGround) this.medal(k, "airborne");
    if (k.st.slideT > 0) this.medal(k, "slide_kill");
    // Nemesis: payback on the player who has eliminated you the most (3+ times).
    if ((k.killedBy.get(v.id) ?? 0) >= 3) {
      this.medal(k, "nemesis");
      k.killedBy.set(v.id, 0);
    }
    const s = k.stats.streak;
    if (s === 3) {
      this.medal(k, "streak_3");
      // Reward: team-wide radar sweep.
      for (const e of this.players.values()) if (e.team !== k.team || this.isFFA) if (e !== k) e.revealed.set(k.team, this.time + 5);
      this.emit({ k: "ann", t: "RADAR SWEEP online", c: "streak", tm: k.team });
    } else if (s === 5) {
      this.medal(k, "streak_5");
      k.st.overdrive = 15;
      k.st.armor = this.env.maxArmor;
      this.emit({ k: "ann", t: `${k.name} is on a 5 streak — BOUNTY placed`, c: "bounty" });
    } else if (s === 8) {
      this.medal(k, "streak_8");
      // Reward: full restock — health, armor, ammo and a long Overdrive.
      k.st.health = MAX_HEALTH;
      k.st.armor = this.env.maxArmor;
      k.st.overdrive = 20;
      for (const sl of k.st.slots) if (sl) sl.reserve = Math.max(sl.reserve, WEAPONS[sl.id].reserve);
      this.emit({ k: "ann", t: `${k.name} is UNSTOPPABLE (8 streak)`, c: "bounty" });
    }
    // Objective defence.
    if (this.track && k.team === 1 && distXZ(trackPoint(this.track, this.cart.d), v.st) < 10) this.medal(k, "defender");
    if (this.cfg.mode === "dom") {
      for (const cp of this.points)
        if (cp.owner === k.team && distXZ(cp, v.st) < 10) {
          this.medal(k, "defender");
          break;
        }
    }
  }

  private checkTeamElimination(team: number): void {
    if (!this.isBR || this.phase !== "live") return;
    const members = [...this.players.values()].filter((p) => p.team === team);
    const standing = members.filter((p) => p.st.alive && !p.st.downed);
    if (standing.length > 0) return;
    // Whole squad down or dead: finish downed players.
    for (const p of members) if (p.st.alive && p.st.downed) this.kill(p, this.recentAttacker(p), "bleedout", false);
    if (members.every((p) => p.placement > 0)) return;
    const aliveTeams = new Set([...this.players.values()].filter((p) => p.st.alive).map((p) => p.team));
    const placement = aliveTeams.size + 1;
    for (const p of members) if (!p.placement) p.placement = placement;
    this.teamsEliminated++;
    this.emit({ k: "ann", t: `Squad eliminated — ${aliveTeams.size} remaining`, c: "info" });
  }

  // -------------------------------------------------------------------------
  // Pickups & interaction
  // -------------------------------------------------------------------------

  private interact(p: PlayerState, held: boolean, pressed: boolean): void {
    const mp = this.players.get(p.id);
    if (!mp || !p.alive || p.downed) return;
    // Revive downed teammates (hold).
    if (held) {
      let target: MatchPlayer | null = null;
      for (const o of this.players.values()) {
        if (o === mp || o.team !== mp.team || !o.st.alive || !o.st.downed) continue;
        if (dist3(o.st, p) < 2.2) {
          target = o;
          break;
        }
      }
      if (target) {
        if (mp.reviveTarget !== target.id) {
          mp.reviveTarget = target.id;
          mp.reviveT = 0;
        }
        mp.reviveT += SIM_DT;
        if (mp.reviveT >= REVIVE_TIME) {
          target.st.downed = false;
          target.st.health = 30;
          target.downedT = 0;
          mp.reviveTarget = -1;
          mp.reviveT = 0;
          mp.stats.revives++;
          this.medal(mp, "revive");
          this.emit({ k: "revive", v: target.id, by: mp.id });
        }
        return;
      }
    }
    mp.reviveTarget = -1;
    mp.reviveT = 0;
    if (!pressed) return;
    // Manual pickup: weapons and power weapons.
    let best: Pickup | null = null;
    let bd = 2.4;
    for (const pk of this.pickups) {
      if (!pk.active || (pk.kind !== "weapon" && pk.kind !== "power")) continue;
      const d = dist3(pk, p);
      if (d < bd && Math.abs(pk.y - p.y) < 1.8) {
        bd = d;
        best = pk;
      }
    }
    if (best) this.takeWeapon(mp, best);
  }

  private takeWeapon(mp: MatchPlayer, pk: Pickup): void {
    const st = mp.st;
    const id = pk.weapon!;
    const def = WEAPONS[id];
    const slotIdx = def.slot === "power" ? 2 : def.slot === "secondary" ? 1 : 0;
    const existing = st.slots[slotIdx];
    if (existing && existing.id === id) {
      if (def.ammoPickupMags === 0) return;
      existing.reserve = Math.min(def.reserve * 2, existing.reserve + def.mag * def.ammoPickupMags);
    } else {
      if (existing) this.dropWeapon(existing.id, existing.mag, existing.reserve, st);
      const slot = makeSlot(id, !this.isBR);
      if (pk.mag !== undefined) slot.mag = pk.mag;
      if (pk.reserve !== undefined) slot.reserve = pk.reserve;
      st.slots[slotIdx] = slot;
      st.active = slotIdx;
      st.swapT = def.swapTime;
      st.reloadT = 0;
      st.burstLeft = 0;
    }
    this.consumePickup(pk);
    this.emit({ k: "msg", to: mp.id, t: `Picked up ${def.name}` });
    if (def.slot === "power") this.emit({ k: "ann", t: `${mp.name} claimed the ${def.name}`, c: "power" });
  }

  private consumePickup(pk: Pickup): void {
    pk.active = false;
    if (pk.expireAt > 0 || pk.respawn <= 0) {
      this.pickups.splice(this.pickups.indexOf(pk), 1);
      return;
    }
    pk.respawnAt = this.time + pk.respawn;
  }

  private dropWeapon(id: WeaponId, mag: number, reserve: number, at: Vec3): void {
    if (mag + reserve <= 0) return;
    const pk = this.addPickup(WEAPONS[id].slot === "power" ? "power" : "weapon", { x: at.x + this.rng.range(-0.6, 0.6), y: at.y + 0.05, z: at.z + this.rng.range(-0.6, 0.6) }, id, 0);
    pk.mag = mag;
    pk.reserve = reserve;
    pk.expireAt = this.time + 40;
  }

  private dropOnDeath(v: MatchPlayer): void {
    const st = v.st;
    if (this.isBR) {
      this.dropLoot(v);
      return;
    }
    // Arena: power weapons drop with their remaining (limited) ammo.
    const pw = st.slots[2];
    if (pw) {
      this.dropWeapon(pw.id, pw.mag, pw.reserve, st);
      st.slots[2] = null;
    }
    if (this.rng.next() < 0.4) {
      const pk = this.addPickup("ammo", { x: st.x, y: st.y + 0.05, z: st.z }, undefined, 0);
      pk.expireAt = this.time + 25;
    }
  }

  private dropLoot(v: MatchPlayer): void {
    const st = v.st;
    for (const s of st.slots) if (s) this.dropWeapon(s.id, s.mag, s.reserve, st);
    const drop = (kind: Pickup["kind"], n: number) => {
      for (let i = 0; i < n; i++) {
        const pk = this.addPickup(kind, { x: st.x + this.rng.range(-1, 1), y: st.y + 0.05, z: st.z + this.rng.range(-1, 1) }, undefined, 0);
        pk.expireAt = this.time + 120;
      }
    };
    drop("injector", Math.min(2, st.injectors));
    drop("plate", Math.min(2, st.plates));
    if (GRENADE_IDS.some((g) => st.nades[g] > 0)) drop("grenade", 1);
    st.slots = [null, null, null];
  }

  private autoPickups(mp: MatchPlayer): void {
    const st = mp.st;
    if (st.downed) return;
    for (const pk of this.pickups) {
      if (!pk.active) continue;
      const dx = pk.x - st.x;
      const dz = pk.z - st.z;
      if (dx * dx + dz * dz > 1.6 * 1.6 || Math.abs(pk.y - st.y) > 1.5) continue;
      switch (pk.kind) {
        case "health":
          if (st.health >= MAX_HEALTH) continue;
          st.health = Math.min(MAX_HEALTH, st.health + 50);
          this.emit({ k: "msg", to: mp.id, t: "+50 Health" });
          break;
        case "armor":
          if (st.armor >= this.env.maxArmor) continue;
          st.armor = Math.min(this.env.maxArmor, st.armor + 50);
          this.emit({ k: "msg", to: mp.id, t: "+50 Armor" });
          break;
        case "ammo": {
          let took = false;
          for (const s of st.slots) {
            if (!s) continue;
            const d = WEAPONS[s.id];
            if (d.ammoPickupMags === 0) continue;
            const cap = d.reserve * 2;
            if (s.reserve < cap) {
              s.reserve = Math.min(cap, s.reserve + d.mag * d.ammoPickupMags);
              took = true;
            }
          }
          if (!took) continue;
          this.emit({ k: "msg", to: mp.id, t: "+Ammo" });
          break;
        }
        case "grenade": {
          const g = this.isBR ? this.rng.pick(GRENADE_IDS) : "frag";
          const extra = this.rng.pick(["smoke", "flash", "emp"] as const);
          if (st.nades[g] >= GRENADES[g].max && st.nades[extra] >= GRENADES[extra].max) continue;
          st.nades[g] = Math.min(GRENADES[g].max, st.nades[g] + 1);
          if (!this.isBR) st.nades[extra] = Math.min(GRENADES[extra].max, st.nades[extra] + 1);
          this.emit({ k: "msg", to: mp.id, t: `+${GRENADES[g].name}` });
          break;
        }
        case "injector":
          if (st.injectors >= INJECTOR.max) continue;
          st.injectors++;
          this.emit({ k: "msg", to: mp.id, t: "+Healing Injector" });
          break;
        case "plate":
          if (st.plates >= PLATE.max) continue;
          st.plates++;
          this.emit({ k: "msg", to: mp.id, t: "+Armor Plate" });
          break;
        case "weapon": {
          // Auto-take only into an empty slot (BR start, or after drops).
          const slotIdx = WEAPONS[pk.weapon!].slot === "secondary" ? 1 : 0;
          if (st.slots[slotIdx]) continue;
          this.takeWeapon(mp, pk);
          continue;
        }
        default:
          continue;
      }
      this.consumePickup(pk);
    }
  }

  private claimCache(mp: MatchPlayer): void {
    this.cache = null;
    mp.st.overdrive = 20;
    mp.st.armor = this.env.maxArmor;
    mp.st.tacCd = 0;
    if (this.cfg.mode === "tdm") this.teamScores[mp.team] = (this.teamScores[mp.team] ?? 0) + 3;
    else if (this.cfg.mode === "dom") this.teamScores[mp.team] = (this.teamScores[mp.team] ?? 0) + 10;
    this.medal(mp, "data_heist");
    this.emit({ k: "ann", t: `${mp.name} cracked the DATA CACHE — Overdrive active`, c: "cache" });
  }

  // -------------------------------------------------------------------------
  // Tactical equipment
  // -------------------------------------------------------------------------

  private useTactical(p: PlayerState): boolean {
    const mp = this.players.get(p.id);
    if (!mp || this.phase !== "live") return false;
    const own = this.deployables.filter((d) => d.owner === p.id);
    // Remote charge: second press detonates.
    if (p.tactical === "remote") {
      const charge = own.find((d) => d.kind === "remote");
      if (charge) {
        if (this.time - charge.t >= REMOTE.minDelay) this.destroyDeployable(charge, true, p.id);
        return true;
      }
    }
    if (p.tacCd > 0) return false;
    const fwd = viewDir(p.yaw, 0);
    const eye = { x: p.x, y: p.y + eyeHeight(p), z: p.z };
    switch (p.tactical) {
      case "recon": {
        let n = 0;
        for (const o of this.players.values()) {
          if (o === mp || !o.st.alive || (!this.isFFA && o.team === mp.team)) continue;
          if (dist3(o.st, p) > RECON.radius) continue;
          o.revealed.set(mp.team, this.time + RECON.duration);
          this.emit({ k: "scanned", to: o.id });
          n++;
        }
        this.emit({ k: "scan", tm: mp.team, x: r2(p.x), z: r2(p.z) });
        this.emit({ k: "msg", to: mp.id, t: n ? `Recon: ${n} enemy${n > 1 ? "s" : ""} pinged` : "Recon: no contacts" });
        break;
      }
      case "shield": {
        const x = p.x + fwd.x * 1.6;
        const z = p.z + fwd.z * 1.6;
        const y = this.world.groundHeight(x, z, p.y + 1.2);
        const ax = Math.abs(fwd.x) > Math.abs(fwd.z) ? 1 : 0;
        for (const d of own) if (d.kind === "shield") this.destroyDeployable(d, false, -1);
        this.deployables.push({ id: this.nextId++, kind: "shield", owner: p.id, team: mp.team, x, y: isFinite(y) ? y : p.y, z, ax, hp: SHIELD.hp, t: this.time, until: this.time + SHIELD.duration, trigger: -1 });
        break;
      }
      case "mine": {
        const mines = own.filter((d) => d.kind === "mine");
        if (mines.length >= MINE.max) this.destroyDeployable(mines[0]!, false, -1);
        const x = p.x + fwd.x * 0.9;
        const z = p.z + fwd.z * 0.9;
        const y = this.world.groundHeight(x, z, p.y + 0.8);
        this.deployables.push({ id: this.nextId++, kind: "mine", owner: p.id, team: mp.team, x, y: isFinite(y) ? y : p.y, z, ax: 0, hp: MINE.hp, t: this.time, until: this.time + 120, trigger: -1 });
        break;
      }
      case "remote": {
        const dir = viewDir(p.yaw, p.pitch);
        const hit = this.world.raycast(eye, dir, 3.2, true);
        const t = hit ? hit.t - 0.1 : 1.0;
        let pos = { x: eye.x + dir.x * t, y: eye.y + dir.y * t, z: eye.z + dir.z * t };
        if (!hit) {
          const gy = this.world.groundHeight(pos.x, pos.z, pos.y);
          pos = { ...pos, y: isFinite(gy) ? gy : p.y };
        }
        this.deployables.push({ id: this.nextId++, kind: "remote", owner: p.id, team: mp.team, ...pos, ax: 0, hp: REMOTE.hp, t: this.time, until: this.time + 90, trigger: -1 });
        break;
      }
    }
    p.tacCd = TACTICALS[p.tactical].cooldown;
    return true;
  }

  private destroyDeployable(d: Deployable, explode: boolean, by: number): void {
    const i = this.deployables.indexOf(d);
    if (i < 0) return;
    this.deployables.splice(i, 1);
    if (!explode) return;
    if (d.kind === "mine") this.explode(d.x, d.y + 0.2, d.z, MINE.radius, MINE.damage, d.owner, "mine");
    else if (d.kind === "remote") this.explode(d.x, d.y + 0.2, d.z, REMOTE.radius, REMOTE.damage, d.owner, "remote");
    void by;
  }

  private updateDeployables(dt: number): void {
    for (const d of [...this.deployables]) {
      if (this.time > d.until) {
        this.destroyDeployable(d, false, -1);
        continue;
      }
      if (!this.players.has(d.owner) && d.kind !== "shield") {
        this.destroyDeployable(d, false, -1);
        continue;
      }
      if (d.kind === "mine" && this.time - d.t > MINE.arm) {
        if (d.trigger > 0) {
          d.trigger -= dt;
          if (d.trigger <= 0) this.destroyDeployable(d, true, -1);
          continue;
        }
        for (const o of this.players.values()) {
          if (!o.st.alive || (!this.isFFA && o.team === d.team) || o.id === d.owner) continue;
          if (dist3(o.st, d) < MINE.trigger && this.world.lineOfSight({ x: d.x, y: d.y + 0.3, z: d.z }, { x: o.st.x, y: o.st.y + 0.5, z: o.st.z })) {
            d.trigger = 0.35;
            break;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Projectiles & explosions
  // -------------------------------------------------------------------------

  private updateProjectiles(dt: number): void {
    const sub = 2;
    const h = dt / sub;
    for (const pr of [...this.projectiles]) {
      let done = false;
      for (let s = 0; s < sub && !done; s++) {
        pr.age += h;
        pr.fuse -= h;
        const grav = pr.kind === "nova" ? WEAPONS.nova.projectile!.gravity : GRAVITY * this.env.gravity;
        pr.vy -= grav * h;
        const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
        if (sp > 1e-4) {
          const dir = { x: pr.vx / sp, y: pr.vy / sp, z: pr.vz / sp };
          const dist = sp * h;
          const hit = this.world.raycast(pr, dir, dist + 0.08, pr.kind === "nova" ? true : false);
          // Nova: direct impact with players.
          if (pr.kind === "nova") {
            for (const o of this.players.values()) {
              if (!o.st.alive || o.id === pr.owner || (!this.isFFA && o.team === pr.team)) continue;
              const t = rayAABB(pr, dir, playerAABB(o.st), dist + 0.3);
              if (t >= 0 && (!hit || t < hit.t)) {
                pr.x += dir.x * t;
                pr.y += dir.y * t;
                pr.z += dir.z * t;
                this.detonate(pr, o);
                done = true;
                break;
              }
            }
            if (done) break;
            const shield = this.deployables.find((d) => d.kind === "shield" && d.team !== pr.team && rayAABB(pr, dir, this.deployBox(d), dist) >= 0);
            if (shield) {
              shield.hp -= 120;
              if (shield.hp <= 0) this.destroyDeployable(shield, false, pr.owner);
              this.detonate(pr, null);
              done = true;
              break;
            }
          }
          if (hit) {
            pr.x += dir.x * Math.max(0, hit.t - 0.05);
            pr.y += dir.y * Math.max(0, hit.t - 0.05);
            pr.z += dir.z * Math.max(0, hit.t - 0.05);
            if (pr.kind === "nova") {
              this.detonate(pr, null);
              done = true;
              break;
            }
            const g = GRENADES[pr.kind as GrenadeId];
            if (hit.axis === 0) pr.vx = -pr.vx * g.bounce;
            else if (hit.axis === 1) pr.vy = -pr.vy * g.bounce;
            else pr.vz = -pr.vz * g.bounce;
            pr.vx *= 0.8;
            pr.vz *= 0.8;
            if (hit.axis === 1 && Math.abs(pr.vy) < 1.2) pr.vy = 0;
          } else {
            pr.x += pr.vx * h;
            pr.y += pr.vy * h;
            pr.z += pr.vz * h;
          }
        }
        if (pr.y < KILL_PLANE_Y || pr.age > 12) {
          this.projectiles.splice(this.projectiles.indexOf(pr), 1);
          done = true;
          break;
        }
        if (pr.fuse <= 0) {
          this.detonate(pr, null);
          done = true;
        }
      }
    }
  }

  private detonate(pr: Projectile, direct: MatchPlayer | null): void {
    const i = this.projectiles.indexOf(pr);
    if (i >= 0) this.projectiles.splice(i, 1);
    const owner = this.players.get(pr.owner) ?? null;
    switch (pr.kind) {
      case "nova": {
        const pj = WEAPONS.nova.projectile!;
        if (direct && owner) this.applyDamage(direct, WEAPONS.nova.damage, owner, "nova", { src: pr, explosive: true });
        this.explode(pr.x, pr.y, pr.z, pj.splashRadius, pj.splashDamage, pr.owner, "nova");
        break;
      }
      case "frag":
        this.explode(pr.x, pr.y + 0.1, pr.z, GRENADES.frag.radius, GRENADES.frag.damage, pr.owner, "frag");
        break;
      case "smoke":
        this.smokes.push({ id: this.nextId++, x: pr.x, y: pr.y, z: pr.z, r: GRENADES.smoke.radius, until: this.time + GRENADES.smoke.duration });
        this.emit({ k: "boom", x: r2(pr.x), y: r2(pr.y), z: r2(pr.z), r: GRENADES.smoke.radius, t: "smoke" });
        break;
      case "flash": {
        const g = GRENADES.flash;
        const c = { x: pr.x, y: pr.y + 0.2, z: pr.z };
        for (const o of this.players.values()) {
          if (!o.st.alive) continue;
          const eye = { x: o.st.x, y: o.st.y + eyeHeight(o.st), z: o.st.z };
          const d = dist3(eye, c);
          if (d > g.radius || !this.world.lineOfSight(c, eye) || this.smokeBlocks(c, eye)) continue;
          const v = viewDir(o.st.yaw, o.st.pitch);
          const look = (v.x * (c.x - eye.x) + v.y * (c.y - eye.y) + v.z * (c.z - eye.z)) / (d || 1);
          const facing = look > 0.5 ? 1 : look > -0.1 ? 0.45 : 0.12;
          const amt = clamp((1 - d / g.radius) * 1.3, 0, 1) * facing;
          if (amt < 0.05) continue;
          o.st.flash = Math.max(o.st.flash, g.duration * amt);
          this.emit({ k: "flashed", to: o.id, s: r2(amt) });
        }
        this.emit({ k: "boom", x: r2(pr.x), y: r2(pr.y), z: r2(pr.z), r: 3, t: "flash" });
        break;
      }
      case "emp": {
        const g = GRENADES.emp;
        for (const o of this.players.values()) {
          if (!o.st.alive || (!this.isFFA && o.team === pr.team && o.id !== pr.owner)) continue;
          if (o.id === pr.owner) continue;
          if (dist3(o.st, pr) > g.radius) continue;
          o.st.armor = Math.max(0, o.st.armor - g.damage);
          o.st.emp = Math.max(o.st.emp, g.duration);
          this.emit({ k: "msg", to: o.id, t: "EMP — systems scrambled" });
        }
        for (const d of [...this.deployables]) if (dist3(d, pr) < g.radius && (this.isFFA || d.team !== pr.team)) this.destroyDeployable(d, false, pr.owner);
        this.emit({ k: "boom", x: r2(pr.x), y: r2(pr.y), z: r2(pr.z), r: g.radius, t: "emp" });
        break;
      }
    }
  }

  /** Radial damage with cover occlusion (chest & head line-of-sight checks). */
  private explode(x: number, y: number, z: number, radius: number, damage: number, ownerId: number, cause: string): void {
    const c = { x, y: y + 0.15, z };
    const owner = this.players.get(ownerId) ?? null;
    for (const o of this.players.values()) {
      if (!o.st.alive) continue;
      const chest = { x: o.st.x, y: o.st.y + bodyHeight(o.st) * 0.55, z: o.st.z };
      const d = dist3(c, chest);
      if (d > radius) continue;
      const head = { x: o.st.x, y: o.st.y + bodyHeight(o.st) * 0.9, z: o.st.z };
      const feet = { x: o.st.x, y: o.st.y + 0.2, z: o.st.z };
      const vis = [chest, head, feet].filter((pt) => this.world.lineOfSight(c, pt)).length;
      if (vis === 0) continue;
      const k = 1 - (d / radius) ** 1.3;
      const dmg = damage * k * (vis === 3 ? 1 : vis === 2 ? 0.75 : 0.45);
      this.applyDamage(o, dmg, owner, cause, { src: c, explosive: true });
    }
    for (const d of [...this.deployables]) if (dist3(d, c) < radius * 0.7) this.destroyDeployable(d, d.kind !== "shield", ownerId);
    for (const cr of this.crates) if (cr.alive && dist3(cr, c) < radius * 0.8) this.breakCrate(cr);
    for (const b of this.barrels) {
      if (b.alive && b.fuse < 0 && dist3(b, c) < radius * 0.8) {
        b.fuse = 0.18;
        b.lastHitBy = ownerId;
      }
    }
    this.emit({ k: "boom", x: r2(x), y: r2(y), z: r2(z), r: radius, t: cause });
  }

  smokeBlocks(a: Vec3, b: Vec3): boolean {
    for (const s of this.smokes) {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const abz = b.z - a.z;
      const l2 = abx * abx + aby * aby + abz * abz || 1;
      const t = clamp(((s.x - a.x) * abx + (s.y + 1 - a.y) * aby + (s.z - a.z) * abz) / l2, 0, 1);
      const px = a.x + abx * t - s.x;
      const py = a.y + aby * t - (s.y + 1);
      const pz = a.z + abz * t - s.z;
      if (px * px + py * py + pz * pz < s.r * s.r * 0.7) return true;
    }
    return false;
  }

  /** Pops a crate open and drops a random pickup where it stood. */
  private breakCrate(c: Crate): void {
    if (!c.alive) return;
    c.alive = false;
    c.respawnAt = this.time + CRATE.respawn;
    const r = this.rng.next();
    let kind: Pickup["kind"] = r < 0.3 ? "ammo" : r < 0.55 ? "health" : r < 0.75 ? "armor" : r < 0.9 ? "grenade" : "weapon";
    if (this.isGunGame && (kind === "weapon" || kind === "grenade")) kind = "ammo";
    const pk = this.addPickup(kind, { x: c.x, y: c.y + 0.05, z: c.z }, kind === "weapon" ? this.rng.pick(PRIMARY_IDS) : undefined, 0);
    pk.expireAt = this.time + 30;
    this.emit({ k: "boom", x: r2(c.x), y: r2(c.y + 0.5), z: r2(c.z), r: 1, t: "crate" });
  }

  private updateWorldEntities(dt: number): void {
    for (const c of this.crates) {
      if (!c.alive && this.respawns && this.time >= c.respawnAt) {
        c.alive = true;
        c.hp = CRATE.hp;
      }
    }
    for (const b of this.barrels) {
      if (b.alive && b.fuse >= 0) {
        b.fuse -= dt;
        if (b.fuse < 0) {
          b.alive = false;
          b.respawnAt = this.time + BARREL.respawn;
          this.explode(b.x, b.y + 0.6, b.z, BARREL.radius, BARREL.damage, b.lastHitBy, "barrel");
        }
      } else if (!b.alive && this.time >= b.respawnAt && this.respawns) {
        b.alive = true;
        b.hp = BARREL.hp;
        b.fuse = -1;
        b.lastHitBy = -1;
      }
    }
    for (const pk of [...this.pickups]) {
      if (pk.expireAt > 0 && this.time > pk.expireAt) {
        this.pickups.splice(this.pickups.indexOf(pk), 1);
        continue;
      }
      if (!pk.active && pk.respawn > 0 && this.time >= pk.respawnAt && this.phase === "live") {
        pk.active = true;
        if (pk.kind === "power") this.emit({ k: "ann", t: `${WEAPONS[pk.weapon!].name} is online`, c: "power" });
      }
    }
    this.smokes = this.smokes.filter((s) => s.until > this.time);
  }

  // -------------------------------------------------------------------------
  // Mode rules
  // -------------------------------------------------------------------------

  private updateMode(dt: number): void {
    if (this.phase !== "live") return;
    const t = this.time;
    // Dynamic objective: Data Cache (TDM/FFA/DOM).
    if (!this.isBR && this.cfg.mode !== "training") {
      if (!this.cache && t >= this.nextCacheAt && this.district) {
        const s = this.district.spawns[this.rng.int(0, this.district.spawns.length - 1)]!;
        this.cache = { x: s.x, y: s.y, z: s.z, until: t + 45 };
        this.nextCacheAt = t + (this.has("powersurge") ? 40 : 80);
        this.emit({ k: "ann", t: "DATA CACHE detected — grab it for Overdrive", c: "cache" });
      } else if (this.cache && t > this.cache.until) {
        this.cache = null;
        this.emit({ k: "ann", t: "Data Cache expired", c: "info" });
      }
    }
    // Neon storm event.
    if (this.has("neonstorm")) {
      if (!this.stormWarned && t >= this.nextStormAt - 5) {
        this.stormWarned = true;
        this.emit({ k: "ann", t: "NEON STORM incoming — HUDs will scramble", c: "storm" });
      }
      if (t >= this.nextStormAt) {
        this.stormUntil = t + 8;
        this.nextStormAt = t + 70;
        this.stormWarned = false;
      }
    }
    if (this.cfg.mode === "dom") this.updateDomination(dt);
    if (this.track) this.updatePayload(dt);
    if (this.isBR) this.updateZone();
  }

  private updateDomination(dt: number): void {
    const t = this.time;
    if (t >= this.overclockAt) {
      this.overclocked = this.rng.int(0, this.points.length - 1);
      this.overclockAt = t + 60;
      this.emit({ k: "ann", t: `Point ${"ABC"[this.overclocked]} is OVERCLOCKED — double points`, c: "objective" });
    }
    for (let i = 0; i < this.points.length; i++) {
      const cp = this.points[i]!;
      const counts = [0, 0];
      for (const p of this.players.values()) {
        if (!p.st.alive || p.st.downed) continue;
        if (distXZ(p.st, cp) < 5 && Math.abs(p.st.y - cp.y) < 3) counts[p.team] = (counts[p.team] ?? 0) + 1;
      }
      const a = counts[0] ?? 0;
      const b = counts[1] ?? 0;
      cp.contested = a > 0 && b > 0;
      if (cp.contested || (a === 0 && b === 0)) continue;
      const team = a > 0 ? 0 : 1;
      const n = Math.max(a, b);
      const rate = 0.2 * Math.min(2, 1 + 0.35 * (n - 1)) * dt;
      const dir = team === 0 ? -1 : 1;
      const before = cp.prog;
      cp.prog = clamp(cp.prog + dir * rate, -1, 1);
      if (Math.sign(before) !== Math.sign(cp.prog) && before !== 0 && cp.owner !== -1) {
        cp.owner = -1;
        this.emit({ k: "ann", t: `Point ${"ABC"[i]} neutralized`, c: "objective" });
      }
      if (Math.abs(cp.prog) >= 1 && cp.owner !== team) {
        cp.owner = team;
        for (const p of this.players.values())
          if (p.team === team && p.st.alive && distXZ(p.st, cp) < 5) {
            p.stats.captures++;
            this.medal(p, "capture");
          }
        this.emit({ k: "ann", t: `Point ${"ABC"[i]} captured`, c: "objective", tm: team });
        this.emit({ k: "ann", t: `Point ${"ABC"[i]} lost`, c: "warn", tm: 1 - team });
      }
    }
    if (t >= this.domTickAt) {
      this.domTickAt = t + 1;
      for (let i = 0; i < this.points.length; i++) {
        const cp = this.points[i]!;
        if (cp.owner >= 0) this.teamScores[cp.owner] = (this.teamScores[cp.owner] ?? 0) + (i === this.overclocked ? 2 : 1);
      }
    }
  }

  private updatePayload(dt: number): void {
    const tr = this.track!;
    const c = this.cart;
    const at = trackPoint(tr, c.d);
    const escorts: MatchPlayer[] = [];
    let def = 0;
    for (const p of this.players.values()) {
      if (!p.st.alive || p.st.downed) continue;
      if (distXZ(p.st, at) > PAYLOAD_RADIUS || Math.abs(p.st.y - at.y) > 3) continue;
      if (p.team === 0) escorts.push(p);
      else def++;
    }
    c.att = escorts.length;
    c.def = def;
    if (escorts.length > 0) c.idleT = 0;
    else c.idleT += dt;
    const floor = tr.checkpoints[c.reached - 1] ?? 0;
    if (escorts.length > 0 && def === 0) {
      c.state = 1;
      const before = c.d;
      c.d = Math.min(tr.length, c.d + PAYLOAD_SPEED * Math.min(1.45, 1 + 0.15 * (escorts.length - 1)) * dt);
      // Escort score: 10 per metre pushed.
      if (Math.floor(c.d) > Math.floor(before)) for (const p of escorts) p.stats.score += 10;
      while (c.reached < tr.checkpoints.length && c.d >= tr.checkpoints[c.reached]!) {
        c.reached++;
        this.timeBonus += PAYLOAD_CHECKPOINT_BONUS;
        for (const p of escorts) {
          p.stats.captures++;
          this.medal(p, "checkpoint");
        }
        this.emit({ k: "ann", t: `Checkpoint ${c.reached} reached — +${PAYLOAD_CHECKPOINT_BONUS}s`, c: "objective", tm: 0 });
        this.emit({ k: "ann", t: `Checkpoint ${c.reached} lost — attackers gain ${PAYLOAD_CHECKPOINT_BONUS}s`, c: "warn", tm: 1 });
      }
      if (c.d >= tr.length) for (const p of escorts) this.medal(p, "delivery");
    } else if (escorts.length > 0) {
      c.state = 2;
    } else if (c.idleT > PAYLOAD_ROLLBACK_DELAY && c.d > floor) {
      // Left alone: roll back, but never past the last checkpoint.
      c.state = 3;
      c.d = Math.max(floor, c.d - PAYLOAD_ROLLBACK * dt);
    } else c.state = 0;
    const pct = Math.floor((100 * c.d) / tr.length);
    this.teamScores[0] = pct;
    this.teamScores[1] = 100 - pct;
  }

  /** Current payload position (payload mode only). */
  payloadPos(): Vec3 | null {
    return this.track ? trackPoint(this.track, this.cart.d) : null;
  }

  /** Read-only view of the cart state (payload mode). */
  payloadState(): Readonly<{ d: number; reached: number; state: number; att: number; def: number; overtime: boolean }> {
    return this.cart;
  }

  private advanceZone(): void {
    const z = this.zone!;
    z.phase++;
    const ph = ZONE_PHASES[Math.min(z.phase, ZONE_PHASES.length - 1)]!;
    z.fromX = z.x;
    z.fromZ = z.z;
    z.fromR = z.r;
    let tx = z.x;
    let tz = z.z;
    for (let tries = 0; tries < 20; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(0, Math.max(0, Math.min(z.r, 200) - ph.r) * 0.8);
      tx = clamp(z.x + Math.cos(a) * d, -150, 150);
      tz = clamp(z.z + Math.sin(a) * d, -150, 150);
      if (!this.inWater(tx, tz)) break;
    }
    z.tx = tx;
    z.tz = tz;
    z.tr = ph.r;
    z.shrinking = false;
    z.nextAt = this.time + ph.wait;
    z.dps = ph.dps;
    if (z.phase > 0) this.emit({ k: "ann", t: "The storm is closing in — move to the safe zone", c: "storm" });
  }

  private updateZone(): void {
    const z = this.zone!;
    const ph = ZONE_PHASES[Math.min(z.phase, ZONE_PHASES.length - 1)]!;
    if (!z.shrinking && this.time >= z.nextAt) {
      z.shrinking = true;
      z.nextAt = this.time + ph.shrink;
      this.emit({ k: "ann", t: "Storm is shrinking!", c: "storm" });
    } else if (z.shrinking) {
      const k = clamp(1 - (z.nextAt - this.time) / ph.shrink, 0, 1);
      z.x = z.fromX + (z.tx - z.fromX) * k;
      z.z = z.fromZ + (z.tz - z.fromZ) * k;
      z.r = z.fromR + (z.tr - z.fromR) * k;
      if (k >= 1 && z.phase < ZONE_PHASES.length - 1) this.advanceZone();
    }
  }

  /** Where an idle bot should head (objectives, zone, loot). */
  botObjective(me: MatchPlayer): Vec3 | null {
    const st = me.st;
    if (this.track) {
      // Attackers ride with the cart; defenders hold the road ahead and
      // jump on the cart to contest it once it is being pushed.
      const c = this.cart;
      const spread = ((me.id % 5) - 2) * 1.1;
      const contest = me.team !== 0 && c.att > 0;
      const ahead = me.team === 0 ? 1 + (me.id % 3) : contest ? 0.5 + (me.id % 2) : 12 + (me.id % 4) * 4;
      const p = trackPoint(this.track, c.d + ahead);
      return { x: p.x + Math.cos(p.yaw) * spread, y: p.y, z: p.z - Math.sin(p.yaw) * spread };
    }
    if (this.cfg.mode === "dom" && this.points.length) {
      let best: ControlPoint | null = null;
      let bd = Infinity;
      for (const cp of this.points) {
        if (cp.owner === me.team && !cp.contested) continue;
        const d = distXZ(cp, st) + (me.id % 3) * 8;
        if (d < bd) {
          bd = d;
          best = cp;
        }
      }
      return best ? { x: best.x + ((me.id % 5) - 2), y: best.y, z: best.z + ((me.id % 3) - 1) } : null;
    }
    if (this.cache && distXZ(this.cache, st) < 45) return this.cache;
    if (this.isBR && this.zone) {
      const z = this.zone;
      const r = z.shrinking ? z.tr : z.r;
      const cx = z.shrinking ? z.tx : z.x;
      const cz = z.shrinking ? z.tz : z.z;
      if (Math.hypot(st.x - cx, st.z - cz) > r * 0.8) return { x: cx, y: 0, z: cz };
      // Loot: nearest weapon if unarmed, else nearby consumables.
      const needWeapon = !st.slots[0];
      let best: Pickup | null = null;
      let bd = needWeapon ? 80 : 25;
      for (const pk of this.pickups) {
        if (!pk.active) continue;
        if (needWeapon && pk.kind !== "weapon") continue;
        if (!needWeapon && pk.kind === "weapon") continue;
        // Bots navigate at street level; skip loot on rooftops and upper floors.
        if (Math.abs(pk.y - st.y) > 2.5) continue;
        const d = dist3(pk, st);
        if (d < bd) {
          bd = d;
          best = pk;
        }
      }
      return best;
    }
    // Hunt: drift toward the nearest enemy region.
    let near: MatchPlayer | null = null;
    let nd = Infinity;
    for (const o of this.players.values()) {
      if (o === me || !o.st.alive || (!this.isFFA && o.team === me.team)) continue;
      const d = distXZ(o.st, st);
      if (d < nd) {
        nd = d;
        near = o;
      }
    }
    if (near && this.cfg.mode !== "training" && (me.id + Math.floor(this.time / 10)) % 2 === 0) {
      return { x: near.st.x + ((me.id * 7) % 11) - 5, y: near.st.y, z: near.st.z + ((me.id * 3) % 9) - 4 };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // End conditions & results
  // -------------------------------------------------------------------------

  private checkEnd(): void {
    if (this.phase !== "live") return;
    const elapsed = this.time - this.liveStart;
    const timeUp = elapsed >= this.cfg.timeLimit + this.timeBonus;
    let winner = -2;
    let reason = "";
    switch (this.cfg.mode) {
      case "tdm":
      case "dom": {
        const i = this.teamScores.findIndex((s) => s >= this.cfg.scoreLimit);
        if (i >= 0) {
          winner = i;
          reason = "Score limit reached";
        } else if (timeUp) {
          const [a = 0, b = 0] = this.teamScores;
          winner = a === b ? -1 : a > b ? 0 : 1;
          reason = "Time limit reached";
        }
        break;
      }
      case "ffa": {
        const top = [...this.players.values()].find((p) => p.stats.kills >= this.cfg.scoreLimit);
        if (top) {
          winner = top.team;
          reason = "Elimination limit reached";
        } else if (timeUp) {
          const sorted = [...this.players.values()].sort((a, b) => b.stats.kills - a.stats.kills);
          winner = sorted.length > 1 && sorted[0]!.stats.kills === sorted[1]!.stats.kills ? -1 : sorted[0]?.team ?? -1;
          reason = "Time limit reached";
        }
        break;
      }
      case "gungame": {
        const top = [...this.players.values()].find((p) => p.gunTier >= GUN_LADDER.length);
        if (top) {
          winner = top.team;
          reason = "Final weapon kill";
        } else if (timeUp) {
          const sorted = [...this.players.values()].sort((a, b) => b.gunTier - a.gunTier || b.stats.kills - a.stats.kills);
          winner = sorted.length > 1 && sorted[0]!.gunTier === sorted[1]!.gunTier ? -1 : sorted[0]?.team ?? -1;
          reason = "Time limit reached";
        }
        break;
      }
      case "br": {
        const alive = new Set([...this.players.values()].filter((p) => p.st.alive).map((p) => p.team));
        const total = new Set([...this.players.values()].map((p) => p.team));
        if (total.size >= 2 && alive.size <= 1) {
          winner = alive.size === 1 ? [...alive][0]! : -1;
          reason = winner >= 0 ? "Last squad standing" : "No survivors";
        } else if (total.size < 2 && this.time - this.liveStart > 5 && alive.size <= 1 && this.players.size > 0) {
          winner = alive.size === 1 ? [...alive][0]! : -1;
          reason = "Opponents left the match";
        } else if (timeUp) {
          winner = -1;
          reason = "Time limit reached";
        }
        break;
      }
      case "payload": {
        const c = this.cart;
        if (this.track && c.d >= this.track.length) {
          winner = 0;
          reason = "Payload delivered";
        } else if (timeUp) {
          // Overtime while attackers stay on the cart (capped at 60 s).
          if (c.att > 0 && elapsed < this.cfg.timeLimit + this.timeBonus + 60) {
            if (!c.overtime) {
              c.overtime = true;
              this.emit({ k: "ann", t: "OVERTIME — keep the payload moving", c: "warn" });
            }
          } else {
            winner = 1;
            reason = "Defenders held the line";
          }
        }
        break;
      }
      case "training":
        if (timeUp) {
          winner = -1;
          reason = "Session over";
        }
        break;
    }
    if (winner !== -2) this.end(winner, reason);
  }

  /** Ends the match immediately (also used when everyone leaves). */
  end(winnerTeam: number, reason: string): void {
    if (this.phase === "ended") return;
    this.phase = "ended";
    for (const p of this.players.values()) if (this.isBR && p.team === winnerTeam) p.placement = 1;
    const rows: ResultRow[] = [...this.players.values()].map((p) => {
      const fav = Object.entries(p.stats.weaponKills).sort((a, b) => b[1] - a[1])[0];
      return {
        id: p.id, name: p.name, bot: p.isBot, team: p.team, kills: p.stats.kills, deaths: p.stats.deaths, assists: p.stats.assists,
        damage: Math.round(p.stats.damage), score: p.stats.score, shots: p.stats.shots, hits: p.stats.hits, headshots: p.stats.headshots,
        bestStreak: p.stats.bestStreak, placement: p.placement, medals: { ...p.stats.medals },
        favWeapon: fav && fav[0] in WEAPONS ? fav[0] : null,
      };
    });
    rows.sort((a, b) => (this.isBR ? (a.placement || 99) - (b.placement || 99) : 0) || b.score - a.score || b.kills - a.kills);
    const mvp = [...rows].sort((a, b) => b.score - a.score)[0]?.id ?? -1;
    this.results = {
      mode: this.cfg.mode, arena: this.cfg.arena, duration: Math.round(this.time - this.liveStart), winnerTeam,
      teamScores: [...this.teamScores], rows, mvp, reason,
    };
    this.emit({ k: "ann", t: "MATCH OVER", c: "end" });
    this.onEnd?.(this.results);
  }

  // -------------------------------------------------------------------------
  // Events & snapshots
  // -------------------------------------------------------------------------

  private emit(e: Ev): void {
    this.events.push(e);
  }

  /** Call after building all snapshots for this tick. */
  clearEvents(): void {
    this.events.length = 0;
  }

  timeLeft(): number {
    if (this.phase === "starting") return Math.max(0, this.phaseEnd - this.time);
    return Math.max(0, this.cfg.timeLimit + this.timeBonus - (this.time - this.liveStart));
  }

  matchState(): Snapshot["m"] {
    const m: Snapshot["m"] = { ph: this.phase, tl: Math.round(this.timeLeft() * 10) / 10, sc: this.isFFA ? [] : [...this.teamScores] };
    if (this.points.length) m.cp = this.points.map((c, i): CPSnap => ({ o: c.owner, p: r2(c.prog), c: c.contested, oc: i === this.overclocked }));
    if (this.zone) {
      const z = this.zone;
      m.zn = { x: r2(z.x), z: r2(z.z), r: r2(z.r), tx: r2(z.tx), tz: r2(z.tz), tr: r2(z.tr), n: Math.max(0, Math.round(z.nextAt - this.time)), s: z.shrinking, dps: z.dps };
      m.al = new Set([...this.players.values()].filter((p) => p.st.alive).map((p) => p.team)).size;
    }
    if (this.track) {
      const c = this.cart;
      const p = trackPoint(this.track, c.d);
      const pl: PayloadSnap = {
        x: r2(p.x), y: r2(p.y), z: r2(p.z), yw: r3(p.yaw), p: r3(c.d / this.track.length), r: c.reached, s: c.state, n: c.att, ot: c.overtime,
      };
      m.pl = pl;
    }
    m.dc = this.cache ? [r2(this.cache.x), r2(this.cache.y), r2(this.cache.z)] : null;
    if (this.stormUntil > this.time) m.storm = Math.round(this.stormUntil - this.time);
    return m;
  }

  scoreRows(): ScoreRow[] {
    return [...this.players.values()].map((p) => ({
      i: p.id, k: p.stats.kills, d: p.stats.deaths, a: p.stats.assists, s: p.stats.score, st: p.stats.streak, pl: p.placement, c: p.connected || p.isBot,
      ...(this.isGunGame ? { gt: Math.min(p.gunTier, GUN_LADDER.length - 1) } : {}),
    }));
  }

  /** Builds the per-player snapshot with interest management. */
  snapshotFor(id: number, withScores: boolean): Snapshot {
    const me = this.players.get(id);
    let view: MatchPlayer | undefined = me;
    let spec: number | undefined;
    if (me && !me.st.alive && this.isBR && me.eliminated) {
      const mate = [...this.players.values()].find((p) => p.team === me.team && p.st.alive);
      const killer = me.lastKilledBy >= 0 ? this.players.get(me.lastKilledBy) : undefined;
      view = mate ?? (killer?.st.alive ? killer : undefined) ?? me;
      if (view !== me) spec = view.id;
    }
    const center = view ? view.st : { x: 0, y: 0, z: 0 };
    const team = me?.team ?? -1;
    const ps: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      if (p.id === id) continue;
      const mate = !this.isFFA && p.team === team;
      const revealed = this.isRevealedTo(p, team);
      if (!mate && !revealed && p.id !== spec && distXZ(p.st, center) > INTEREST_RADIUS) continue;
      const s = p.st;
      let f = 0;
      if (s.alive) f |= PF.ALIVE;
      if (s.crouched) f |= PF.CROUCH;
      if (s.downed) f |= PF.DOWNED;
      if (s.ads > 0.5) f |= PF.ADS;
      if (s.sprinting) f |= PF.SPRINT;
      if (revealed) f |= PF.REVEALED;
      if (s.spawnProt > 0) f |= PF.PROTECTED;
      if (s.onGround) f |= PF.GROUND;
      if (s.reloadT > 0) f |= PF.RELOAD;
      if (s.gliding) f |= PF.GLIDE;
      if (s.slideT > 0) f |= PF.SLIDE;
      if (p.isBot) f |= PF.BOT;
      const w = activeWeapon(s);
      const snap: PlayerSnap = { i: p.id, x: r2(s.x), y: r2(s.y), z: r2(s.z), yw: r3(s.yaw), pt: r3(s.pitch), f, w: w ? Object.keys(WEAPONS).indexOf(w.id) : -1 };
      if (mate || p.id === spec) {
        snap.h = Math.round(s.health);
        snap.a = Math.round(s.armor);
      }
      ps.push(snap);
    }
    const near = (o: Vec3, r: number) => distXZ(o, center) < r;
    const pr: ProjSnap[] = this.projectiles.filter((p) => near(p, INTEREST_RADIUS)).map((p) => ({ i: p.id, k: p.kind, x: r2(p.x), y: r2(p.y), z: r2(p.z), o: p.owner }));
    const dp: DeploySnap[] = this.deployables
      .filter((d) => near(d, INTEREST_RADIUS))
      .map((d) => ({ i: d.id, k: d.kind, x: r2(d.x), y: r2(d.y), z: r2(d.z), ax: d.ax, tm: d.team, armed: d.kind !== "mine" || this.time - d.t > MINE.arm }));
    const sm: SmokeSnap[] = this.smokes.map((s) => ({ i: s.id, x: r2(s.x), y: r2(s.y), z: r2(s.z), r: s.r, t: r2(s.until - this.time) }));
    const pk: PickupSnap[] = this.pickups
      .filter((p) => p.active && near(p, PICKUP_INTEREST_RADIUS))
      .map((p) => ({ i: p.id, k: p.kind, w: p.weapon, x: r2(p.x), y: r2(p.y), z: r2(p.z) }));
    const br = this.barrels.filter((b) => !b.alive).map((b) => b.id);
    const cr = this.crates.filter((c) => !c.alive).map((c) => c.id);
    const ev = this.events.filter((e) => {
      if ("to" in e) return e.to === id;
      if ((e.k === "ann" || e.k === "scan") && e.tm !== undefined) return e.tm === team;
      return true;
    });
    const snap: Snapshot = {
      t: Math.round(this.time * 1000) / 1000, tick: this.tick, ack: me?.lastSeq ?? -1, me: me ? me.st : null,
      ps, pr, dp, sm, pk, br, cr, m: this.matchState(), ev,
    };
    if (spec !== undefined) snap.spec = spec;
    if (withScores) snap.sb = this.scoreRows();
    return snap;
  }

  /** Crate ids/positions for clients (static list, broken state via snapshot). */
  crateList(): { i: number; x: number; y: number; z: number }[] {
    return this.crates.map((c) => ({ i: c.id, x: c.x, y: c.y, z: c.z }));
  }

  /** Barrel ids/positions for clients (static list, alive state via snapshot). */
  barrelList(): { i: number; x: number; y: number; z: number }[] {
    return this.barrels.map((b) => ({ i: b.id, x: b.x, y: b.y, z: b.z }));
  }
}
