import { Btn, MAX_HEALTH } from "../constants";
import { angleDiff, clamp, distXZ } from "../math";
import type { Vec3 } from "../math";
import { Rng } from "../rng";
import { WEAPONS } from "../balance/weapons";
import { eyePos } from "../sim/player";
import type { PlayerInput, Difficulty } from "../types";
import type { Match, MatchPlayer } from "../sim/match";
import type { NavPoint } from "./nav";

interface Skill {
  reaction: number;
  aimError: number; // degrees
  turnRate: number; // rad/s
  viewRange: number;
  fov: number; // degrees (full cone)
  headChance: number;
  strafe: number;
  burst: number; // max consecutive auto shots before a pause
  grenades: boolean;
  tactics: boolean;
}

const SKILLS: Record<Difficulty, Skill> = {
  rookie: { reaction: 0.7, aimError: 7, turnRate: 3.2, viewRange: 45, fov: 100, headChance: 0.05, strafe: 0.25, burst: 14, grenades: false, tactics: false },
  standard: { reaction: 0.42, aimError: 4, turnRate: 5.5, viewRange: 65, fov: 110, headChance: 0.15, strafe: 0.55, burst: 9, grenades: true, tactics: false },
  veteran: { reaction: 0.27, aimError: 2.4, turnRate: 8.5, viewRange: 85, fov: 120, headChance: 0.3, strafe: 0.8, burst: 7, grenades: true, tactics: true },
  elite: { reaction: 0.17, aimError: 1.3, turnRate: 13, viewRange: 110, fov: 130, headChance: 0.45, strafe: 1, burst: 6, grenades: true, tactics: true },
};

type BotState = "roam" | "engage" | "cover" | "revive";

/**
 * Practice/fill AI. Perceives the world with limited FOV, range, hearing and
 * line of sight (including smoke and flashbangs), then produces ordinary
 * PlayerInput — bots obey exactly the same movement and weapon rules.
 */
export class BotBrain {
  readonly skill: Skill;
  private rng: Rng;
  private seq = 0;
  private state: BotState = "roam";
  private target = -1;
  private seenT = 0;
  private lastKnown: Vec3 | null = null;
  private lostT = 0;
  private path: NavPoint[] = [];
  private pathI = 0;
  private goal: Vec3 | null = null;
  private repathT = 0;
  private thinkT = 0;
  private stuckT = 0;
  private lastPos: Vec3 = { x: 0, y: 0, z: 0 };
  private strafeDir = 1;
  private strafeT = 0;
  private yaw = 0;
  private pitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private errT = 0;
  private shotsInBurst = 0;
  private burstPause = 0;
  private aimHead = false;
  private nadeT = 8;
  private crouchT = 0;
  private jumpT = 0;
  private wantHeal = false;
  readonly passive: boolean;

  constructor(seed: number, readonly difficulty: Difficulty, passive = false) {
    this.skill = SKILLS[difficulty];
    this.rng = new Rng(seed);
    this.passive = passive;
  }

  reset(yaw: number): void {
    this.state = "roam";
    this.target = -1;
    this.lastKnown = null;
    this.path = [];
    this.goal = null;
    this.yaw = yaw;
    this.pitch = 0;
  }

  think(m: Match, me: MatchPlayer, dt: number): PlayerInput {
    const st = me.st;
    const inp: PlayerInput = { seq: ++this.seq, mx: 0, mz: 0, yaw: this.yaw, pitch: this.pitch, b: 0, vt: m.time };
    if (!st.alive) return inp;
    const sk = this.skill;
    const eye = eyePos(st);

    this.thinkT -= dt;
    this.nadeT -= dt;
    this.errT -= dt;
    this.strafeT -= dt;
    this.repathT -= dt;
    this.crouchT -= dt;
    this.jumpT -= dt;

    // ---- Perception (throttled) ----------------------------------------
    if (this.thinkT <= 0) {
      this.thinkT = 0.12 + this.rng.next() * 0.06;
      this.perceive(m, me, eye);
    }

    // ---- Decide --------------------------------------------------------
    const tgt = this.target >= 0 ? m.players.get(this.target) : undefined;
    const visible = !!tgt && tgt.st.alive && this.seenT > 0 && !this.passive;
    const slot = st.slots[st.active];
    const def = slot ? WEAPONS[slot.id] : null;

    if (st.downed) {
      // Crawl toward the nearest teammate.
      const mate = [...m.players.values()].find((p) => p.team === me.team && p !== me && p.st.alive && !p.st.downed);
      if (mate) this.moveToward(inp, st, mate.st, 1);
      return this.finish(inp, st, dt);
    }

    if (!visible && st.health < 60 && st.injectors > 0 && !st.chan) this.wantHeal = true;
    if (this.wantHeal && !visible) {
      if (st.chan === "" && st.injectors > 0 && st.health < MAX_HEALTH) inp.b |= Btn.HEAL;
      if (st.health >= 90 || st.injectors === 0) this.wantHeal = false;
    } else if (!visible && st.armor < 40 && st.plates > 0 && st.chan === "") {
      inp.b |= Btn.PLATE;
    }

    // Weapon management: swap away from an empty gun, reload when calm.
    if (slot && slot.mag === 0 && slot.reserve === 0) {
      const alt = st.slots.findIndex((s, i) => s && i !== st.active && (s.mag > 0 || s.reserve > 0));
      if (alt >= 0) inp.b |= alt === 0 ? Btn.SLOT1 : alt === 1 ? Btn.SLOT2 : Btn.SLOT3;
    } else if (!visible && slot && def && slot.mag < def.mag * 0.5 && slot.reserve > 0 && st.reloadT <= 0) {
      inp.b |= Btn.RELOAD;
    }

    if (visible && tgt) {
      this.state = st.health < 35 && sk.tactics ? "cover" : "engage";
      this.engage(m, me, tgt, inp, dt);
    } else {
      // Revive downed squadmates when no enemy is visible.
      const downed = [...m.players.values()].find(
        (p) => p.team === me.team && p !== me && p.st.alive && p.st.downed && distXZ(p.st, st) < 30,
      );
      if (downed) {
        this.state = "revive";
        const d = distXZ(downed.st, st);
        if (d > 1.6) this.navigate(m, me, inp, downed.st);
        else {
          inp.b |= Btn.USE;
          this.lookAt(downed.st.x, downed.st.y + 0.3, downed.st.z, eye, dt * 2);
        }
      } else {
        this.state = "roam";
        this.roam(m, me, inp, dt);
      }
    }

    // Tactical usage.
    if (sk.tactics && !this.passive && st.tacCd <= 0) {
      if (st.tactical === "recon" && this.state === "roam" && this.rng.next() < 0.01) inp.b |= Btn.TACTICAL;
      if (st.tactical === "shield" && visible && st.health < 60) inp.b |= Btn.TACTICAL;
      if (st.tactical === "mine" && this.state === "roam" && this.rng.next() < 0.004) inp.b |= Btn.TACTICAL;
    }
    return this.finish(inp, st, dt);
  }

  private finish(inp: PlayerInput, st: MatchPlayer["st"], dt: number): PlayerInput {
    // Stuck detection: if we wanted to move but did not, jump / repath.
    const moved = Math.hypot(st.x - this.lastPos.x, st.z - this.lastPos.z);
    const wants = Math.abs(inp.mx) + Math.abs(inp.mz) > 0.2;
    if (wants && moved < 0.6 * dt) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.45) {
      inp.b |= Btn.JUMP;
      if (this.stuckT > 1.4) {
        this.path = [];
        this.goal = null;
        this.strafeDir *= -1;
        this.stuckT = 0;
      }
    }
    this.lastPos = { x: st.x, y: st.y, z: st.z };
    inp.yaw = this.yaw;
    inp.pitch = this.pitch;
    return inp;
  }

  private perceive(m: Match, me: MatchPlayer, eye: Vec3): void {
    const st = me.st;
    const sk = this.skill;
    if (st.flash > 0.4) {
      this.seenT = 0;
      return;
    }
    let best = -1;
    let bestScore = Infinity;
    const fovCos = Math.cos(((sk.fov / 2) * Math.PI) / 180);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    for (const p of m.players.values()) {
      if (p === me || !p.st.alive || p.team === me.team) continue;
      const dx = p.st.x - st.x;
      const dz = p.st.z - st.z;
      const dist = Math.hypot(dx, dz);
      const revealed = m.isRevealedTo(p, me.team);
      if (dist > sk.viewRange && !revealed) continue;
      const facing = (dx * fx + dz * fz) / (dist || 1);
      const inFov = facing > fovCos || dist < 5 || revealed || (p.id === this.target && this.seenT > 0);
      if (!inFov) continue;
      const head = { x: p.st.x, y: p.st.y + (p.st.crouched ? 1.0 : 1.55), z: p.st.z };
      const chest = { x: p.st.x, y: p.st.y + (p.st.crouched ? 0.7 : 1.1), z: p.st.z };
      const los = (m.world.lineOfSight(eye, head) || m.world.lineOfSight(eye, chest)) && !m.smokeBlocks(eye, chest);
      if (!los) continue;
      const score = dist - (p.id === this.target ? 15 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = p.id;
      }
    }
    if (best >= 0) {
      if (best !== this.target) {
        this.target = best;
        // Reaction delay before reliable firing.
        this.seenT = 0.0001;
        this.reactT = sk.reaction * (0.8 + this.rng.next() * 0.5);
        this.aimHead = this.rng.next() < sk.headChance;
      } else this.seenT += 0.15;
      const p = m.players.get(best)!;
      this.lastKnown = { x: p.st.x, y: p.st.y, z: p.st.z };
      this.lostT = 0;
    } else {
      this.seenT = 0;
      this.lostT += 0.15;
      if (this.lostT > 6) {
        this.target = -1;
        this.lastKnown = null;
      }
      // Hearing: recent gunfire within 45 m reveals a position.
      if (!this.lastKnown) {
        for (const s of m.recentShots) {
          if (m.time - s.t > 1.2) continue;
          const shooter = m.players.get(s.p);
          if (!shooter || shooter.team === me.team || shooter === me) continue;
          if (Math.hypot(s.x - st.x, s.z - st.z) < 45) {
            this.lastKnown = { x: s.x, y: s.y, z: s.z };
            this.path = [];
            break;
          }
        }
      }
    }
  }

  private reactT = 0;

  private engage(m: Match, me: MatchPlayer, tgt: MatchPlayer, inp: PlayerInput, dt: number): void {
    const st = me.st;
    const sk = this.skill;
    const eye = eyePos(st);
    const slot = st.slots[st.active];
    const def = slot ? WEAPONS[slot.id] : null;
    const dist = distXZ(st, tgt.st);
    this.reactT -= dt;

    // Aim error re-rolls periodically and grows with target speed.
    if (this.errT <= 0) {
      this.errT = 0.35 + this.rng.next() * 0.4;
      const speed = Math.hypot(tgt.st.vx, tgt.st.vz);
      const mag = (sk.aimError * (1 + speed / 8) * Math.PI) / 180;
      this.errYaw = (this.rng.next() * 2 - 1) * mag;
      this.errPitch = (this.rng.next() * 2 - 1) * mag * 0.6;
    }
    const aimY = tgt.st.y + (this.aimHead ? (tgt.st.crouched ? 1.0 : 1.58) : tgt.st.crouched ? 0.65 : 1.1);
    // Lead slightly for moving targets.
    const lead = 0.06;
    this.lookAt(tgt.st.x + tgt.st.vx * lead, aimY, tgt.st.z + tgt.st.vz * lead, eye, dt, this.errYaw, this.errPitch);

    // Preferred range per weapon.
    let ideal = 18;
    if (def) {
      if (def.id === "breachmaker" || def.id === "viper") ideal = 7;
      else if (def.id === "longshot" || def.id === "railspike") ideal = 40;
      else if (def.id === "arcstorm") ideal = 14;
      else if (def.id === "nova") ideal = 22;
    }
    if (this.state === "cover") ideal = 30;
    const toT = { x: tgt.st.x - st.x, z: tgt.st.z - st.z };
    const len = Math.hypot(toT.x, toT.z) || 1;
    toT.x /= len;
    toT.z /= len;
    // Payload: fight on the move back to the cart (or the defensive line).
    const obj = m.isPayload ? m.botObjective(me) : null;
    if (obj && distXZ(obj, st) > (me.team === 0 ? 4 : 8)) {
      this.navigate(m, me, inp, obj);
      inp.b &= ~Btn.SPRINT;
    } else {
      let wx = 0;
      let wz = 0;
      if (dist > ideal + 6) {
        wx += toT.x;
        wz += toT.z;
      } else if (dist < ideal - 5) {
        wx -= toT.x;
        wz -= toT.z;
      }
      if (this.strafeT <= 0) {
        this.strafeT = 0.5 + this.rng.next() * 1.1;
        if (this.rng.next() < 0.6) this.strafeDir *= -1;
      }
      wx += -toT.z * this.strafeDir * sk.strafe;
      wz += toT.x * this.strafeDir * sk.strafe;
      this.applyMove(inp, wx, wz);
    }

    if (sk.tactics && this.crouchT <= 0 && this.rng.next() < 0.01) this.crouchT = 0.8;
    if (this.crouchT > 0) inp.b |= Btn.CROUCH;
    if (this.skill.strafe >= 0.8 && this.jumpT <= 0 && this.rng.next() < 0.004) {
      inp.b |= Btn.JUMP;
      this.jumpT = 2;
    }

    // Fire control.
    const yawErr = Math.abs(angleDiff(this.yaw, Math.atan2(-(tgt.st.x - eye.x), -(tgt.st.z - eye.z))));
    const tol = Math.max(0.06, Math.atan2(0.8, dist));
    const inRange = !def || dist <= def.maxRange * 0.95;
    if (def && dist > 16 && def.id !== "breachmaker") inp.b |= Btn.ADS;
    if (this.reactT <= 0 && yawErr < tol + 0.08 && inRange && slot && slot.mag > 0 && st.reloadT <= 0) {
      if (this.burstPause > 0) this.burstPause -= dt;
      else if (def && def.fireMode === "auto") {
        inp.b |= Btn.FIRE;
        this.shotsInBurst++;
        if (this.shotsInBurst > sk.burst * 2) {
          this.shotsInBurst = 0;
          this.burstPause = 0.18 + this.rng.next() * 0.25;
        }
      } else if (st.fireCd <= 0 && st.burstLeft === 0) {
        // Semi-auto: press on alternating steps so edges register.
        if (!(st.prevB & Btn.FIRE)) inp.b |= Btn.FIRE;
      }
    }

    // Grenade at targets hiding behind cover at medium range.
    if (sk.grenades && this.nadeT <= 0 && dist > 9 && dist < 24 && st.nades.frag > 0 && this.rng.next() < 0.02) {
      this.nadeT = 10 + this.rng.next() * 8;
      if (st.nadeSel !== "frag") inp.b |= Btn.CYCLE_NADE;
      else inp.b |= Btn.GRENADE;
    }
  }

  private roam(m: Match, me: MatchPlayer, inp: PlayerInput, dt: number): void {
    const st = me.st;
    const eye = eyePos(st);
    let dest: Vec3 | null = null;
    const obj = m.botObjective(me);
    // Payload: never wander off chasing sounds while far from the cart.
    const tethered = !!obj && m.isPayload && distXZ(obj, st) > 12;
    if (this.lastKnown && !this.passive && !tethered) dest = this.lastKnown;
    if (!dest) dest = obj;
    if (!dest) {
      if (!this.goal || distXZ(this.goal, st) < 3) {
        const k = m.nav ? m.nav.randomCell(this.rng, st, 40) : -1;
        this.goal = k >= 0 && m.nav ? m.nav.center(k) : null;
        this.path = [];
      }
      dest = this.goal;
    }
    if (dest) {
      if (this.lastKnown && distXZ(dest, st) < 3) this.lastKnown = null;
      this.navigate(m, me, inp, dest, true);
    }
    if (inp.mx === 0 && inp.mz === 0) {
      // Idle scan.
      this.yaw += dt * 0.8 * this.strafeDir;
    }
    this.pitch += (0 - this.pitch) * Math.min(1, dt * 3);
    void eye;
  }

  private navigate(m: Match, me: MatchPlayer, inp: PlayerInput, dest: Vec3, faceTravel = false): void {
    const st = me.st;
    // While gliding in (or without a nav grid) just steer straight at the goal.
    if (!m.nav || st.gliding) {
      this.moveToward(inp, st, dest, 1);
      return;
    }
    // Re-path when the goal moves, the timer expires or the path runs out — but
    // never more than twice a second, so unreachable goals can't trigger an A*
    // search every tick.
    const goalMoved = !this.goal || distXZ(this.goal, dest) > 4;
    const finished = this.pathI >= this.path.length && distXZ(dest, st) > 2;
    const sincePath = 3.5 - this.repathT;
    if ((goalMoved || finished) ? sincePath > 0.5 : this.repathT <= 0) {
      this.goal = { ...dest };
      this.repathT = 2.5 + this.rng.next();
      const path = m.nav.path(st, dest);
      this.path = path ?? [];
      this.pathI = 0;
      if (!path) this.repathT = 1.5; // unreachable for now: head straight there, retry later
    }
    let wp = this.path[this.pathI];
    while (wp && distXZ(wp, st) < (wp.door ? 0.45 : 1.2)) {
      this.pathI++;
      wp = this.path[this.pathI];
    }
    const target = wp ?? dest;
    this.moveToward(inp, st, target, 1);
    if (faceTravel) {
      const want = Math.atan2(-(target.x - st.x), -(target.z - st.z));
      this.yaw += clamp(angleDiff(this.yaw, want), -this.skill.turnRate * 0.02, this.skill.turnRate * 0.02);
    }
    // Sprint on long open stretches.
    if (distXZ(dest, st) > 12 && inp.mz > 0.7) inp.b |= Btn.SPRINT;
    if (target.y - st.y > 0.6 && distXZ(target, st) < 2) inp.b |= Btn.JUMP;
  }

  private moveToward(inp: PlayerInput, st: MatchPlayer["st"], to: Vec3, k: number): void {
    const dx = to.x - st.x;
    const dz = to.z - st.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.3) return;
    this.applyMove(inp, (dx / l) * k, (dz / l) * k);
  }

  /** Converts a desired world-space direction into local strafe/forward axes. */
  private applyMove(inp: PlayerInput, wx: number, wz: number): void {
    const l = Math.hypot(wx, wz);
    if (l < 1e-3) return;
    wx /= Math.max(1, l);
    wz /= Math.max(1, l);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    inp.mz = clamp(wx * -sy + wz * -cy, -1, 1);
    inp.mx = clamp(wx * cy + wz * -sy, -1, 1);
  }

  private lookAt(x: number, y: number, z: number, eye: Vec3, dt: number, ey = 0, ep = 0): void {
    const wantYaw = Math.atan2(-(x - eye.x), -(z - eye.z)) + ey;
    const wantPitch = Math.atan2(y - eye.y, Math.hypot(x - eye.x, z - eye.z)) + ep;
    const r = this.skill.turnRate * dt;
    this.yaw += clamp(angleDiff(this.yaw, wantYaw), -r, r);
    this.pitch += clamp(wantPitch - this.pitch, -r, r);
    this.pitch = clamp(this.pitch, -1.4, 1.4);
  }
}

const BOT_NAMES = [
  "Kestrel", "Vanta", "Mako", "Juno", "Cinder", "Rook", "Halcyon", "Ember", "Quill", "Talon", "Nyx", "Sable",
  "Orion", "Wisp", "Fable", "Haze", "Ivo", "Lumen", "Rune", "Zephyr", "Brisk", "Coda", "Dax", "Echo",
];

/** Bot names always carry the "BOT" prefix (humans cannot register it). */
export function botName(i: number): string {
  return `BOT ${BOT_NAMES[i % BOT_NAMES.length]}${i >= BOT_NAMES.length ? Math.floor(i / BOT_NAMES.length) + 1 : ""}`;
}
