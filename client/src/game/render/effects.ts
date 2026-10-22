import * as THREE from "three";
import { getTextures } from "./textures";
import type { Quality } from "../../state/settings";

type V3 = { x: number; y: number; z: number };

/**
 * CPU particle pool rendered as a single Points draw call (additive).
 * Used for sparks, muzzle embers, explosion debris and plasma trails.
 */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseCol: Float32Array;
  private grav: Float32Array;
  private next = 0;
  private alive = 0;

  constructor(private max: number, additive: boolean, map: THREE.Texture) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseCol = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: window.innerHeight / 2 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float uScale;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*uScale/max(0.5,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: additive
        ? `uniform sampler2D uMap; varying vec3 vC; void main(){ float a=texture2D(uMap,gl_PointCoord).a; gl_FragColor=vec4(vC*a,1.0); }`
        : `uniform sampler2D uMap; varying vec3 vC; void main(){ float a=texture2D(uMap,gl_PointCoord).a; if(a<0.02) discard; gl_FragColor=vec4(vC, a*0.85); }`,
      transparent: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      toneMapped: !additive,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  emit(p: V3, v: V3, color: THREE.Color, size: number, life: number, gravity = 9): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.baseCol[i * 3] = color.r;
    this.baseCol[i * 3 + 1] = color.g;
    this.baseCol[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.alive = Math.min(this.max, this.alive + 1);
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      const k = Math.max(0, this.life[i]! / this.maxLife[i]!);
      this.vel[i * 3 + 1]! -= this.grav[i]! * dt;
      const drag = 1 - Math.min(1, dt * 1.5);
      this.vel[i * 3]! *= drag;
      this.vel[i * 3 + 2]! *= drag;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.col[i * 3] = this.baseCol[i * 3]! * k;
      this.col[i * 3 + 1] = this.baseCol[i * 3 + 1]! * k;
      this.col[i * 3 + 2] = this.baseCol[i * 3 + 2]! * k;
      if (this.life[i]! <= 0) this.size[i] = 0;
    }
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.color!.needsUpdate = true;
    g.attributes.size!.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

interface Timed {
  obj: THREE.Object3D;
  t: number;
  life: number;
  update: (k: number, dt: number) => void;
}

const tmpC = new THREE.Color();

export class Effects {
  readonly group = new THREE.Group();
  private sparks: Particles;
  private smoke: Particles;
  private timed: Timed[] = [];
  private tracerPool: THREE.Mesh[] = [];
  private tracerGeo: THREE.CylinderGeometry;
  private flashLight: THREE.PointLight;
  private flashT = 0;
  private boomLights: THREE.PointLight[] = [];
  private decals: THREE.InstancedMesh;
  private decalI = 0;
  private smokeClouds = new Map<number, { obj: THREE.Group; seen: number }>();
  private particleScale: number;
  private smokeTex: THREE.Texture;

  constructor(quality: Quality, particles: Quality) {
    const T = getTextures();
    this.smokeTex = T.smoke;
    this.particleScale = particles === "low" ? 0.4 : particles === "medium" ? 0.75 : 1;
    this.sparks = new Particles(particles === "low" ? 600 : 1800, true, T.spark);
    this.smoke = new Particles(particles === "low" ? 150 : 500, false, T.smoke);
    this.group.add(this.sparks.points, this.smoke.points);
    this.tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true);
    this.tracerGeo.rotateX(Math.PI / 2);
    this.tracerGeo.translate(0, 0, 0.5);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 14, 2);
    this.group.add(this.flashLight);
    for (let i = 0; i < (quality === "low" ? 1 : 3); i++) {
      const l = new THREE.PointLight(0xff8040, 0, 30, 2);
      this.boomLights.push(l);
      this.group.add(l);
    }
    const dg = new THREE.PlaneGeometry(0.16, 0.16);
    const dm = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decals = new THREE.InstancedMesh(dg, dm, 120);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.group.add(this.decals);
  }

  private add(obj: THREE.Object3D, life: number, update: Timed["update"]): void {
    this.group.add(obj);
    this.timed.push({ obj, t: 0, life, update });
  }

  /** Bright line from muzzle to impact, fading quickly. */
  tracer(from: V3, to: V3, color: number, width = 1): void {
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (len < 0.5) return;
    let m = this.tracerPool.pop();
    if (!m) m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color).multiplyScalar(3);
    mat.opacity = 1;
    m.position.set(from.x, from.y, from.z);
    m.lookAt(to.x, to.y, to.z);
    m.scale.set(width, width, len);
    this.add(m, 0.09, (k) => {
      mat.opacity = 1 - k;
      m!.scale.x = m!.scale.y = width * (1 - k * 0.5);
    });
  }

  muzzle(p: V3, color: number): void {
    this.flashLight.position.set(p.x, p.y, p.z);
    this.flashLight.color.setHex(color).lerp(tmpC.setHex(0xffc070), 0.6);
    this.flashLight.intensity = 30;
    this.flashT = 0.05;
    tmpC.setHex(color);
    for (let i = 0; i < 3 * this.particleScale; i++)
      this.sparks.emit(p, { x: (Math.random() - 0.5) * 3, y: Math.random() * 2, z: (Math.random() - 0.5) * 3 }, tmpC, 0.06, 0.15, 2);
  }

  impact(p: V3, normal: V3 | null, color = 0xffc080, decal = true): void {
    tmpC.setHex(color);
    const n = Math.ceil(7 * this.particleScale);
    for (let i = 0; i < n; i++) {
      const nx = (normal?.x ?? 0) * 3;
      const ny = (normal?.y ?? 0.5) * 3;
      const nz = (normal?.z ?? 0) * 3;
      this.sparks.emit(p, { x: nx + (Math.random() - 0.5) * 5, y: ny + Math.random() * 3, z: nz + (Math.random() - 0.5) * 5 }, tmpC, 0.07, 0.25 + Math.random() * 0.25, 12);
    }
    this.smoke.emit(p, { x: 0, y: 0.4, z: 0 }, tmpC.setRGB(0.35, 0.33, 0.4), 0.5, 0.6, -0.2);
    if (decal && normal) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal.x, normal.y, normal.z));
      m.compose(new THREE.Vector3(p.x + normal.x * 0.01, p.y + normal.y * 0.01, p.z + normal.z * 0.01), q, new THREE.Vector3(1, 1, 1));
      this.decals.setMatrixAt(this.decalI, m);
      this.decalI = (this.decalI + 1) % 120;
      this.decals.count = Math.max(this.decals.count, this.decalI === 0 ? 120 : this.decalI);
      this.decals.instanceMatrix.needsUpdate = true;
    }
  }

  blood(p: V3, head: boolean): void {
    // Stylised: cyber "data spill" sparks rather than gore.
    tmpC.setHex(head ? 0xfff27a : 0xff3b6b);
    for (let i = 0; i < (head ? 12 : 6) * this.particleScale; i++)
      this.sparks.emit(p, { x: (Math.random() - 0.5) * 4, y: Math.random() * 3, z: (Math.random() - 0.5) * 4 }, tmpC, head ? 0.1 : 0.07, 0.35, 8);
  }

  explosion(p: V3, radius: number, color = 0xff7a2a): void {
    const light = this.boomLights.find((l) => l.intensity < 1) ?? this.boomLights[0];
    if (light) {
      light.position.set(p.x, p.y + 1, p.z);
      light.color.setHex(color);
      light.intensity = 260;
      light.distance = radius * 5;
    }
    // Fireball shell.
    const geo = new THREE.SphereGeometry(1, 16, 12);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const ball = new THREE.Mesh(geo, mat);
    ball.position.set(p.x, p.y, p.z);
    this.add(ball, 0.45, (k) => {
      ball.scale.setScalar(0.5 + radius * 0.8 * Math.sqrt(k));
      mat.opacity = 1 - k;
      if (k >= 1) {
        geo.dispose();
        mat.dispose();
      }
    });
    // Shockwave ring.
    const rg = new THREE.RingGeometry(0.9, 1, 48);
    rg.rotateX(-Math.PI / 2);
    const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const ring = new THREE.Mesh(rg, rm);
    ring.position.set(p.x, p.y + 0.15, p.z);
    this.add(ring, 0.5, (k) => {
      ring.scale.setScalar(radius * 1.4 * k + 0.2);
      rm.opacity = 1 - k;
      if (k >= 1) {
        rg.dispose();
        rm.dispose();
      }
    });
    tmpC.setHex(color);
    const n = Math.ceil(45 * this.particleScale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 10;
      this.sparks.emit(p, { x: Math.cos(a) * s, y: Math.random() * 9, z: Math.sin(a) * s }, tmpC, 0.12, 0.5 + Math.random() * 0.6, 14);
    }
    for (let i = 0; i < 14 * this.particleScale; i++)
      this.smoke.emit(
        { x: p.x + (Math.random() - 0.5) * radius * 0.5, y: p.y + Math.random(), z: p.z + (Math.random() - 0.5) * radius * 0.5 },
        { x: (Math.random() - 0.5) * 2, y: 1 + Math.random() * 2, z: (Math.random() - 0.5) * 2 },
        tmpC.setRGB(0.14, 0.12, 0.16),
        2 + Math.random() * 2,
        2 + Math.random(),
        -0.3,
      );
  }

  /** Expanding ground ring (recon pulse, EMP). */
  pulse(p: V3, radius: number, color: number, life = 1): void {
    const rg = new THREE.RingGeometry(0.97, 1, 64);
    rg.rotateX(-Math.PI / 2);
    const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const ring = new THREE.Mesh(rg, rm);
    ring.position.set(p.x, p.y + 0.3, p.z);
    this.add(ring, life, (k) => {
      ring.scale.setScalar(Math.max(0.1, radius * k));
      rm.opacity = 1 - k;
      if (k >= 1) {
        rg.dispose();
        rm.dispose();
      }
    });
  }

  /** Jagged electric arc between points (Arcstorm). */
  arc(points: V3[], color = 0x9af6ff): void {
    if (points.length < 2) return;
    const verts: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      let prev = a;
      const segs = 8;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const j = s === segs ? 0 : 0.35;
        const p = { x: a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j, y: a.y + (b.y - a.y) * t + (Math.random() - 0.5) * j, z: a.z + (b.z - a.z) * t + (Math.random() - 0.5) * j };
        verts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const m = new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, toneMapped: false });
    const line = new THREE.LineSegments(g, m);
    this.add(line, 0.16, (k) => {
      m.opacity = 1 - k;
      if (k >= 1) {
        g.dispose();
        m.dispose();
      }
    });
  }

  trail(p: V3, color: number): void {
    tmpC.setHex(color);
    this.sparks.emit(p, { x: (Math.random() - 0.5) * 0.5, y: (Math.random() - 0.5) * 0.5, z: (Math.random() - 0.5) * 0.5 }, tmpC, 0.25, 0.35, 0);
  }

  /** Keeps smoke-grenade clouds in sync with the snapshot list. */
  syncSmokes(list: { i: number; x: number; y: number; z: number; r: number; t: number }[], now: number): void {
    for (const s of list) {
      let c = this.smokeClouds.get(s.i);
      if (!c) {
        const obj = new THREE.Group();
        const mat = new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x8a86a8, transparent: true, opacity: 0.0, depthWrite: false });
        const n = Math.ceil(28 * Math.max(0.6, this.particleScale));
        for (let k = 0; k < n; k++) {
          const sp = new THREE.Sprite(mat);
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * s.r * 0.8;
          sp.position.set(Math.cos(a) * r, 0.5 + Math.random() * 3.2, Math.sin(a) * r);
          sp.scale.setScalar(3 + Math.random() * 3);
          sp.material.rotation = Math.random() * 6;
          obj.add(sp);
        }
        obj.position.set(s.x, s.y, s.z);
        obj.userData.mat = mat;
        this.group.add(obj);
        c = { obj, seen: now };
        this.smokeClouds.set(s.i, c);
      }
      c.seen = now;
      const mat = c.obj.userData.mat as THREE.SpriteMaterial;
      const fadeIn = Math.min(1, (12 - s.t) / 1.2);
      const fadeOut = Math.min(1, s.t / 2);
      mat.opacity = 0.92 * Math.min(fadeIn, fadeOut);
    }
    for (const [id, c] of this.smokeClouds) {
      if (now - c.seen > 0.5) {
        this.group.remove(c.obj);
        (c.obj.userData.mat as THREE.Material).dispose();
        this.smokeClouds.delete(id);
      }
    }
  }

  update(dt: number): void {
    this.sparks.update(dt);
    this.smoke.update(dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flashLight.intensity = 0;
    }
    for (const l of this.boomLights) l.intensity = Math.max(0, l.intensity - dt * 900);
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i]!;
      t.t += dt;
      const k = Math.min(1, t.t / t.life);
      t.update(k, dt);
      if (k >= 1) {
        this.group.remove(t.obj);
        if (t.obj instanceof THREE.Mesh && t.obj.geometry === this.tracerGeo) this.tracerPool.push(t.obj);
        this.timed.splice(i, 1);
      }
    }
    for (const c of this.smokeClouds.values()) c.obj.rotation.y += dt * 0.05;
  }

  dispose(): void {
    this.sparks.dispose();
    this.smoke.dispose();
    this.tracerGeo.dispose();
    this.decals.geometry.dispose();
    (this.decals.material as THREE.Material).dispose();
    for (const m of this.tracerPool) (m.material as THREE.Material).dispose();
  }
}
