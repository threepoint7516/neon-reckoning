import * as THREE from "three";
import { WEAPONS, GRENADES, trackPoint } from "@neon/shared";
import type { DeploySnap, PickupSnap, ProjSnap, WeaponId, MatchStateSnap, PayloadSnap, PayloadTrack, ZoneSnap } from "@neon/shared";
import { textTexture, getTextures } from "./textures";

const PICKUP_COLORS: Record<string, number> = {
  ammo: 0xffd23f, health: 0x4dff7a, armor: 0x3d8bff, grenade: 0xff5a1f, injector: 0x4dff7a, plate: 0x3d8bff,
};

/** Renders snapshot-driven entities with light interpolation. */
export class EntityView {
  readonly group = new THREE.Group();
  private pickups = new Map<number, THREE.Group>();
  private projs = new Map<number, { obj: THREE.Object3D; target: THREE.Vector3; kind: string }>();
  private deploys = new Map<number, THREE.Object3D>();
  private barrels = new Map<number, THREE.Group>();
  private crates = new Map<number, THREE.Group>();
  private points: THREE.Group[] = [];
  private zoneWall: THREE.Mesh | null = null;
  private zoneMat: THREE.ShaderMaterial | null = null;
  private cache: THREE.Group;
  private cart: THREE.Group | null = null;
  private cartTarget = new THREE.Vector3();
  private cartYaw = 0;
  private cartState = 0;
  private cartMats: { core: THREE.MeshBasicMaterial; glow: THREE.SpriteMaterial; ring: THREE.MeshBasicMaterial; strip: THREE.MeshBasicMaterial } | null = null;
  private gates: { mat: THREE.MeshBasicMaterial; reached: boolean }[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private box = new THREE.BoxGeometry(1, 1, 1);
  private sphere = new THREE.SphereGeometry(1, 16, 12);
  private ringGeo: THREE.RingGeometry;
  private glowTex = getTextures().glow;
  private matCache = new Map<string, THREE.Material>();

  /** Shared materials keyed by purpose+colour, so respawning items never leak. */
  private mat<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.matCache.get(key) as T | undefined;
    if (!m) {
      m = make();
      this.matCache.set(key, m);
      this.mats.push(m);
    }
    return m;
  }

  constructor(
    barrels: { i: number; x: number; y: number; z: number }[],
    crates: { i: number; x: number; y: number; z: number }[],
    points: { x: number; y: number; z: number }[] | null,
    track: PayloadTrack | null,
    private myTeam: () => number,
    private friendColor: () => number,
    private enemyColor: () => number,
  ) {
    this.geos.push(this.box, this.sphere);
    this.ringGeo = new THREE.RingGeometry(4.6, 5, 64);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.geos.push(this.ringGeo);
    const barrelBody = new THREE.MeshStandardMaterial({ color: 0xa8201c, roughness: 0.5, metalness: 0.6 });
    const barrelGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffcc00).multiplyScalar(2), toneMapped: false });
    this.mats.push(barrelBody, barrelGlow);
    const cylGeo = new THREE.CylinderGeometry(0.38, 0.38, 1.1, 14);
    cylGeo.translate(0, 0.55, 0);
    const bandGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.08, 14);
    this.geos.push(cylGeo, bandGeo);
    for (const b of barrels) {
      const g = new THREE.Group();
      const c = new THREE.Mesh(cylGeo, barrelBody);
      c.castShadow = true;
      g.add(c);
      for (const y of [0.25, 0.85]) {
        const band = new THREE.Mesh(bandGeo, barrelGlow);
        band.position.y = y;
        g.add(band);
      }
      g.position.set(b.x, b.y, b.z);
      this.group.add(g);
      this.barrels.set(b.i, g);
    }
    // Loot crates: wooden boxes with bright banding — shoot or blast them open.
    const crateWood = new THREE.MeshToonMaterial({ color: 0xd9a066 });
    const crateBand = new THREE.MeshToonMaterial({ color: 0xffca3a, emissive: 0xffaa00, emissiveIntensity: 0.25 });
    this.mats.push(crateWood, crateBand);
    for (const c of crates) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.box, crateWood);
      body.scale.setScalar(0.9);
      body.position.y = 0.45;
      body.castShadow = true;
      const bandA = new THREE.Mesh(this.box, crateBand);
      bandA.scale.set(0.94, 0.16, 0.94);
      bandA.position.y = 0.45;
      const bandB = new THREE.Mesh(this.box, crateBand);
      bandB.scale.set(0.16, 0.94, 0.94);
      bandB.position.y = 0.45;
      g.add(body, bandA, bandB);
      g.position.set(c.x, c.y, c.z);
      g.rotation.y = (c.i * 0.7) % Math.PI;
      this.group.add(g);
      this.crates.set(c.i, g);
    }
    if (points) {
      points.forEach((p, i) => {
        const g = new THREE.Group();
        const rm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false, depthWrite: false });
        const ring = new THREE.Mesh(this.ringGeo, rm);
        ring.position.y = 0.06;
        const beamGeo = new THREE.CylinderGeometry(0.25, 0.6, 40, 12, 1, true);
        beamGeo.translate(0, 20, 0);
        this.geos.push(beamGeo);
        const bm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
        const beam = new THREE.Mesh(beamGeo, bm);
        const lt = textTexture("ABC"[i]!, "#ffffff", { w: 128, h: 128 });
        const lm = new THREE.SpriteMaterial({ map: lt, depthTest: false, transparent: true, toneMapped: false });
        const label = new THREE.Sprite(lm);
        label.scale.setScalar(1.6);
        label.position.y = 4;
        label.renderOrder = 9;
        this.mats.push(rm, bm, lm);
        g.add(ring, beam, label);
        g.position.set(p.x, p.y, p.z);
        g.userData = { rm, bm, lm };
        this.group.add(g);
        this.points.push(g);
      });
    }
    // Data cache objective.
    this.cache = new THREE.Group();
    const octa = new THREE.OctahedronGeometry(0.6);
    this.geos.push(octa);
    const cm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe14a).multiplyScalar(2.5), wireframe: true, toneMapped: false });
    const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe14a).multiplyScalar(1.6), transparent: true, opacity: 0.5, toneMapped: false });
    this.mats.push(cm, core);
    const o1 = new THREE.Mesh(octa, cm);
    const o2 = new THREE.Mesh(octa, core);
    o2.scale.setScalar(0.6);
    const beamGeo = new THREE.CylinderGeometry(0.15, 0.15, 60, 8, 1, true);
    beamGeo.translate(0, 30, 0);
    this.geos.push(beamGeo);
    const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe14a).multiplyScalar(1.5), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mats.push(bm);
    this.cache.add(o1, o2, new THREE.Mesh(beamGeo, bm));
    this.cache.visible = false;
    this.group.add(this.cache);
    if (track) this.buildPayload(track);
  }

  /** Payload: guide rails along the track, checkpoint gates and the glowing cart. */
  private buildPayload(track: PayloadTrack): void {
    const railMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x22e5ff).multiplyScalar(0.9), transparent: true, opacity: 0.55, toneMapped: false });
    this.mats.push(railMat);
    for (let i = 1; i < track.pts.length; i++) {
      const a = track.pts[i - 1]!;
      const b = track.pts[i]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.05) continue;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      for (const side of [-0.55, 0.55]) {
        const r = new THREE.Mesh(this.box, railMat);
        r.scale.set(0.08, 0.05, len + 0.08);
        r.rotation.y = yaw;
        r.position.set((a.x + b.x) / 2 + Math.cos(yaw) * side, (a.y + b.y) / 2 + 0.03, (a.z + b.z) / 2 - Math.sin(yaw) * side);
        this.group.add(r);
      }
    }
    // Checkpoint gates and the delivery beacon.
    const postGeo = new THREE.BoxGeometry(0.18, 3.2, 0.18);
    postGeo.translate(0, 1.6, 0);
    const beamGeo = new THREE.BoxGeometry(3.4, 0.16, 0.16);
    this.geos.push(postGeo, beamGeo);
    for (const d of [...track.checkpoints, track.length]) {
      const p = trackPoint(track, d);
      const last = d === track.length;
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(last ? 0xff2bd6 : 0x9aa0b4).multiplyScalar(1.6), toneMapped: false });
      this.mats.push(mat);
      const g = new THREE.Group();
      for (const side of [-1.7, 1.7]) {
        const post = new THREE.Mesh(postGeo, mat);
        post.position.x = side;
        g.add(post);
      }
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.position.y = 3.2;
      g.add(beam);
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.yaw;
      this.group.add(g);
      if (!last) this.gates.push({ mat, reached: false });
    }
    // The cart: armoured sled carrying a glowing data core.
    const cart = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, metalness: 0.85, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111218, metalness: 0.6, roughness: 0.6 });
    const strip = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const core = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const ringM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, toneMapped: false, depthWrite: false });
    const glow = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mats.push(hull, dark, strip, core, ringM, glow);
    const add = (m: THREE.Material, s: [number, number, number], pos: [number, number, number], shadow = true) => {
      const x = new THREE.Mesh(this.box, m);
      x.scale.set(...s);
      x.position.set(...pos);
      x.castShadow = shadow;
      cart.add(x);
    };
    add(hull, [1.3, 0.45, 2.0], [0, 0.55, 0]);
    add(dark, [1.36, 0.12, 2.06], [0, 0.32, 0]);
    add(hull, [0.9, 0.25, 0.9], [0, 0.9, 0]);
    add(strip, [1.32, 0.05, 2.02], [0, 0.72, 0], false);
    const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    this.geos.push(wheelGeo);
    for (const [x, z] of [[-0.62, -0.7], [0.62, -0.7], [-0.62, 0.7], [0.62, 0.7]] as const) {
      const w = new THREE.Mesh(wheelGeo, dark);
      w.position.set(x, 0.24, z);
      cart.add(w);
    }
    const octa = new THREE.OctahedronGeometry(0.42);
    this.geos.push(octa);
    const c = new THREE.Mesh(octa, core);
    c.name = "core";
    c.position.y = 1.45;
    cart.add(c);
    const halo = new THREE.Sprite(glow);
    halo.scale.setScalar(3.2);
    halo.position.y = 1.45;
    cart.add(halo);
    // Escort radius ring (PAYLOAD_RADIUS = 5 m).
    const ringGeo = new THREE.RingGeometry(4.75, 5, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.geos.push(ringGeo);
    const ring = new THREE.Mesh(ringGeo, ringM);
    ring.position.y = 0.05;
    ring.renderOrder = 5;
    cart.add(ring);
    const p0 = trackPoint(track, 0);
    cart.position.set(p0.x, p0.y, p0.z);
    cart.rotation.y = p0.yaw;
    this.cartTarget.copy(cart.position);
    this.cartYaw = p0.yaw;
    this.cart = cart;
    this.cartMats = { core, glow, ring: ringM, strip };
    this.group.add(cart);
  }

  private syncPayload(pl: PayloadSnap, colorOf: (team: number) => number): void {
    if (!this.cart || !this.cartMats) return;
    this.cartTarget.set(pl.x, pl.y, pl.z);
    this.cartYaw = pl.yw;
    this.cartState = pl.s;
    // Attackers' colour while moving; red when contested, grey when halted.
    const c = new THREE.Color(colorOf(0));
    if (pl.s === 2) c.lerp(new THREE.Color(0xff3030), 0.6);
    else if (pl.s === 0 || pl.s === 3) c.lerp(new THREE.Color(0x9aa0b4), 0.55);
    this.cartMats.core.color.copy(c).multiplyScalar(2.4);
    this.cartMats.strip.color.copy(c).multiplyScalar(1.8);
    this.cartMats.glow.color.copy(c);
    this.cartMats.ring.color.copy(c).multiplyScalar(1.5);
    this.gates.forEach((g, i) => {
      const reached = i < pl.r;
      if (reached === g.reached) return;
      g.reached = reached;
      g.mat.color.set(reached ? colorOf(0) : 0x9aa0b4).multiplyScalar(1.6);
    });
  }

  private makePickup(p: PickupSnap): THREE.Group {
    const g = new THREE.Group();
    const isWeapon = p.k === "weapon" || p.k === "power";
    const color = isWeapon && p.w ? WEAPONS[p.w as WeaponId].color : PICKUP_COLORS[p.k] ?? 0xffffff;
    const glow = this.mat(`pg${color}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), toneMapped: false }));
    const body = this.mat(`pb${color}`, () => new THREE.MeshStandardMaterial({ color: 0x22232c, metalness: 0.8, roughness: 0.35, emissive: color, emissiveIntensity: 0.25 }));
    const spin = new THREE.Group();
    spin.name = "spin";
    const add = (m: THREE.Material, s: [number, number, number], pos: [number, number, number] = [0, 0, 0]) => {
      const x = new THREE.Mesh(this.box, m);
      x.scale.set(...s);
      x.position.set(...pos);
      spin.add(x);
    };
    if (isWeapon) {
      const big = p.k === "power";
      add(body, [0.12, 0.14, big ? 0.9 : 0.7]);
      add(glow, [0.13, 0.03, big ? 0.7 : 0.5], [0, 0.06, 0]);
      add(body, [0.08, 0.16, 0.08], [0, -0.13, 0.1]);
    } else if (p.k === "health" || p.k === "injector") {
      add(glow, [0.5, 0.15, 0.15]);
      add(glow, [0.15, 0.5, 0.15]);
    } else if (p.k === "armor" || p.k === "plate") {
      add(body, [0.45, 0.55, 0.08]);
      add(glow, [0.35, 0.06, 0.1], [0, 0.12, 0]);
      add(glow, [0.35, 0.06, 0.1], [0, -0.05, 0]);
    } else if (p.k === "ammo") {
      add(body, [0.45, 0.28, 0.3]);
      add(glow, [0.47, 0.05, 0.32], [0, 0.08, 0]);
    } else {
      const s = new THREE.Mesh(this.sphere, glow);
      s.scale.setScalar(0.16);
      spin.add(s);
      add(body, [0.1, 0.12, 0.1], [0, 0.17, 0]);
    }
    spin.position.y = 0.75;
    g.add(spin);
    // Floor ring + glow halo.
    const rm = this.mat(`pr${color}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.7, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
    const ring = new THREE.Mesh(this.ringGeo, rm);
    ring.scale.setScalar(p.k === "power" ? 0.18 : 0.11);
    ring.position.y = 0.04;
    g.add(ring);
    const hm = this.mat(`ph${color}${p.k === "power"}`, () => new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(color).multiplyScalar(p.k === "power" ? 2 : 1), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const halo = new THREE.Sprite(hm);
    halo.scale.setScalar(p.k === "power" ? 3 : 1.6);
    halo.position.y = 0.75;
    g.add(halo);
    g.position.set(p.x, p.y, p.z);
    g.userData.kind = p.k;
    return g;
  }

  syncPickups(list: PickupSnap[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.i);
      if (!this.pickups.has(p.i)) {
        const g = this.makePickup(p);
        this.pickups.set(p.i, g);
        this.group.add(g);
      }
    }
    for (const [id, g] of this.pickups)
      if (!seen.has(id)) {
        this.group.remove(g);
        this.pickups.delete(id);
      }
  }

  syncProjectiles(list: ProjSnap[], onNew: (p: ProjSnap) => void): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.i);
      let e = this.projs.get(p.i);
      if (!e) {
        const color = p.k === "nova" ? 0xff2bd6 : GRENADES[p.k as keyof typeof GRENADES]?.color ?? 0xffffff;
        const m = this.mat(`jb${p.k}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(p.k === "nova" ? 3 : 1.5), toneMapped: false }));
        const obj = new THREE.Group();
        const s = new THREE.Mesh(this.sphere, m);
        s.scale.setScalar(p.k === "nova" ? 0.3 : 0.1);
        obj.add(s);
        const hm = this.mat(`jh${p.k}`, () => new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(color).multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        const h = new THREE.Sprite(hm);
        h.scale.setScalar(p.k === "nova" ? 2.5 : 0.8);
        obj.add(h);
        obj.position.set(p.x, p.y, p.z);
        this.group.add(obj);
        e = { obj, target: new THREE.Vector3(p.x, p.y, p.z), kind: p.k };
        this.projs.set(p.i, e);
        onNew(p);
      }
      e.target.set(p.x, p.y, p.z);
    }
    for (const [id, e] of this.projs)
      if (!seen.has(id)) {
        this.group.remove(e.obj);
        this.projs.delete(id);
      }
  }

  syncDeployables(list: DeploySnap[], time: number): void {
    const seen = new Set<number>();
    const mine = this.myTeam();
    for (const d of list) {
      seen.add(d.i);
      let o = this.deploys.get(d.i);
      const friendly = d.tm === mine;
      if (!o) {
        const color = friendly ? this.friendColor() : this.enemyColor();
        if (d.k === "shield") {
          const m = this.mat(`ds${color}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.2), transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
          const edge = this.mat(`de${color}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), toneMapped: false }));
          const g = new THREE.Group();
          const panel = new THREE.Mesh(this.box, m);
          const w = 3;
          panel.scale.set(d.ax === 0 ? w : 0.06, 2.3, d.ax === 0 ? 0.06 : w);
          panel.position.y = 1.15;
          const top = new THREE.Mesh(this.box, edge);
          top.scale.set(d.ax === 0 ? w : 0.08, 0.05, d.ax === 0 ? 0.08 : w);
          top.position.y = 2.3;
          const base = top.clone();
          base.position.y = 0.03;
          g.add(panel, top, base);
          o = g;
        } else {
          const body = this.mat("dbody", () => new THREE.MeshStandardMaterial({ color: 0x202028, metalness: 0.8, roughness: 0.4 }));
          const lc = d.k === "mine" ? (friendly ? this.friendColor() : 0xff2020) : 0xffb21f;
          const light = this.mat(`dl${lc}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(lc).multiplyScalar(3), toneMapped: false }));
          const g = new THREE.Group();
          const b = new THREE.Mesh(this.box, body);
          b.scale.set(d.k === "mine" ? 0.5 : 0.3, 0.1, d.k === "mine" ? 0.5 : 0.22);
          b.position.y = 0.05;
          const l = new THREE.Mesh(this.sphere, light);
          l.scale.setScalar(0.05);
          l.position.y = 0.12;
          l.name = "blink";
          g.add(b, l);
          o = g;
        }
        o.position.set(d.x, d.y, d.z);
        this.group.add(o);
        this.deploys.set(d.i, o);
      }
      const blink = o.getObjectByName("blink");
      if (blink) blink.visible = !d.armed || Math.sin(time * (d.k === "mine" ? 8 : 5)) > 0;
    }
    for (const [id, o] of this.deploys)
      if (!seen.has(id)) {
        this.group.remove(o);
        this.deploys.delete(id);
      }
  }

  syncCrates(broken: number[]): void {
    const set = new Set(broken);
    for (const [id, g] of this.crates) g.visible = !set.has(id);
  }

  syncBarrels(dead: number[]): void {
    const set = new Set(dead);
    for (const [id, g] of this.barrels) g.visible = !set.has(id);
  }

  syncMatch(m: MatchStateSnap, colorOf: (team: number) => number): void {
    if (m.cp)
      m.cp.forEach((cp, i) => {
        const g = this.points[i];
        if (!g) return;
        const c = new THREE.Color(cp.o >= 0 ? colorOf(cp.o) : cp.c ? 0xffffff : 0x9aa0b4);
        if (cp.c) c.lerp(new THREE.Color(0xff3030), 0.5);
        const { rm, bm, lm } = g.userData as { rm: THREE.MeshBasicMaterial; bm: THREE.MeshBasicMaterial; lm: THREE.SpriteMaterial };
        rm.color.copy(c).multiplyScalar(2);
        bm.color.copy(c).multiplyScalar(cp.oc ? 3 : 1.4);
        lm.color.copy(c).multiplyScalar(1.5);
      });
    if (m.dc) {
      this.cache.visible = true;
      this.cache.position.set(m.dc[0], m.dc[1] + 1, m.dc[2]);
    } else this.cache.visible = false;
    if (m.zn) this.syncZone(m.zn);
    if (m.pl) this.syncPayload(m.pl, colorOf);
  }

  private syncZone(z: ZoneSnap): void {
    if (!this.zoneWall) {
      const g = new THREE.CylinderGeometry(1, 1, 160, 96, 1, true);
      g.translate(0, 60, 0);
      this.geos.push(g);
      this.zoneMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec3 vW; varying vec2 vUv; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `uniform float uTime; varying vec3 vW; varying vec2 vUv;
          void main(){
            float bands = 0.5+0.5*sin(vW.y*0.8 - uTime*2.0 + vUv.x*60.0);
            float grid = step(0.96, fract(vUv.x*180.0)) + step(0.97, fract(vW.y*0.25 - uTime*0.3));
            float fade = smoothstep(120.0, 0.0, vW.y);
            float a = (0.12 + 0.12*bands + 0.4*grid)*fade;
            gl_FragColor = vec4(vec3(0.75,0.2,1.0)*a*2.0, a);
          }`,
        transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      });
      this.mats.push(this.zoneMat);
      this.zoneWall = new THREE.Mesh(g, this.zoneMat);
      this.zoneWall.renderOrder = 6;
      this.zoneWall.frustumCulled = false;
      this.group.add(this.zoneWall);
    }
    this.zoneWall.position.set(z.x, -10, z.z);
    this.zoneWall.scale.set(Math.max(0.5, z.r), 1, Math.max(0.5, z.r));
  }

  update(dt: number, time: number, onTrail: (p: THREE.Vector3, kind: string) => void): void {
    for (const g of this.pickups.values()) {
      const spin = g.getObjectByName("spin");
      if (spin) {
        spin.rotation.y += dt * 1.6;
        spin.position.y = 0.75 + Math.sin(time * 2 + g.position.x) * 0.08;
      }
    }
    for (const e of this.projs.values()) {
      e.obj.position.lerp(e.target, Math.min(1, dt * 18));
      if (e.kind === "nova" || Math.random() < 0.3) onTrail(e.obj.position, e.kind);
    }
    if (this.cache.visible) this.cache.rotation.y += dt * 2;
    if (this.zoneMat) this.zoneMat.uniforms.uTime!.value = time;
    for (const g of this.points) (g.children[1] as THREE.Mesh).rotation.y += dt;
    if (this.cart) {
      this.cart.position.lerp(this.cartTarget, Math.min(1, dt * 8));
      let d = this.cartYaw - this.cart.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.cart.rotation.y += d * Math.min(1, dt * 5);
      const core = this.cart.getObjectByName("core");
      if (core) {
        core.rotation.y += dt * (this.cartState === 1 ? 3 : 0.8);
        core.position.y = 1.45 + Math.sin(time * 2.4) * 0.08;
        core.scale.setScalar(this.cartState === 2 ? 0.75 + 0.25 * Math.sin(time * 14) : 1);
      }
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) {
      const mm = m as THREE.SpriteMaterial;
      if (mm.map && mm.map !== this.glowTex) mm.map.dispose();
      m.dispose();
    }
  }
}
