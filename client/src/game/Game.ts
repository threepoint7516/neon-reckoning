import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import {
  Btn, CROUCH_EYE_HEIGHT, CollisionWorld, EYE_HEIGHT, STEP_HEIGHT, GRENADES, GRENADE_IDS, INTERP_DELAY, MAX_ARMOR, NavGrid, PF, SIM_DT, TACTICALS, WEAPONS,
  activeWeapon, buildPayloadTrack, clonePlayer, getFrontierMap, rayAABB, stepPlayer, MODE_INFO,
  ASSIST_SCORE, GUN_LADDER, HEADSHOT_BONUS, KILL_SCORE, MEDAL_SCORES, isSoloMode,
} from "@neon/shared";
import type {
  GameEvent, Loadout, MatchConfig, MatchResults, MatchStartInfo, MatchStateSnap, PlayerInput, PlayerSnap, PlayerState, RosterEntry,
  ScoreRow, ServerMessage, SimHooks, Snapshot, StepEnv, WeaponDef, District, PayloadTrack,
} from "@neon/shared";
import type { Connection } from "../net/connection";
import { audio } from "../audio/audio";
import { settingsStore } from "../state/settings";
import type { Settings } from "../state/settings";
import { onChallengeComplete, trackEvent } from "../state/session";
import { progress, xpToNext } from "../state/progress";
import { Input } from "./input";
import { buildWorld, makeEnvMap } from "./render/world";
import { DayNight, NIGHT_TOD } from "./render/sky";
import type { Lighting } from "./render/sky";
import type { WorldView } from "./render/world";
import { Effects } from "./render/effects";
import { EntityView } from "./render/entities";
import { Avatar } from "./render/avatars";
import { ViewModel } from "./render/viewmodel";
import { MEDAL_NAMES, emptyHud } from "./hud";
import type { HudData, Marker } from "./hud";

interface Remote {
  id: number;
  snaps: { t: number; s: PlayerSnap }[];
  avatar: Avatar | null;
  lastSeen: number;
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  speed: number;
  stepAcc: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: number;
  hp?: number;
  ar?: number;
}

const DEG = Math.PI / 180;
const hexStr = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.5 }, uHurt: { value: 0 }, uAberr: { value: 0.0015 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmount; uniform float uHurt; uniform float uAberr; varying vec2 vUv;
    void main(){
      vec2 d = vUv-0.5;
      float r2 = dot(d,d);
      vec2 off = d*uAberr*(1.0+uHurt*4.0);
      vec4 c;
      c.r = texture2D(tDiffuse, vUv+off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv-off).b;
      c.a = 1.0;
      float v = smoothstep(0.75, 0.15, r2*uAmount*2.2);
      c.rgb *= mix(1.0, v, 0.85);
      c.rgb = mix(c.rgb, vec3(0.7,0.0,0.08), uHurt*smoothstep(0.05,0.4,r2));
      gl_FragColor = c;
    }`,
};

export interface GameCallbacks {
  onEnd(results: MatchResults): void;
  onPauseChange(paused: boolean): void;
  onDisconnected(msg: string): void;
}

/**
 * Client game runtime: renders the world, predicts the local player with
 * the shared simulation, reconciles against authoritative snapshots and
 * interpolates everyone else.
 */
export class Game {
  readonly hud: HudData = emptyHud();
  readonly cfg: MatchConfig;
  readonly myId: number;
  readonly offline: boolean;
  readonly district: District | null;
  /** Payload track, derived locally with the same deterministic code as the server. */
  readonly track: PayloadTrack | null;
  roster = new Map<number, RosterEntry>();
  scores: ScoreRow[] = [];
  match: MatchStateSnap | null = null;
  paused = false;
  scoreboardOpen = false;
  mapOpen = false;
  ended = false;
  results: MatchResults | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private vignette: ShaderPass | null = null;
  private world: WorldView;
  private collision: CollisionWorld;
  private effects: Effects;
  private entities: EntityView;
  private viewmodel: ViewModel;
  private input: Input;
  private env: StepEnv;
  private hooks: SimHooks;
  private replaying = false;
  private me: PlayerState | null = null;
  private prevPos = new THREE.Vector3();
  private smoothErr = new THREE.Vector3();
  private pending: PlayerInput[] = [];
  private outbox: PlayerInput[] = [];
  private seq = 0;
  private acc = 0;
  private camYaw = 0;
  private camPitch = 0;
  private recoilDebt = 0;
  private sprayT = 1;
  private eyeH = EYE_HEIGHT;
  private shake = 0;
  private landDip = 0;
  /** View offset that eases out stair steps and curbs (see updateCamera). */
  private stepSmooth = 0;
  private lastViewY: number | null = null;
  private wasGrounded = false;
  private timeOffset = 0;
  private haveTime = false;
  private remotes = new Map<number, Remote>();
  private raf = 0;
  private lastFrame = 0;
  private time = 0;
  private stepDist = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private hurt = 0;
  private wasAlive = false;
  private spec: number | undefined;
  private killerPos: THREE.Vector3 | null = null;
  private unsub: (() => void)[] = [];
  private nextId = 1;
  private lastAmbient = 0;
  private disposed = false;
  private lastSnapAt = performance.now();
  private training: Record<string, boolean> | null = null;
  private trainStart: THREE.Vector3 | null = null;
  private envMap: THREE.Texture;
  private dayNight: DayNight;
  private light: Lighting;
  private settingsSnapshot: Settings;

  constructor(private canvas: HTMLCanvasElement, private conn: Connection, info: MatchStartInfo, private cb: GameCallbacks) {
    this.cfg = info.config;
    this.myId = info.you;
    this.offline = conn.kind === "offline";
    for (const r of info.roster) this.roster.set(r.i, r);
    const map = getFrontierMap();
    this.district = this.cfg.arena === "frontier" ? null : map.districts.find((d) => d.id === this.cfg.arena) ?? null;
    const s = settingsStore.get();
    this.settingsSnapshot = s;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: s.quality !== "low", powerPreference: "high-performance", stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = s.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;

    this.camera = new THREE.PerspectiveCamera(s.fov, 1, 0.05, 1200);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.scene.fog = new THREE.FogExp2(0xc4ecff, 0.0026);
    this.scene.background = new THREE.Color(0xc4ecff);
    this.envMap = makeEnvMap(this.renderer);

    // Sun, moon, sky and fog follow a shared day/night clock (match time).
    this.dayNight = new DayNight(this.scene, s.shadows);
    this.light = this.dayNight.state;

    this.world = buildWorld(map, s.quality, this.envMap, s.shadows, s.rain);
    this.scene.add(this.world.group);
    this.world.setArena(this.district ? { minX: this.district.minX, minZ: this.district.minZ, maxX: this.district.maxX, maxZ: this.district.maxZ } : null);
    this.collision = new CollisionWorld(map);
    this.track = this.cfg.mode === "payload" && this.district ? buildPayloadTrack(new NavGrid(this.collision, map, this.district), this.collision, this.district) : null;
    this.effects = new Effects(s.quality, s.particles);
    this.scene.add(this.effects.group);
    this.entities = new EntityView(
      info.barrels,
      info.crates ?? [],
      this.cfg.mode === "dom" && this.district ? this.district.points : null,
      this.track,
      () => this.myTeam(),
      () => this.friendColor(),
      () => this.enemyColor(),
    );
    this.scene.add(this.entities.group);
    this.viewmodel = new ViewModel(60);

    const bounds = this.district
      ? { minX: this.district.minX, minZ: this.district.minZ, maxX: this.district.maxX, maxZ: this.district.maxZ }
      : { minX: map.minX, minZ: map.minZ, maxX: map.maxX, maxZ: map.maxZ };
    const has = (m: string) => this.cfg.modifiers.includes(m as never);
    this.env = { world: this.collision, bounds, gravity: has("lowgrav") ? 0.55 : 1, tacticalRate: has("overcharge") ? 2 : 1, maxArmor: has("glass") ? 0 : MAX_ARMOR };
    this.hooks = this.makeHooks();

    this.input = new Input(canvas);
    this.input.onPause = () => this.setPaused(true);
    this.input.onScoreboard = (d) => (this.scoreboardOpen = d);
    this.input.onMap = () => (this.mapOpen = !this.mapOpen);

    this.unsub.push(conn.onMessage((m) => this.onMessage(m)));
    this.unsub.push(settingsStore.subscribe(() => this.applySettings()));
    // Session progression: level-ups and challenges celebrate mid-match.
    progress.beginMatch();
    this.viewmodel.setCamo(progress.camo());
    this.unsub.push(
      progress.onLevelUp((level, unlocked) => {
        this.pushToast(`LEVEL ${level}!`, unlocked.length ? `Unlocked ${unlocked.join(", ")}` : "Keep it up", "levelup");
        audio.levelUp();
      }),
    );
    this.unsub.push(
      onChallengeComplete((c) => {
        this.pushToast("CHALLENGE COMPLETE", `${c.text} · +500 XP`, "challenge");
        audio.challenge();
      }),
    );
    this.applySettings(true);
    if (this.cfg.mode === "training") {
      this.training = { move: false, sprint: false, jump: false, slide: false, ads: false, fire: false, hit: false, reload: false, swap: false, grenade: false, tactical: false, heal: false };
    }
    window.addEventListener("resize", this.resize);
    this.resize();
    audio.startAmbient(s.rain);
    audio.playMusic(s.musicVol > 0 ? "match" : "off");
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    this.lastFrame = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
      this.lastFrame = t;
      try {
        this.frame(dt);
      } catch (e) {
        console.error(e);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  requestLock(): void {
    this.input.requestLock();
  }

  get inputCaptured(): boolean {
    return this.input.locked;
  }

  setPaused(p: boolean): void {
    if (this.ended) p = false;
    this.paused = p;
    this.input.enabled = !p;
    this.conn.setPaused?.(p);
    this.cb.onPauseChange(p);
    if (!p) this.input.requestLock();
    else this.input.release();
  }

  setLoadout(l: Loadout): void {
    this.conn.send({ t: "loadout", loadout: l });
  }

  leave(): void {
    this.conn.send({ t: "leave_match" });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    for (const u of this.unsub) u();
    this.input.dispose();
    for (const r of this.remotes.values()) r.avatar?.dispose();
    this.world.dispose();
    this.effects.dispose();
    this.entities.dispose();
    this.viewmodel.dispose();
    this.envMap.dispose();
    this.dayNight.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    audio.stopAmbient();
    if (this.offline) this.conn.close();
  }

  private resize = () => {
    const s = settingsStore.get();
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio) * s.resolutionScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(Math.min(2, window.devicePixelRatio) * s.resolutionScale);
  };

  private applySettings(first = false): void {
    const s = settingsStore.get();
    const prev = this.settingsSnapshot;
    this.settingsSnapshot = s;
    if (first || prev.bloom !== s.bloom || prev.quality !== s.quality) {
      this.composer?.dispose();
      this.composer = null;
      this.vignette = null;
      if (s.bloom && s.quality !== "low") {
        const c = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
        const rp = new RenderPass(this.scene, this.camera);
        c.addPass(rp);
        const vm = new RenderPass(this.viewmodel.scene, this.viewmodel.camera);
        vm.clear = false;
        vm.clearDepth = true;
        c.addPass(vm);
        c.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), s.quality === "high" ? 0.5 : 0.4, 0.4, 0.92));
        this.vignette = new ShaderPass(VignetteShader);
        c.addPass(this.vignette);
        c.addPass(new OutputPass());
        this.composer = c;
      }
    }
    if (!first && prev.resolutionScale !== s.resolutionScale) this.resize();
    if (!first && prev.colorblind !== s.colorblind) for (const r of this.remotes.values()) r.avatar?.setTeamColor(this.colorForTeam(this.roster.get(r.id)?.t ?? -1));
    this.resize();
  }

  // -------------------------------------------------------------------------
  // Teams & colours
  // -------------------------------------------------------------------------

  private myTeam(): number {
    return this.roster.get(this.myId)?.t ?? 0;
  }
  friendColor(): number {
    return settingsStore.get().colorblind ? 0x3a86ff : 0x2f9bff;
  }
  enemyColor(): number {
    return settingsStore.get().colorblind ? 0xffbe0b : 0xff5d3a;
  }
  get isFFA(): boolean {
    return isSoloMode(this.cfg.mode);
  }
  colorForTeam(team: number): number {
    if (team === this.myTeam() && !this.isFFA) return this.friendColor();
    return this.enemyColor();
  }
  isEnemy(id: number): boolean {
    if (id === this.myId) return false;
    const t = this.roster.get(id)?.t;
    return this.isFFA || t !== this.myTeam();
  }
  nameOf(id: number): string {
    if (id < 0) return "The city";
    return this.roster.get(id)?.n ?? "Unknown";
  }

  // -------------------------------------------------------------------------
  // Networking
  // -------------------------------------------------------------------------

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case "snap":
        this.onSnap(m.s);
        break;
      case "roster":
        this.roster.clear();
        for (const r of m.roster) this.roster.set(r.i, r);
        for (const [id, r] of this.remotes) {
          if (!this.roster.has(id)) {
            r.avatar?.dispose();
            if (r.avatar) this.scene.remove(r.avatar.root);
            this.remotes.delete(id);
          }
        }
        break;
      case "match_end":
        this.ended = true;
        this.results = m.results;
        this.input.enabled = false;
        this.input.release();
        {
          const row = m.results.rows.find((r) => r.id === this.myId);
          const win = !!row && m.results.winnerTeam >= 0 && row.team === m.results.winnerTeam;
          const draw = m.results.winnerTeam < 0;
          this.hud.endBanner = {
            text: draw ? "DRAW" : win ? "VICTORY" : this.cfg.mode === "br" ? `#${row?.placement || "?"}` : "DEFEAT",
            sub: m.results.reason,
            win,
          };
          audio.alert(win ? "start" : "end");
        }
        setTimeout(() => this.cb.onEnd(m.results), 3500);
        break;
      case "error":
        if (m.code === "disconnected") this.cb.onDisconnected(m.message);
        break;
      case "match_start":
        // Reconnected: keep running with the same world.
        for (const r of m.info.roster) this.roster.set(r.i, r);
        this.hud.connectionWarning = null;
        break;
    }
  }

  private serverNow(): number {
    return performance.now() / 1000 + this.timeOffset;
  }

  private onSnap(s: Snapshot): void {
    const now = performance.now();
    this.lastSnapAt = now;
    const off = s.t - now / 1000;
    if (!this.haveTime) {
      this.timeOffset = off;
      this.haveTime = true;
    } else if (off > this.timeOffset) this.timeOffset += (off - this.timeOffset) * 0.5;
    else this.timeOffset += (off - this.timeOffset) * 0.02;
    this.match = s.m;
    this.spec = s.spec;
    if (s.sb) this.scores = s.sb;

    const nowS = now / 1000;
    for (const p of s.ps) {
      let r = this.remotes.get(p.i);
      if (!r) {
        r = { id: p.i, snaps: [], avatar: null, lastSeen: nowS, pos: new THREE.Vector3(p.x, p.y, p.z), prevPos: new THREE.Vector3(p.x, p.y, p.z), speed: 0, stepAcc: 0, yaw: p.yw, pitch: p.pt, flags: p.f, weapon: p.w };
        this.remotes.set(p.i, r);
      }
      r.snaps.push({ t: s.t, s: p });
      if (r.snaps.length > 40) r.snaps.splice(0, r.snaps.length - 40);
      r.lastSeen = nowS;
      r.hp = p.h;
      r.ar = p.a;
    }

    if (s.me) this.reconcile(s.me, s.ack);

    this.entities.syncPickups(s.pk);
    this.lastPickups = s.pk;
    this.entities.syncProjectiles(s.pr, (p) => {
      if (p.o !== this.myId) audio.throwSound(p);
    });
    this.entities.syncDeployables(s.dp, this.time);
    this.entities.syncBarrels(s.br);
    this.entities.syncCrates(s.cr ?? []);
    this.entities.syncMatch(s.m, (t) => this.colorForTeam(t));
    this.effects.syncSmokes(s.sm, nowS);
    for (const e of s.ev) this.onEvent(e);
  }

  private reconcile(server: PlayerState, ack: number): void {
    const old = this.me;
    this.pending = this.pending.filter((i) => i.seq > ack);
    const st = clonePlayer(server);
    this.replaying = true;
    const frozen = this.isFrozen();
    for (const i of this.pending) {
      if (frozen) {
        st.yaw = i.yaw;
        st.pitch = i.pitch;
        st.prevB = i.b;
      } else stepPlayer(st, i, this.env, this.hooks, SIM_DT);
    }
    this.replaying = false;
    if (old && old.alive && st.alive) {
      const ex = old.x - st.x;
      const ey = old.y - st.y;
      const ez = old.z - st.z;
      const d = Math.hypot(ex, ey, ez);
      if (d < 2) {
        this.smoothErr.x += ex;
        this.smoothErr.y += ey;
        this.smoothErr.z += ez;
      } else this.smoothErr.set(0, 0, 0);
      this.prevPos.x -= ex;
      this.prevPos.y -= ey;
      this.prevPos.z -= ez;
    } else {
      this.prevPos.set(st.x, st.y, st.z);
      this.smoothErr.set(0, 0, 0);
    }
    // Respawned: face the server-chosen direction.
    if (st.alive && !this.wasAlive) {
      this.camYaw = st.yaw;
      this.camPitch = 0;
      this.recoilDebt = 0;
      this.prevPos.set(st.x, st.y, st.z);
      this.hud.death = null;
      this.killerPos = null;
      if (this.wasAliveInit) audio.alert("neutral");
      this.trainStart ??= new THREE.Vector3(st.x, st.y, st.z);
    }
    this.wasAliveInit = true;
    this.wasAlive = st.alive;
    this.me = st;
  }
  private wasAliveInit = false;

  private isFrozen(): boolean {
    return this.match?.ph === "starting" && this.cfg.mode !== "br";
  }

  // -------------------------------------------------------------------------
  // Prediction hooks (visual only — the server decides every hit)
  // -------------------------------------------------------------------------

  private makeHooks(): SimHooks {
    return {
      fireHitscan: (p, def, origin, dirs) => {
        if (this.replaying) return;
        this.localShot(def);
        const muzzle = this.viewmodel.muzzleWorld(this.camera);
        for (const d of dirs) {
          const end = this.visualTrace(origin, d, def.maxRange);
          if (def.pellets === 1 || Math.random() < 0.5) this.effects.tracer(muzzle, end.p, def.color, def.id === "railspike" || def.id === "longshot" ? 2.5 : 1);
          if (end.world) this.effects.impact(end.p, end.n, def.color);
        }
        if (this.training) this.training.fire = true;
        void p;
      },
      fireProjectile: (_p, def) => {
        if (this.replaying) return;
        this.localShot(def);
      },
      throwGrenade: () => {
        if (this.replaying) return;
        this.viewmodel.throwGadget();
        audio.throwSound();
        if (this.training) this.training.grenade = true;
      },
      useTactical: () => {
        if (!this.replaying && this.training) this.training.tactical = true;
        return false;
      },
      interact: () => {},
      fallDamage: () => {},
      fx: (_p, fx, extra) => {
        if (this.replaying) return;
        switch (fx) {
          case "reload":
            audio.reload(extra ?? 0);
            if (this.training) this.training.reload = true;
            break;
          case "dry":
            audio.dry();
            break;
          case "djump":
            audio.jump();
            this.effects.pulse({ x: this.me!.x, y: this.me!.y - 0.2, z: this.me!.z }, 1.6, 0xffffff, 0.35);
            break;
          case "pad":
            audio.boing();
            this.effects.confetti({ x: this.me!.x, y: this.me!.y + 0.3, z: this.me!.z }, 18);
            break;
          case "jump":
            audio.jump();
            if (this.training) this.training.jump = true;
            break;
          case "land":
            audio.land(extra ?? 5);
            this.landDip = Math.min(0.25, (extra ?? 5) * 0.015);
            break;
          case "swap":
            audio.swap();
            if (this.training) this.training.swap = true;
            break;
          case "slide":
            audio.slide();
            if (this.training) this.training.slide = true;
            break;
          case "heal":
          case "plate":
            audio.heal();
            if (this.training) this.training.heal = true;
            break;
        }
      },
    };
  }

  private localShot(def: WeaponDef): void {
    const me = this.me;
    if (!me) return;
    this.viewmodel.fire();
    audio.gunshot(def, undefined, true);
    this.effects.muzzle(this.viewmodel.muzzleWorld(this.camera), def.color);
    // Camera recoil: climbs vertically with a weapon-specific sway pattern.
    const ads = me.ads;
    const growth = 1 + Math.min(me.sprayN, 12) * 0.04;
    const up = def.recoilUp * DEG * (1 - 0.35 * ads) * growth;
    const side = def.recoilSide * DEG * Math.sin(me.sprayN * 1.7 + def.damage) * (1 - 0.3 * ads);
    this.camPitch = Math.min(1.5, this.camPitch + up);
    this.camYaw += side;
    this.recoilDebt += up;
    this.sprayT = 0;
    if (settingsStore.get().cameraShake) this.shake = Math.max(this.shake, def.recoilUp * 0.02);
  }

  /** Client-side visual trace against the world and interpolated players. */
  private visualTrace(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, range: number) {
    const hit = this.collision.raycast(o, d, range, true);
    let t = hit ? hit.t : range;
    let world = !!hit;
    for (const r of this.remotes.values()) {
      if (!(r.flags & PF.ALIVE)) continue;
      const tb = rayAABB(o, d, { minX: r.pos.x - 0.42, maxX: r.pos.x + 0.42, minY: r.pos.y, maxY: r.pos.y + 1.8, minZ: r.pos.z - 0.42, maxZ: r.pos.z + 0.42 }, t);
      if (tb >= 0 && tb < t) {
        t = tb;
        world = false;
      }
    }
    const n = hit && world ? { x: hit.axis === 0 ? hit.ns : 0, y: hit.axis === 1 ? hit.ns : 0, z: hit.axis === 2 ? hit.ns : 0 } : null;
    return { p: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, world, n };
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private onEvent(e: GameEvent): void {
    trackEvent(e, this.myId);
    const h = this.hud;
    const now = this.time;
    switch (e.k) {
      case "shot": {
        if (e.p === this.myId) break;
        const def = WEAPONS[e.w as keyof typeof WEAPONS];
        if (!def) break;
        const o = { x: e.o[0]!, y: e.o[1]!, z: e.o[2]! };
        const r = this.remotes.get(e.p);
        const from = r ? { x: r.pos.x, y: r.pos.y + 1.35, z: r.pos.z } : o;
        for (const end of e.e) {
          const p = { x: end[0]!, y: end[1]!, z: end[2]! };
          this.effects.tracer(from, p, def.color, def.id === "railspike" || def.id === "longshot" ? 2.5 : 1);
          if (end[3] === 0) this.effects.impact(p, null, def.color, false);
          if (end[3] === 1) this.effects.blood(p, false);
        }
        this.effects.muzzle(from, def.color);
        audio.gunshot(def, from);
        this.soundCue(from, "shot", e.p);
        break;
      }
      case "arc": {
        const r = this.remotes.get(e.p);
        const start = e.p === this.myId ? this.viewmodel.muzzleWorld(this.camera) : r ? { x: r.pos.x, y: r.pos.y + 1.35, z: r.pos.z } : null;
        const pts = e.pts.map((p) => ({ x: p[0]!, y: p[1]!, z: p[2]! }));
        this.effects.arc(start ? [start, ...pts] : pts);
        break;
      }
      case "hit":
        h.hit = { t: now, head: e.h, kill: e.x };
        h.dmgNums.push({ id: this.nextId++, d: e.d, head: e.h, kill: e.x, t: now, dx: (Math.random() - 0.5) * 60 });
        if (h.dmgNums.length > 8) h.dmgNums.shift();
        audio.hitmarker(e.h, e.x, !!e.sh);
        if (this.training) this.training.hit = true;
        {
          const r = this.remotes.get(e.v);
          if (r) this.effects.blood({ x: r.pos.x, y: r.pos.y + (e.h ? 1.6 : 1.1), z: r.pos.z }, e.h);
        }
        break;
      case "dmg": {
        const me = this.me;
        if (!me) break;
        const a = Math.atan2(-(e.s[0]! - me.x), -(e.s[2]! - me.z));
        h.damageDirs.push({ a, t: now, amt: Math.min(1, e.d / 40) });
        if (h.damageDirs.length > 6) h.damageDirs.shift();
        this.hurt = Math.min(1, this.hurt + e.d / 60);
        audio.hurt(e.d);
        if (settingsStore.get().cameraShake) this.shake = Math.max(this.shake, Math.min(0.06, e.d * 0.002));
        break;
      }
      case "kill": {
        const kColor = e.kr < 0 ? "#aaaaaa" : hexStr(this.colorForTeam(this.roster.get(e.kr)?.t ?? -1));
        const vColor = hexStr(this.colorForTeam(this.roster.get(e.v)?.t ?? -1));
        const weapon = WEAPONS[e.w as keyof typeof WEAPONS]?.name ?? causeName(e.w);
        h.feed.push({ id: this.nextId++, killer: e.kr < 0 ? causeName(e.w) : this.nameOf(e.kr), victim: this.nameOf(e.v), weapon, head: e.h, kColor, vColor, me: e.kr === this.myId || e.v === this.myId, t: now });
        if (h.feed.length > 6) h.feed.shift();
        if (e.v === this.myId) {
          if (this.cfg.mode !== "br") this.input.releaseQuietly();
          const k = this.remotes.get(e.kr);
          this.killerPos = k ? k.pos.clone() : null;
          h.death = {
            killer: e.kr === this.myId ? "Yourself" : e.kr < 0 ? causeName(e.w) : this.nameOf(e.kr),
            weapon,
            head: e.h,
            respawnAt: e.rd ? now + e.rd : this.cfg.mode === "br" ? -1 : now + this.cfg.respawnDelay,
            spectating: null,
            placement: 0,
            redeploy: !!e.rd,
          };
        } else if (e.kr === this.myId) {
          h.killBanner = { name: this.nameOf(e.v), t: now, head: e.h };
          this.scorePop("Elimination", KILL_SCORE);
          if (e.h) this.scorePop("Headshot", HEADSHOT_BONUS);
        }
        if (e.as.includes(this.myId)) this.scorePop("Assist", ASSIST_SCORE);
        const r = this.remotes.get(e.v);
        if (r) {
          r.flags &= ~PF.ALIVE;
          // Celebratory confetti instead of anything gory.
          this.effects.confetti({ x: r.pos.x, y: r.pos.y + 1.2, z: r.pos.z }, e.kr === this.myId ? 60 : 30);
          if (e.kr === this.myId) audio.killPop();
        }
        break;
      }
      case "down":
        h.feed.push({ id: this.nextId++, killer: this.nameOf(e.by), victim: this.nameOf(e.v), weapon: "downed", head: false, kColor: "#ffffff", vColor: hexStr(this.colorForTeam(this.roster.get(e.v)?.t ?? -1)), me: e.v === this.myId || e.by === this.myId, t: now, downed: true });
        if (h.feed.length > 6) h.feed.shift();
        if (e.v === this.myId) this.pushBanner("You're DOWN — a squadmate can revive you", "warn");
        break;
      case "revive":
        this.pushMsg(`${this.nameOf(e.by)} revived ${this.nameOf(e.v)}`);
        break;
      case "boom": {
        const p = { x: e.x, y: e.y, z: e.z };
        const me = this.me;
        const dist = me ? Math.hypot(me.x - e.x, me.y - e.y, me.z - e.z) : 50;
        if (e.t === "crate") {
          this.effects.confetti(p, 28);
          this.effects.impact(p, { x: 0, y: 1, z: 0 }, 0xd9a066, false);
          audio.crate(p);
        } else if (e.t === "smoke") audio.pop(p, "smoke");
        else if (e.t === "flash") {
          audio.pop(p, "flash");
          this.effects.explosion(p, 1.5, 0xffffff);
        } else if (e.t === "emp") {
          audio.pop(p, "emp");
          this.effects.pulse(p, e.r, 0x3df2ff, 0.6);
          this.effects.arc([p, { x: p.x + 2, y: p.y + 1, z: p.z }, { x: p.x - 1, y: p.y + 2, z: p.z + 1 }], 0x3df2ff);
        } else {
          const color = e.t === "nova" ? 0xff2bd6 : e.t === "mine" ? 0xff3030 : 0xff7a2a;
          this.effects.explosion(p, e.r, color);
          audio.explosion(p, e.r / 5);
          if (settingsStore.get().cameraShake) this.shake = Math.max(this.shake, Math.max(0, 0.25 - dist * 0.008));
        }
        break;
      }
      case "flashed":
        h.flash = Math.max(h.flash, e.s);
        audio.muffleFor(GRENADES.flash.duration * e.s, e.s);
        break;
      case "medal": {
        if (e.m === "promoted" || e.m === "final_tier") {
          // Gun Game: the new weapon is the celebration.
          audio.promote(e.m === "final_tier");
          if (e.m === "final_tier") this.pushBanner("FINAL WEAPON — one more kill wins", "streak");
          break;
        }
        h.medals.push({ id: this.nextId++, m: e.m, t: now });
        if (h.medals.length > 3) h.medals.shift();
        audio.medal();
        const pts = MEDAL_SCORES[e.m] ?? 0;
        if (pts > 0) this.scorePop(MEDAL_NAMES[e.m] ?? e.m, pts);
        break;
      }
      case "ann":
        this.pushBanner(e.t, e.c);
        audio.alert(e.c === "warn" || e.c === "storm" ? "bad" : e.c === "start" ? "start" : e.c === "end" ? "end" : e.c === "objective" || e.c === "streak" ? "good" : "neutral");
        break;
      case "msg":
        this.pushMsg(e.t);
        if (e.t.startsWith("+") || e.t.startsWith("Picked")) audio.pickup();
        break;
      case "scan":
        this.effects.pulse({ x: e.x, y: this.me?.y ?? 0, z: e.z }, 35, 0x22e5ff, 1.2);
        audio.alert("neutral");
        break;
      case "scanned":
        h.scanned = now + 3;
        break;
      case "throw":
        break;
      case "spawn":
        break;
    }
  }

  private pushBanner(text: string, kind: string): void {
    this.hud.banners.push({ id: this.nextId++, text, kind, t: this.time });
    if (this.hud.banners.length > 2) this.hud.banners.shift();
  }

  private pushToast(title: string, text: string, kind: "levelup" | "challenge"): void {
    this.hud.toasts.push({ id: this.nextId++, title, text, kind, t: this.time });
    if (this.hud.toasts.length > 2) this.hud.toasts.shift();
  }

  /** Adds a "+N label" pop-up, grows the combo counter and earns session XP. */
  private scorePop(text: string, pts: number): void {
    const h = this.hud;
    if (this.cfg.mode === "training") return;
    h.scorePops.push({ id: this.nextId++, text, pts, t: this.time });
    if (h.scorePops.length > 5) h.scorePops.shift();
    if (this.time - h.combo.t > 3) h.combo = { pts: 0, n: 0, t: this.time };
    h.combo = { pts: h.combo.pts + pts, n: h.combo.n + 1, t: this.time };
    audio.scoreTick(h.combo.n);
    progress.add(pts);
  }

  private pushMsg(text: string): void {
    this.hud.msgs.push({ id: this.nextId++, text, t: this.time });
    if (this.hud.msgs.length > 4) this.hud.msgs.shift();
  }

  private soundCue(p: { x: number; z: number }, kind: "shot" | "step", who: number): void {
    const me = this.me;
    if (!me || !settingsStore.get().visualSoundCues || !this.isEnemy(who)) return;
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d > (kind === "shot" ? 60 : 18) || d < 2) return;
    const a = Math.atan2(-(p.x - me.x), -(p.z - me.z));
    this.hud.soundCues.push({ a, t: this.time, kind });
    if (this.hud.soundCues.length > 8) this.hud.soundCues.shift();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private frame(dt: number): void {
    this.time += dt;
    const s = settingsStore.get();
    const me = this.me;

    // Mouse look.
    const [mdx, mdy] = this.input.consumeMouse();
    if (!this.paused) {
      const def = me ? activeWeapon(me) : null;
      const ads = me?.ads ?? 0;
      const adsK = 1 + (s.adsSensitivity * (def?.adsZoom ?? 1) - 1) * ads;
      const k = 0.0022 * s.sensitivity * adsK;
      this.camYaw -= mdx * k;
      const dp = mdy * k * (s.invertY ? -1 : 1);
      this.camPitch = Math.max(-1.55, Math.min(1.55, this.camPitch - dp));
      if (dp > 0) this.recoilDebt = Math.max(0, this.recoilDebt - dp);
    }
    // Recoil recovery once the trigger is released.
    this.sprayT += dt;
    if (me && this.sprayT > 0.12 && this.recoilDebt > 0) {
      const def = activeWeapon(me);
      const r = Math.min(this.recoilDebt, (def?.recoilRecover ?? 6) * DEG * dt * 1.5);
      this.camPitch -= r;
      this.recoilDebt -= r;
    }

    // Fixed-step prediction & input upload.
    this.acc += dt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 8) {
      this.acc -= SIM_DT;
      steps++;
      this.simStep();
    }
    if (steps === 8) this.acc = 0;
    if (this.outbox.length) {
      while (this.outbox.length) this.conn.send({ t: "input", i: this.outbox.splice(0, 30) });
    }

    this.updateRemotes(dt);
    this.updateCamera(dt, mdx, mdy);
    this.light = this.dayNight.update(NIGHT_TOD, this.time, this.camera.position, this.scene, this.renderer);
    this.world.update(this.time, this.camera.position, this.light);
    this.effects.update(dt);
    this.entities.update(dt, this.time, (p, kind) => this.effects.trail(p, kind === "nova" ? 0xff2bd6 : 0xffffff));

    if (this.time - this.lastAmbient > 14) {
      this.lastAmbient = this.time;
      if (Math.random() < 0.6) audio.distantEvent();
    }
    this.render(dt);
    this.updateHud(dt);
  }

  private simStep(): void {
    const me = this.me;
    const [mx, mz] = this.input.axes();
    let b = this.input.buttons();
    // Mouse wheel → next/previous weapon slot.
    const next = b & (Btn.SLOT3 << 16);
    const prev = b & (Btn.SLOT1 << 16);
    b &= 0xffff;
    if ((next || prev) && me) {
      const owned = me.slots.map((sl, i) => (sl ? i : -1)).filter((i) => i >= 0);
      const idx = owned.indexOf(me.active);
      const ni = owned[(idx + (next ? 1 : -1) + owned.length) % owned.length]!;
      b |= ni === 0 ? Btn.SLOT1 : ni === 1 ? Btn.SLOT2 : Btn.SLOT3;
    }
    if (this.paused && !this.offline) b = 0;
    const inp: PlayerInput = {
      seq: ++this.seq, mx, mz, yaw: this.camYaw, pitch: this.camPitch, b,
      vt: this.haveTime ? this.serverNow() - INTERP_DELAY : 0,
    };
    if (this.paused && this.offline) return;
    if (me) {
      this.prevPos.set(me.x, me.y, me.z);
      if (this.isFrozen()) {
        me.yaw = inp.yaw;
        me.pitch = inp.pitch;
        me.prevB = inp.b;
      } else {
        const wasGround = me.onGround;
        stepPlayer(me, inp, this.env, this.hooks, SIM_DT);
        // Local footsteps.
        if (me.alive && me.onGround && wasGround && !me.crouched) {
          this.stepDist += Math.hypot(me.x - this.prevPos.x, me.z - this.prevPos.z);
          if (this.stepDist > (me.sprinting ? 2.6 : 2.1)) {
            this.stepDist = 0;
            audio.footstep(undefined, me.sprinting ? 0.8 : 0.5);
          }
        }
        if (this.training) {
          const t = this.training;
          if (this.trainStart && Math.hypot(me.x - this.trainStart.x, me.z - this.trainStart.z) > 8) t.move = true;
          if (me.sprinting) t.sprint = true;
          if (me.ads > 0.9) t.ads = true;
        }
      }
    }
    this.pending.push(inp);
    if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
    this.outbox.push(inp);
  }

  private updateRemotes(dt: number): void {
    const renderT = this.serverNow() - INTERP_DELAY;
    const nowS = performance.now() / 1000;
    for (const r of this.remotes.values()) {
      const snaps = r.snaps;
      if (!snaps.length) continue;
      let a = snaps[0]!;
      let b = snaps[snaps.length - 1]!;
      for (let i = snaps.length - 1; i > 0; i--) {
        if (snaps[i - 1]!.t <= renderT) {
          a = snaps[i - 1]!;
          b = snaps[i]!;
          break;
        }
      }
      let k = b.t > a.t ? (renderT - a.t) / (b.t - a.t) : 1;
      k = Math.max(0, Math.min(1.15, k));
      r.prevPos.copy(r.pos);
      r.pos.set(a.s.x + (b.s.x - a.s.x) * k, a.s.y + (b.s.y - a.s.y) * k, a.s.z + (b.s.z - a.s.z) * k);
      let dy = b.s.yw - a.s.yw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      r.yaw = a.s.yw + dy * Math.min(1, k);
      r.pitch = a.s.pt + (b.s.pt - a.s.pt) * Math.min(1, k);
      const cur = k < 0.5 ? a.s : b.s;
      r.flags = cur.f;
      r.weapon = cur.w;
      const moved = Math.hypot(r.pos.x - r.prevPos.x, r.pos.z - r.prevPos.z);
      r.speed = r.speed * 0.8 + (dt > 0 ? moved / dt : 0) * 0.2;
      const stale = nowS - r.lastSeen > 0.6;
      if (!r.avatar) {
        const ro = this.roster.get(r.id);
        if (!ro) continue;
        const mate = !this.isFFA && ro.t === this.myTeam();
        r.avatar = new Avatar(this.colorForTeam(ro.t), ro.n, mate, ro.bot);
        this.scene.add(r.avatar.root);
      }
      const alive = (r.flags & PF.ALIVE) !== 0 && !stale;
      r.avatar.update(
        {
          x: r.pos.x, y: r.pos.y, z: r.pos.z, yaw: r.yaw, pitch: r.pitch, crouch: (r.flags & PF.CROUCH) !== 0, downed: (r.flags & PF.DOWNED) !== 0,
          alive, speed: r.speed, weapon: r.weapon, revealed: (r.flags & PF.REVEALED) !== 0 && this.isEnemy(r.id), protectedSpawn: (r.flags & PF.PROTECTED) !== 0,
          gliding: (r.flags & PF.GLIDE) !== 0, sliding: (r.flags & PF.SLIDE) !== 0,
        },
        dt,
        this.time,
      );
      if (stale && nowS - r.lastSeen > 1.5) r.avatar.root.visible = false;
      // Remote footsteps (crouch-walking is silent).
      if (alive && r.flags & PF.GROUND && !(r.flags & PF.CROUCH) && r.speed > 2) {
        r.stepAcc += moved;
        if (r.stepAcc > 2.3) {
          r.stepAcc = 0;
          const d = this.me ? Math.hypot(r.pos.x - this.me.x, r.pos.z - this.me.z) : 99;
          if (d < 35) {
            audio.footstep(r.pos, r.flags & PF.SPRINT ? 1 : 0.6);
            this.soundCue(r.pos, "step", r.id);
          }
        }
      }
    }
  }

  private updateCamera(dt: number, mdx: number, mdy: number): void {
    const s = settingsStore.get();
    const me = this.me;
    const cam = this.camera;
    let fov = s.fov;
    this.smoothErr.multiplyScalar(Math.exp(-dt * 14));
    this.shake = Math.max(0, this.shake - dt * 0.6);
    this.landDip = Math.max(0, this.landDip - dt * 1.2);
    let hidden = false;
    if (me && me.alive) {
      const alpha = this.acc / SIM_DT;
      const x = this.prevPos.x + (me.x - this.prevPos.x) * alpha + this.smoothErr.x;
      const y = this.prevPos.y + (me.y - this.prevPos.y) * alpha + this.smoothErr.y;
      const z = this.prevPos.z + (me.z - this.prevPos.z) * alpha + this.smoothErr.z;
      const target = me.downed ? 0.6 : me.crouched ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
      this.eyeH += (target - this.eyeH) * Math.min(1, dt * 14);
      // Step smoothing: a stair step or curb moves the body up to 0.55 m in a single
      // tick; ease the view through it instead of snapping (only while grounded).
      if (me.onGround && this.wasGrounded && this.lastViewY !== null) {
        const dy = y - this.lastViewY;
        if (Math.abs(dy) > 0.01 && Math.abs(dy) <= STEP_HEIGHT + 0.05) this.stepSmooth -= dy;
      }
      this.stepSmooth = Math.max(-0.6, Math.min(0.6, this.stepSmooth * Math.exp(-dt * 20)));
      this.lastViewY = y;
      this.wasGrounded = me.onGround;
      const speed = Math.hypot(me.vx, me.vz);
      const bob = s.headBob && !s.reduceMotion && me.onGround ? Math.sin(this.time * (me.sprinting ? 14 : 10)) * 0.035 * Math.min(1, speed / 6) * (1 - me.ads) : 0;
      cam.position.set(x, y + this.eyeH + bob - this.landDip + this.stepSmooth, z);
      const def = activeWeapon(me);
      fov = s.fov * (1 + ((def?.adsZoom ?? 1) - 1) * me.ads) * (me.sprinting ? 1.05 : 1) * (me.slideT > 0 ? 1.08 : 1);
      const sh = s.cameraShake && !s.reduceMotion ? this.shake : 0;
      cam.rotation.set(this.camPitch + (Math.random() - 0.5) * sh * 0.4, this.camYaw + (Math.random() - 0.5) * sh * 0.4, me.slideT > 0 ? 0.04 : 0);
      hidden = me.downed || (def?.id === "longshot" && me.ads > 0.85);
      this.viewmodel.setWeapon(def?.id ?? null);
      this.viewmodel.update(dt, {
        ads: me.ads, speed, sprint: me.sprinting, reload: me.reloadT > 0 ? 1 : me.chan ? 0.7 : 0, swap: me.swapT, mouseDX: mdx, mouseDY: mdy,
        onGround: me.onGround, bob: s.headBob && !s.reduceMotion, aspect: cam.aspect, fov: 60, hidden,
      });
      if (this.audioListenerT++ % 2 === 0) audio.setListener(cam.position, this.camYaw);
    } else {
      // Spectate a squadmate (BR) or hover over your death spot.
      const spec = this.spec !== undefined ? this.remotes.get(this.spec) : undefined;
      if (spec) {
        cam.position.set(spec.pos.x, spec.pos.y + 1.62, spec.pos.z);
        cam.rotation.set(spec.pitch, spec.yaw, 0);
        if (this.hud.death) this.hud.death.spectating = this.nameOf(spec.id);
      } else if (me) {
        const tgt = new THREE.Vector3(me.x, me.y + 3.2, me.z);
        cam.position.lerp(tgt, Math.min(1, dt * 2));
        if (this.killerPos) {
          const look = this.killerPos.clone().setY(this.killerPos.y + 1.2);
          const m = new THREE.Matrix4().lookAt(cam.position, look, new THREE.Vector3(0, 1, 0));
          const q = new THREE.Quaternion().setFromRotationMatrix(m);
          cam.quaternion.slerp(q, Math.min(1, dt * 3));
        }
      }
      this.viewmodel.update(dt, { ads: 0, speed: 0, sprint: false, reload: 0, swap: 0, mouseDX: 0, mouseDY: 0, onGround: true, bob: false, aspect: cam.aspect, fov: 60, hidden: true });
      audio.setListener(cam.position, this.camYaw);
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 18);
      cam.updateProjectionMatrix();
    }
    if (this.vignette) {
      this.vignette.uniforms.uHurt!.value = this.hurt * 0.6;
      this.vignette.uniforms.uAmount!.value = s.competitiveHud ? 0.25 : 0.5;
    }
    this.hurt = Math.max(0, this.hurt - dt * 0.8);
  }
  private audioListenerT = 0;

  private render(dt: number): void {
    if (this.composer) this.composer.render(dt);
    else {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    }
  }

  // -------------------------------------------------------------------------
  // HUD model
  // -------------------------------------------------------------------------

  private updateHud(dt: number): void {
    const h = this.hud;
    const me = this.me;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      h.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    const t = this.time;
    h.feed = h.feed.filter((f) => t - f.t < 7);
    h.banners = h.banners.filter((b) => t - b.t < 4);
    h.medals = h.medals.filter((m) => t - m.t < 2.6);
    h.scorePops = h.scorePops.filter((p) => t - p.t < 2.2);
    h.toasts = h.toasts.filter((x) => t - x.t < 5);
    {
      const pr = progress.get();
      h.level = { level: pr.level, k: pr.into / xpToNext(pr.level) };
    }
    h.msgs = h.msgs.filter((m) => t - m.t < 3);
    h.damageDirs = h.damageDirs.filter((d) => t - d.t < 1.4);
    h.dmgNums = h.dmgNums.filter((d) => t - d.t < 0.9);
    h.night = this.light.night;
    h.soundCues = h.soundCues.filter((d) => t - d.t < 1.0);
    h.flash = Math.max(0, h.flash - dt / GRENADES.flash.duration);
    h.hurtFlash = this.hurt;
    if (h.killBanner && t - h.killBanner.t > 2.2) h.killBanner = null;
    const stale = performance.now() - this.lastSnapAt;
    h.connectionWarning = stale > 1500 ? (this.offline ? null : "Connection interrupted — waiting for server…") : null;
    h.online = !this.offline;
    h.yaw = this.camYaw;

    if (me) {
      h.alive = me.alive;
      h.downed = me.downed;
      h.health = Math.max(0, me.health);
      h.armor = me.armor;
      h.maxArmor = this.env.maxArmor;
      h.meX = me.x;
      h.meZ = me.z;
      const slot = me.slots[me.active];
      const def = slot ? WEAPONS[slot.id] : null;
      h.weaponName = def?.name ?? "Unarmed";
      h.weaponColor = def ? hexStr(def.color) : "#888";
      h.mag = slot?.mag ?? 0;
      h.magMax = def?.mag ?? 0;
      h.reserve = slot?.reserve ?? 0;
      h.reloading = me.reloadT > 0 && def ? 1 - me.reloadT / (def.reloadPerRound ?? def.reloadTime) : 0;
      h.slots = me.slots.map((sl, i) => ({
        name: sl ? WEAPONS[sl.id].name : i === 2 ? "Power slot" : "Empty",
        key: String(i + 1),
        active: i === me.active,
        color: sl ? hexStr(WEAPONS[sl.id].color) : "#555",
        ammo: sl ? `${sl.mag}/${sl.reserve}` : "",
      }));
      // Gun Game carries a single ladder weapon.
      if (this.cfg.mode === "gungame") h.slots = h.slots.slice(0, 1);
      const g = GRENADES[me.nadeSel];
      h.grenade = { name: g.name, count: me.nades[me.nadeSel], color: hexStr(g.color), all: GRENADE_IDS.map((id) => ({ id, n: me.nades[id] })) };
      const tac = TACTICALS[me.tactical];
      h.tactical = { name: tac.name, cd: me.tacCd, max: tac.cooldown, color: hexStr(tac.color) };
      h.injectors = me.injectors;
      h.plates = me.plates;
      h.channel = me.chan ? { label: me.chan === "heal" ? "Injecting…" : "Applying plate…", k: 1 - me.chanT / (me.chan === "heal" ? 1.1 : 1.4) } : null;
      const moving = Math.min(1.5, Math.hypot(me.vx, me.vz) / 5.6);
      h.spread = def ? def.spreadHip + (def.spreadAds - def.spreadHip) * me.ads + me.spread + moving * def.spreadMove * (1 - 0.5 * me.ads) + (me.onGround ? 0 : def.spreadAir) : 0;
      h.ads = me.ads;
      h.sprint = me.sprinting;
      h.emp = me.emp;
      h.overdrive = me.overdrive;
      h.spawnProt = me.spawnProt;
      h.prompt = this.computePrompt(me);
      if (!me.alive && h.death && this.cfg.mode === "br" && !h.death.redeploy) h.death.placement = this.scores.find((r) => r.i === this.myId)?.pl ?? 0;
      if (!me.alive && !h.death) h.death = { killer: "", weapon: "", head: false, respawnAt: this.cfg.mode === "br" ? -1 : t + this.cfg.respawnDelay, spectating: null, placement: 0 };
    }

    const m = this.match;
    if (m) {
      h.phase = m.ph;
      h.timeLeft = m.tl;
      h.cacheActive = !!m.dc;
      h.storm = m.storm ?? 0;
      const myTeam = this.myTeam();
      if (this.isFFA) {
        const gg = this.cfg.mode === "gungame";
        // Gun Game ranks by ladder tier (shown 1-based), FFA by eliminations.
        const val = (r: ScoreRow) => (gg ? (r.gt ?? 0) + 1 : r.k);
        const rows = [...this.scores].sort((a, b) => val(b) - val(a) || b.k - a.k);
        const mine = rows.find((r) => r.i === this.myId);
        const lead = rows[0];
        h.scoreLine = [
          { label: "YOU", value: mine ? val(mine) : 0, color: hexStr(this.friendColor()), mine: true },
          { label: lead && lead.i !== this.myId ? this.nameOf(lead.i) : "LEADER", value: lead ? val(lead) : 0, color: hexStr(this.enemyColor()), mine: false },
        ];
        if (gg) {
          // Your own tier comes straight from your (predicted) weapon; score rows lag a little.
          const w = me?.slots[0]?.id;
          const tier = Math.max(0, w ? GUN_LADDER.indexOf(w) : mine?.gt ?? 0);
          const next = GUN_LADDER[tier + 1];
          const others = rows.filter((r) => r.i !== this.myId);
          const top = others[0];
          h.gunGame = { tier, total: GUN_LADDER.length, next: next ? WEAPONS[next].name : null, leader: top ? val(top) : 0 };
          h.scoreLine[0]!.value = tier + 1;
          h.scoreLine[1] = { label: top ? this.nameOf(top.i) : "LEADER", value: top ? val(top) : 0, color: hexStr(this.enemyColor()), mine: false };
        }
      } else if (this.cfg.mode !== "br" && this.cfg.mode !== "payload") {
        h.scoreLine = m.sc.map((v, i) => ({ label: i === myTeam ? "ALLIES" : "ENEMY", value: v, color: hexStr(this.colorForTeam(i)), mine: i === myTeam }));
      } else h.scoreLine = [];
      h.points = (m.cp ?? []).map((cp, i) => ({ label: "ABC"[i]!, owner: cp.o, prog: cp.p, contested: cp.c, oc: cp.oc, color: cp.o >= 0 ? hexStr(this.colorForTeam(cp.o)) : "#9aa0b4" }));
      const tr = this.track;
      h.payload =
        m.pl && tr
          ? {
              progress: m.pl.p, checkpoints: tr.checkpoints.map((c) => c / tr.length), reached: m.pl.r, state: m.pl.s, escorts: m.pl.n,
              attacking: myTeam === 0, overtime: m.pl.ot, color: hexStr(this.colorForTeam(0)),
            }
          : null;
      if (m.zn && me) h.zone = { next: m.zn.n, shrinking: m.zn.s, alive: m.al ?? 0, outside: Math.hypot(me.x - m.zn.x, me.z - m.zn.z) > m.zn.r, dps: m.zn.dps };
      else h.zone = null;
    }
    h.streak = this.scores.find((r) => r.i === this.myId)?.st ?? 0;
    if (this.training) {
      const L: Record<string, string> = {
        move: "Move with WASD", sprint: "Sprint (hold Shift)", jump: "Jump (Space)", slide: "Slide: sprint, then Crouch (C)", ads: "Aim down sights (right mouse)",
        fire: "Fire (left mouse)", hit: "Hit a target bot", reload: "Reload (R)", swap: "Switch weapon (1/2 or wheel)", grenade: "Throw a grenade (G)",
        tactical: "Use your tactical (Q)", heal: "Use a healing injector (F) or armor plate (X)",
      };
      h.training = Object.entries(this.training).map(([k, v]) => ({ label: L[k] ?? k, done: v }));
    }
    h.markers = this.buildMarkers();
    h.version++;
  }

  private computePrompt(me: PlayerState): string | null {
    if (!me.alive || me.downed) return null;
    for (const r of this.remotes.values()) {
      if (r.flags & PF.DOWNED && !this.isEnemy(r.id) && Math.hypot(r.pos.x - me.x, r.pos.z - me.z) < 2.2) return `Hold [E] to revive ${this.nameOf(r.id)}`;
    }
    return this.nearPickupPrompt(me);
  }

  private nearPickupPrompt(me: PlayerState): string | null {
    const list = this.entitiesPickups();
    let best: { k: string; w?: string; d: number } | null = null;
    for (const p of list) {
      if (p.k !== "weapon" && p.k !== "power") continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
      if (d < 2.4 && (!best || d < best.d)) best = { k: p.k, w: p.w, d };
    }
    if (!best || !best.w) return null;
    const def = WEAPONS[best.w as keyof typeof WEAPONS];
    const has = me.slots.some((s) => s?.id === best!.w);
    return has ? `[E] Take ${def.name} ammo` : `[E] Pick up ${def.name}`;
  }

  private lastPickups: { k: string; w?: string; x: number; y: number; z: number }[] = [];
  private entitiesPickups() {
    return this.lastPickups;
  }

  private buildMarkers(): Marker[] {
    const out: Marker[] = [];
    const me = this.me;
    const emp = (me?.emp ?? 0) > 0;
    if (emp) return out;
    for (const r of this.remotes.values()) {
      if (!(r.flags & PF.ALIVE) || !r.avatar?.root.visible) continue;
      const enemy = this.isEnemy(r.id);
      if (!enemy) out.push({ x: r.pos.x, z: r.pos.z, kind: "mate", color: hexStr(this.friendColor()), label: this.nameOf(r.id), yaw: r.yaw });
      else if (r.flags & PF.REVEALED) out.push({ x: r.pos.x, z: r.pos.z, kind: "enemy", color: hexStr(this.enemyColor()), yaw: r.yaw });
    }
    for (const c of this.hud.soundCues) {
      if (c.kind !== "shot" || !me) continue;
      // Approximate ping direction shown on the minimap for unsuppressed fire.
      out.push({ x: me.x - Math.sin(c.a) * 20, z: me.z - Math.cos(c.a) * 20, kind: "ping", color: hexStr(this.enemyColor()) });
    }
    if (this.district && this.cfg.mode === "dom")
      this.district.points.forEach((p, i) => out.push({ x: p.x, z: p.z, kind: "point", label: "ABC"[i], color: this.hud.points[i]?.color ?? "#fff" }));
    const m = this.match;
    if (m?.dc) out.push({ x: m.dc[0], z: m.dc[2], kind: "cache", color: "#ffe14a", label: this.cfg.mode === "br" ? "DROP" : "CACHE" });
    if (m?.pl) out.push({ x: m.pl.x, z: m.pl.z, kind: "payload", color: hexStr(this.colorForTeam(0)), label: "PAYLOAD" });
    for (const p of this.lastPickups) if (p.k === "power") out.push({ x: p.x, z: p.z, kind: "power", color: "#ff2bd6", label: p.w ? WEAPONS[p.w as keyof typeof WEAPONS]?.name : "POWER" });
    return out;
  }

  /** Local game clock (seconds since the match view started). */
  get now(): number {
    return this.time;
  }

  /** Debug/testing view of the predicted local player. */
  debugState(): { me: PlayerState | null; remotes: number; pending: number } {
    return { me: this.me, remotes: this.remotes.size, pending: this.pending.length };
  }

  modeName(): string {
    return MODE_INFO[this.cfg.mode].name;
  }

  remoteSnapshot(): { id: number; hp?: number; ar?: number }[] {
    return [...this.remotes.values()].map((r) => ({ id: r.id, hp: r.hp, ar: r.ar }));
  }
}

function causeName(w: string): string {
  const m: Record<string, string> = {
    frag: "Frag Grenade", mine: "Proximity Mine", remote: "Remote Charge", barrel: "Explosive Barrel", storm: "The Storm", fall: "Gravity",
    void: "The Void", water: "Electrified Water", bleedout: "Bleed-out", nova: "Nova Cannon",
  };
  return m[w] ?? w;
}
