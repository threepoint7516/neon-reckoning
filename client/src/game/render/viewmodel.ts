import * as THREE from "three";
import { WEAPONS } from "@neon/shared";
import type { WeaponId } from "@neon/shared";
import { getTextures } from "./textures";

const VM_SCALE = 0.85;

interface Built {
  root: THREE.Group;
  muzzle: THREE.Vector3;
  /** Local offset to centre the sight line when aiming. */
  sightY: number;
}

/**
 * First-person weapon models assembled from primitives, each with its own
 * silhouette and glow colour, plus procedural bob/sway/recoil/reload motion.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private holder = new THREE.Group();
  private models = new Map<WeaponId, Built>();
  private current: WeaponId | null = null;
  private flash: THREE.Sprite;
  private flashT = 0;
  private kick = 0;
  private kickRot = 0;
  private swayX = 0;
  private swayY = 0;
  private bobT = 0;
  private swapAnim = 0;
  private shells: { m: THREE.Mesh; v: THREE.Vector3; t: number }[] = [];
  private shellGeo = new THREE.BoxGeometry(0.012, 0.012, 0.035);
  private shellMat = new THREE.MeshStandardMaterial({ color: 0xc8a040, metalness: 1, roughness: 0.3 });
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private hands: THREE.Group;
  private gadget: THREE.Mesh;
  private gadgetT = 0;

  constructor(fov: number) {
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.camera.add(this.holder);
    this.scene.add(new THREE.HemisphereLight(0xb8a8ff, 0x201830, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 2, 1);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff2bd6, 1.4);
    rim.position.set(-2, 0.5, -1);
    this.scene.add(rim);
    const T = getTextures();
    const fm = new THREE.SpriteMaterial({ map: T.glow, color: 0xffd090, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true });
    this.mats.push(fm);
    this.flash = new THREE.Sprite(fm);
    this.flash.visible = false;
    this.holder.add(this.flash);
    // Gloved hands.
    const glove = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.7, metalness: 0.2 });
    const knuckle = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x22e5ff).multiplyScalar(2), toneMapped: false });
    this.mats.push(glove, knuckle);
    this.hands = new THREE.Group();
    const bg = new THREE.BoxGeometry(1, 1, 1);
    this.geos.push(bg);
    const mk = (m: THREE.Material, s: [number, number, number], p: [number, number, number]) => {
      const x = new THREE.Mesh(bg, m);
      x.scale.set(...s);
      x.position.set(...p);
      return x;
    };
    this.hands.add(mk(glove, [0.08, 0.09, 0.14], [0.02, -0.08, 0.06]));
    this.hands.add(mk(knuckle, [0.082, 0.012, 0.02], [0.02, -0.035, 0.0]));
    this.hands.add(mk(glove, [0.08, 0.08, 0.13], [-0.03, -0.07, -0.22]));
    this.gadget = mk(new THREE.MeshStandardMaterial({ color: 0x333344, emissive: 0xff5a1f, emissiveIntensity: 2 }), [0.07, 0.07, 0.07], [-0.18, -0.2, -0.3]);
    this.gadget.visible = false;
    this.camera.add(this.gadget);
  }

  private build(id: WeaponId): Built {
    const def = WEAPONS[id];
    const root = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x22232c, roughness: 0.35, metalness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x101016, roughness: 0.6, metalness: 0.5 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(2.4), toneMapped: false });
    const accent = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.4, metalness: 0.6, emissive: def.color, emissiveIntensity: 0.25 });
    this.mats.push(body, dark, glow, accent);
    const g = new THREE.BoxGeometry(1, 1, 1);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    cyl.rotateX(Math.PI / 2);
    this.geos.push(g, cyl);
    const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const b = new THREE.Mesh(g, m);
      b.scale.set(w, h, d);
      b.position.set(x, y, z);
      root.add(b);
      return b;
    };
    const tube = (m: THREE.Material, r: number, len: number, x: number, y: number, z: number) => {
      const b = new THREE.Mesh(cyl, m);
      b.scale.set(r * 2, r * 2, len);
      b.position.set(x, y, z);
      root.add(b);
      return b;
    };
    let muzzleZ = -0.6;
    let sightY = 0.07;
    switch (id) {
      case "pulse9":
        box(body, 0.07, 0.1, 0.42, 0, 0, -0.15);
        tube(dark, 0.018, 0.32, 0, 0.015, -0.5);
        box(dark, 0.05, 0.14, 0.07, 0, -0.1, -0.12);
        box(body, 0.06, 0.08, 0.2, 0, -0.02, 0.15);
        box(glow, 0.072, 0.012, 0.3, 0, 0.035, -0.18);
        box(accent, 0.04, 0.04, 0.1, 0, 0.075, -0.1);
        muzzleZ = -0.66;
        break;
      case "viper":
        box(body, 0.065, 0.09, 0.3, 0, 0, -0.1);
        tube(dark, 0.02, 0.16, 0, 0.01, -0.33);
        box(dark, 0.04, 0.18, 0.05, 0, -0.13, -0.08);
        box(glow, 0.067, 0.04, 0.012, 0, 0.0, -0.24);
        box(glow, 0.067, 0.04, 0.012, 0, 0.0, -0.18);
        box(accent, 0.03, 0.05, 0.08, 0, 0.065, -0.05);
        muzzleZ = -0.42;
        break;
      case "breachmaker":
        box(body, 0.08, 0.1, 0.36, 0, 0, -0.1);
        tube(dark, 0.028, 0.48, 0, 0.02, -0.45);
        tube(accent, 0.032, 0.18, 0, -0.035, -0.38);
        box(glow, 0.082, 0.015, 0.2, 0, -0.02, -0.08);
        box(dark, 0.06, 0.09, 0.22, 0, -0.03, 0.18);
        muzzleZ = -0.7;
        break;
      case "longshot":
        box(body, 0.07, 0.1, 0.5, 0, 0, -0.12);
        tube(dark, 0.016, 0.6, 0, 0.02, -0.65);
        tube(body, 0.035, 0.28, 0, 0.11, -0.12);
        tube(glow, 0.03, 0.01, 0, 0.11, -0.26);
        box(glow, 0.072, 0.01, 0.4, 0, -0.03, -0.12);
        box(dark, 0.06, 0.12, 0.24, 0, -0.02, 0.22);
        sightY = 0.11;
        muzzleZ = -0.95;
        break;
      case "helix47":
        box(body, 0.075, 0.11, 0.44, 0, 0, -0.15);
        tube(dark, 0.02, 0.3, 0, 0.02, -0.5);
        box(accent, 0.02, 0.09, 0.3, 0.045, 0, -0.18);
        box(accent, 0.02, 0.09, 0.3, -0.045, 0, -0.18);
        box(glow, 0.012, 0.012, 0.42, 0, 0.065, -0.15);
        box(dark, 0.05, 0.13, 0.06, 0, -0.1, -0.15);
        muzzleZ = -0.66;
        break;
      case "titan":
        box(body, 0.1, 0.13, 0.5, 0, 0, -0.15);
        tube(dark, 0.025, 0.42, 0, 0.02, -0.6);
        tube(accent, 0.09, 0.08, 0.0, -0.12, -0.12).rotation.set(0, 0, Math.PI / 2);
        box(glow, 0.102, 0.02, 0.3, 0, 0.04, -0.2);
        box(dark, 0.07, 0.1, 0.25, 0, -0.02, 0.2);
        muzzleZ = -0.82;
        break;
      case "phantom":
        box(body, 0.05, 0.07, 0.22, 0, 0, -0.08);
        box(dark, 0.045, 0.13, 0.05, 0, -0.08, 0.0);
        box(glow, 0.052, 0.01, 0.18, 0, 0.03, -0.08);
        muzzleZ = -0.2;
        sightY = 0.05;
        break;
      case "railspike":
        box(body, 0.07, 0.1, 0.5, 0, 0, -0.15);
        box(accent, 0.015, 0.06, 0.55, 0.035, 0.01, -0.45);
        box(accent, 0.015, 0.06, 0.55, -0.035, 0.01, -0.45);
        box(glow, 0.04, 0.01, 0.5, 0, 0.01, -0.45);
        tube(body, 0.028, 0.18, 0, 0.09, -0.1);
        box(dark, 0.06, 0.1, 0.22, 0, -0.03, 0.2);
        sightY = 0.09;
        muzzleZ = -0.75;
        break;
      case "arcstorm":
        box(body, 0.09, 0.12, 0.38, 0, 0, -0.12);
        for (let i = 0; i < 4; i++) tube(glow, 0.035 - i * 0.004, 0.015, 0, 0.0, -0.32 - i * 0.06);
        tube(dark, 0.015, 0.25, 0, 0, -0.45);
        box(accent, 0.05, 0.08, 0.12, 0, 0.09, -0.05);
        muzzleZ = -0.6;
        break;
      case "nova":
        box(body, 0.12, 0.14, 0.42, 0, 0, -0.1);
        tube(dark, 0.06, 0.3, 0, 0.0, -0.42);
        tube(glow, 0.045, 0.04, 0, 0.0, -0.58);
        box(accent, 0.13, 0.03, 0.3, 0, 0.08, -0.12);
        box(glow, 0.03, 0.03, 0.2, 0.065, 0.0, -0.1);
        muzzleZ = -0.62;
        break;
    }
    root.add(this.hands.clone());
    return { root, muzzle: new THREE.Vector3(0, 0.015, muzzleZ), sightY };
  }

  setWeapon(id: WeaponId | null): void {
    if (id === this.current) return;
    if (this.current) {
      const old = this.models.get(this.current);
      if (old) this.holder.remove(old.root);
    }
    this.current = id;
    if (!id) return;
    let b = this.models.get(id);
    if (!b) {
      b = this.build(id);
      this.models.set(id, b);
    }
    b.root.scale.setScalar(VM_SCALE);
    this.holder.add(b.root);
    this.swapAnim = 1;
  }

  fire(): void {
    if (!this.current) return;
    const def = WEAPONS[this.current];
    const strength = Math.min(1.5, 0.3 + def.recoilUp * 0.25);
    this.kick = Math.min(0.12, this.kick + 0.03 * strength);
    this.kickRot = Math.min(0.25, this.kickRot + 0.06 * strength);
    this.flashT = 0.045;
    const b = this.models.get(this.current)!;
    (this.flash.material as THREE.SpriteMaterial).color.setHex(def.color).lerp(new THREE.Color(0xfff0c0), 0.5).multiplyScalar(3);
    this.flash.position.copy(b.muzzle).add(b.root.position);
    this.flash.scale.setScalar(0.18 + Math.random() * 0.12);
    this.flash.material.rotation = Math.random() * 6;
    // Ejected casing for ballistic weapons.
    if (def.sound.kind !== "energy" && this.shells.length < 24) {
      const m = new THREE.Mesh(this.shellGeo, this.shellMat);
      m.position.set(b.root.position.x + 0.03, b.root.position.y + 0.03, b.root.position.z - 0.1);
      this.holder.add(m);
      this.shells.push({ m, v: new THREE.Vector3(1.2 + Math.random(), 1.4 + Math.random(), 0.3), t: 0 });
    }
  }

  throwGadget(): void {
    this.gadgetT = 0.4;
  }

  /**
   * @param ads 0..1 aim amount
   * @param moving horizontal speed (m/s)
   */
  update(dt: number, o: { ads: number; speed: number; sprint: boolean; reload: number; swap: number; mouseDX: number; mouseDY: number; onGround: boolean; bob: boolean; aspect: number; fov: number; hidden: boolean }): void {
    this.camera.aspect = o.aspect;
    this.camera.fov = o.fov;
    this.camera.updateProjectionMatrix();
    this.holder.visible = !o.hidden;
    if (!this.current) return;
    const b = this.models.get(this.current)!;
    this.kick = Math.max(0, this.kick - dt * 0.6);
    this.kickRot = Math.max(0, this.kickRot - dt * 2.2);
    this.kick *= Math.pow(0.0005, dt);
    this.kickRot *= Math.pow(0.002, dt);
    this.swayX += (-o.mouseDX * 0.0006 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (o.mouseDY * 0.0006 - this.swayY) * Math.min(1, dt * 10);
    this.swapAnim = Math.max(0, this.swapAnim - dt * 3.5);
    if (o.onGround && o.speed > 0.5) this.bobT += dt * (o.sprint ? 13 : 9);
    const bobAmt = o.bob ? Math.min(1, o.speed / 6) * (1 - o.ads * 0.9) : 0;
    const bx = Math.sin(this.bobT) * 0.012 * bobAmt;
    const by = Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt;
    const hip = new THREE.Vector3(0.17, -0.18, -0.44);
    const aim = new THREE.Vector3(0, -b.sightY, -0.36);
    const p = hip.lerp(aim, o.ads);
    p.x += bx + this.swayX;
    p.y += by + this.swayY - this.swapAnim * 0.35 - o.reload * 0.12 - (o.sprint ? 0.05 : 0);
    p.z += this.kick;
    b.root.position.copy(p);
    b.root.rotation.set(this.kickRot * (1 - o.ads * 0.5) + o.reload * 0.6, (o.sprint ? 0.5 : 0) + this.swayX * 2, (o.sprint ? 0.25 : 0) + o.reload * 0.35);
    // Muzzle flash.
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flash.position.copy(b.muzzle).multiplyScalar(VM_SCALE).applyEuler(b.root.rotation).add(b.root.position);
    } else this.flash.visible = false;
    // Shells.
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!;
      s.t += dt;
      s.v.y -= 9 * dt;
      s.m.position.addScaledVector(s.v, dt * 0.5);
      s.m.rotation.x += dt * 20;
      if (s.t > 0.6) {
        this.holder.remove(s.m);
        this.shells.splice(i, 1);
      }
    }
    if (this.gadgetT > 0) {
      this.gadgetT -= dt;
      this.gadget.visible = true;
      const k = 1 - this.gadgetT / 0.4;
      this.gadget.position.set(-0.18 + k * 0.1, -0.2 + Math.sin(k * Math.PI) * 0.2, -0.3 - k * 0.4);
    } else this.gadget.visible = false;
  }

  /** World-space muzzle position for tracers (approximate, from the main camera). */
  muzzleWorld(main: THREE.Camera): THREE.Vector3 {
    if (!this.current) return main.position.clone();
    const b = this.models.get(this.current)!;
    const local = b.muzzle.clone().multiplyScalar(VM_SCALE).applyEuler(b.root.rotation).add(b.root.position);
    // Viewmodel space is camera-relative; map into the world camera.
    return local.applyMatrix4(main.matrixWorld);
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    this.shellGeo.dispose();
    this.shellMat.dispose();
  }
}
