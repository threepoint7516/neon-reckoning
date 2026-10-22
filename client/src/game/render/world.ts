import * as THREE from "three";
import { Mat, BoxFlag, REGION } from "@neon/shared";
import type { Box, MapData, MatId, Sign } from "@neon/shared";
import { getTextures, textTexture } from "./textures";
import type { Quality } from "../../state/settings";

/** UV tile size in metres per material. */
const TILE: Partial<Record<MatId, [number, number]>> = {
  [Mat.CONCRETE]: [4, 4], [Mat.METAL]: [3, 3], [Mat.FACADE]: [8, 8], [Mat.CONTAINER]: [3, 2.6], [Mat.ASPHALT]: [10, 10],
  [Mat.GROUND]: [10, 10], [Mat.WOOD]: [2, 2], [Mat.DIRT]: [6, 6], [Mat.PANEL]: [4, 4], [Mat.ROCK]: [5, 5], [Mat.FENCE]: [1, 1],
  [Mat.TRIM]: [1, 1], [Mat.GLASS]: [2, 2], [Mat.NEON]: [1, 1], [Mat.BARRIER]: [6, 6],
};

interface Arrays {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

const newArrays = (): Arrays => ({ pos: [], nor: [], uv: [], col: [], idx: [] });
const tmpColor = new THREE.Color();

/** Appends a box's faces with world-space UVs (so textures tile at real scale). */
function pushBox(a: Arrays, b: Box, tile: [number, number]): void {
  tmpColor.setHex(b.color);
  const r = tmpColor.r;
  const g = tmpColor.g;
  const bl = tmpColor.b;
  const [tu, tv] = tile;
  const faces: [number[], number[][], number[][]][] = [];
  const x0 = b.minX, x1 = b.maxX, y0 = b.minY, y1 = b.maxY, z0 = b.minZ, z1 = b.maxZ;
  // +X, -X, +Y, -Y, +Z, -Z  (corners counter-clockwise seen from outside)
  faces.push([[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]]);
  faces.push([[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]]);
  faces.push([[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]]);
  if (y0 > 0.05) faces.push([[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]]);
  faces.push([[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
  faces.push([[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]]);
  for (const [n, vs, uvs] of faces) {
    const base = a.pos.length / 3;
    // Subtle per-face shading variation keeps flat-coloured boxes readable.
    const shade = n[1] === 1 ? 1.05 : n[0] !== 0 ? 0.92 : 1;
    for (let i = 0; i < 4; i++) {
      a.pos.push(vs[i]![0]!, vs[i]![1]!, vs[i]![2]!);
      a.nor.push(n[0]!, n[1]!, n[2]!);
      a.uv.push(uvs[i]![0]! / tu, uvs[i]![1]! / tv);
      a.col.push(r * shade, g * shade, bl * shade);
    }
    a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function toGeometry(a: Arrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(a.nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(a.col, 3));
  g.setIndex(a.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(a.idx, 1) : new THREE.Uint16BufferAttribute(a.idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const fogVert = THREE.ShaderChunk.fog_pars_vertex;
const fogFrag = THREE.ShaderChunk.fog_pars_fragment;

export interface WorldView {
  group: THREE.Group;
  /** Meshes used for client-side visual raycasts (tracers, impacts). */
  materials: Map<MatId, THREE.Material>;
  update(t: number, cam: THREE.Vector3): void;
  setArena(b: { minX: number; minZ: number; maxX: number; maxZ: number } | null): void;
  dispose(): void;
}

export function buildWorld(map: MapData, quality: Quality, envMap: THREE.Texture | null, shadows: boolean, rain: boolean): WorldView {
  const T = getTextures();
  const group = new THREE.Group();
  group.name = "world";
  const disposables: { dispose(): void }[] = [];

  const std = (o: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, envMap, envMapIntensity: 0.9, ...o });
    disposables.push(m);
    return m;
  };
  const materials = new Map<MatId, THREE.Material>();
  materials.set(Mat.CONCRETE, std({ map: T.concrete, roughness: 0.88, metalness: 0.05 }));
  materials.set(Mat.METAL, std({ map: T.metal, roughness: 0.42, metalness: 0.75 }));
  materials.set(Mat.FACADE, std({ map: T.facade, roughness: 0.55, metalness: 0.35, emissiveMap: T.facadeEmissive, emissive: new THREE.Color(1.6, 1.5, 1.5) }));
  materials.set(Mat.CONTAINER, std({ map: T.container, roughness: 0.6, metalness: 0.45 }));
  materials.set(Mat.ASPHALT, std({ map: T.asphalt, roughness: 0.5, metalness: 0.15, envMapIntensity: 0.55 }));
  materials.set(Mat.GROUND, materials.get(Mat.ASPHALT)!);
  materials.set(Mat.WOOD, std({ map: T.wood, roughness: 0.85, metalness: 0 }));
  materials.set(Mat.DIRT, std({ map: T.dirt, roughness: 0.95, metalness: 0 }));
  materials.set(Mat.PANEL, std({ map: T.panel, roughness: 0.5, metalness: 0.55 }));
  materials.set(Mat.ROCK, std({ map: T.rock, roughness: 0.95, metalness: 0 }));
  materials.set(Mat.TRIM, std({ roughness: 0.4, metalness: 0.8 }));
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.9, envMap, depthWrite: false });
  materials.set(Mat.GLASS, glass);
  const fence = new THREE.MeshStandardMaterial({ map: T.fence, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.5, metalness: 0.6, transparent: false });
  materials.set(Mat.FENCE, fence);
  const neon = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(2.6, 2.6, 2.6) });
  materials.set(Mat.NEON, neon);
  const barrier = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; varying vec3 vW;
      void main(){
        float u = (abs(fract(vW.x*0.25)-0.5) < 0.02 || abs(fract(vW.z*0.25)-0.5)<0.02) ? 1.0 : 0.0;
        float h = abs(fract(vW.y*0.25 - uTime*0.15)-0.5) < 0.015 ? 1.0 : 0.0;
        float fade = smoothstep(26.0, 0.0, vW.y) ;
        float a = (0.06 + 0.35*max(u,h)) * fade;
        gl_FragColor = vec4(vec3(0.2,0.9,1.0)*a*2.0, a);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  materials.set(Mat.BARRIER, barrier);
  disposables.push(glass, fence, neon, barrier);

  // Merge boxes per (chunk × material) for few draw calls with frustum culling.
  const CH = 64;
  const buckets = new Map<string, { mat: MatId; arrays: Arrays }>();
  for (const b of map.boxes) {
    const cx = Math.floor(((b.minX + b.maxX) / 2 + REGION) / CH);
    const cz = Math.floor(((b.minZ + b.maxZ) / 2 + REGION) / CH);
    const mat = b.mat === Mat.GROUND ? Mat.ASPHALT : b.mat;
    const k = `${mat}:${cx}:${cz}`;
    let bk = buckets.get(k);
    if (!bk) buckets.set(k, (bk = { mat, arrays: newArrays() }));
    pushBox(bk.arrays, b, TILE[mat] ?? [4, 4]);
  }
  for (const { mat, arrays } of buckets.values()) {
    const geo = toGeometry(arrays);
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, materials.get(mat)!);
    mesh.matrixAutoUpdate = false;
    if (shadows && mat !== Mat.NEON && mat !== Mat.BARRIER && mat !== Mat.GLASS) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    if (mat === Mat.GLASS || mat === Mat.BARRIER) mesh.renderOrder = 2;
    group.add(mesh);
  }

  // Ladders: rails and rungs.
  {
    const a = newArrays();
    for (const l of map.ladders) {
      const alongX = l.maxX - l.minX > l.maxZ - l.minZ;
      const top = l.maxY - 1.4;
      const mid = alongX ? (l.minZ + l.maxZ) / 2 : (l.minX + l.maxX) / 2;
      const rail = (u: number) =>
        alongX
          ? ({ minX: u - 0.04, maxX: u + 0.04, minY: l.minY, maxY: top + 1, minZ: mid - 0.04, maxZ: mid + 0.04 } as Box)
          : ({ minX: mid - 0.04, maxX: mid + 0.04, minY: l.minY, maxY: top + 1, minZ: u - 0.04, maxZ: u + 0.04 } as Box);
      const u0 = alongX ? l.minX + 0.1 : l.minZ + 0.1;
      const u1 = alongX ? l.maxX - 0.1 : l.maxZ - 0.1;
      for (const u of [u0, u1]) pushBox(a, { ...rail(u), mat: Mat.METAL, color: 0xffb21f, flags: BoxFlag.DECOR }, [1, 1]);
      for (let y = l.minY + 0.3; y < top + 0.6; y += 0.35) {
        const rung = alongX
          ? { minX: u0, maxX: u1, minY: y, maxY: y + 0.05, minZ: mid - 0.03, maxZ: mid + 0.03 }
          : { minX: mid - 0.03, maxX: mid + 0.03, minY: y, maxY: y + 0.05, minZ: u0, maxZ: u1 };
        pushBox(a, { ...rung, mat: Mat.METAL, color: 0xd09020, flags: BoxFlag.DECOR }, [1, 1]);
      }
    }
    if (a.pos.length) {
      const geo = toGeometry(a);
      disposables.push(geo);
      group.add(new THREE.Mesh(geo, materials.get(Mat.METAL)!));
    }
  }

  // Signs: two atlases (horizontal / vertical) rendered additively.
  group.add(buildSigns(map.signs.filter((s) => s.kind !== "holo"), disposables));
  const holo = buildHolos(map.signs.filter((s) => s.kind === "holo"), disposables);
  group.add(holo.group);

  // Light glows (cheap "volumetric" halos).
  const glow = buildGlows(map, disposables, quality);
  group.add(glow);

  // Water.
  const waterMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: `${fogVert}
      varying vec3 vW;
      void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vec4 mvPosition=viewMatrix*w; gl_Position=projectionMatrix*mvPosition;
      ${THREE.ShaderChunk.fog_vertex}
      }`,
    fragmentShader: `${fogFrag}
      uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = vW.xz*0.15;
        float a = n(p + uTime*0.15) * n(p*2.3 - uTime*0.2);
        float lines = smoothstep(0.42,0.5,a) * (1.0 - smoothstep(0.5,0.58,a));
        float spark = step(0.995, h(floor(vW.xz*2.0) + floor(uTime*8.0)));
        vec3 col = vec3(0.01,0.03,0.06) + vec3(0.1,0.85,1.0)*lines*0.9 + vec3(0.7,0.95,1.0)*spark*1.5;
        gl_FragColor = vec4(col,1.0);
        ${THREE.ShaderChunk.fog_fragment}
      }
      `,
    fog: true,
  });
  disposables.push(waterMat);
  for (const w of map.water) {
    const g = new THREE.PlaneGeometry(w.maxX - w.minX, w.maxZ - w.minZ);
    g.rotateX(-Math.PI / 2);
    disposables.push(g);
    const m = new THREE.Mesh(g, waterMat);
    m.position.set((w.minX + w.maxX) / 2, w.level, (w.minZ + w.maxZ) / 2);
    group.add(m);
  }
  // Ocean beyond the bay.
  {
    const g = new THREE.PlaneGeometry(1400, 1400);
    g.rotateX(-Math.PI / 2);
    disposables.push(g);
    const m = new THREE.Mesh(g, waterMat);
    m.position.set(0, -2.5, 0);
    group.add(m);
  }

  // Sky, skyline, rain.
  const sky = buildSky(disposables);
  group.add(sky);
  const skyline = buildSkyline(disposables, quality);
  group.add(skyline);
  const rainView = rain ? buildRain(disposables, quality) : null;
  if (rainView) group.add(rainView.mesh);

  // Arena boundary (energy fence around the active district).
  let arena: THREE.Mesh | null = null;
  const setArena = (b: { minX: number; minZ: number; maxX: number; maxZ: number } | null) => {
    if (arena) {
      group.remove(arena);
      arena.geometry.dispose();
      arena = null;
    }
    if (!b) return;
    const a = newArrays();
    const h = 30;
    const t = 0.05;
    for (const box of [
      { minX: b.minX - t, maxX: b.maxX + t, minZ: b.minZ - t, maxZ: b.minZ + t },
      { minX: b.minX - t, maxX: b.maxX + t, minZ: b.maxZ - t, maxZ: b.maxZ + t },
      { minX: b.minX - t, maxX: b.minX + t, minZ: b.minZ, maxZ: b.maxZ },
      { minX: b.maxX - t, maxX: b.maxX + t, minZ: b.minZ, maxZ: b.maxZ },
    ])
      pushBox(a, { ...box, minY: -1, maxY: h, mat: Mat.BARRIER, color: 0xffffff, flags: 0 }, [6, 6]);
    arena = new THREE.Mesh(toGeometry(a), barrier);
    arena.renderOrder = 3;
    group.add(arena);
  };

  return {
    group,
    materials,
    setArena,
    update(t, cam) {
      barrier.uniforms.uTime!.value = t;
      waterMat.uniforms.uTime!.value = t;
      holo.update(t);
      sky.position.copy(cam);
      if (rainView) rainView.update(t, cam);
      (skyline.material as THREE.ShaderMaterial).uniforms.uCam!.value.copy(cam);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      arena?.geometry.dispose();
    },
  };
}

// ---------------------------------------------------------------------------

function faceBasis(face: number): { n: THREE.Vector3; r: THREE.Vector3 } {
  switch (face) {
    case 0:
      return { n: new THREE.Vector3(1, 0, 0), r: new THREE.Vector3(0, 0, -1) };
    case 1:
      return { n: new THREE.Vector3(-1, 0, 0), r: new THREE.Vector3(0, 0, 1) };
    case 2:
      return { n: new THREE.Vector3(0, 0, 1), r: new THREE.Vector3(1, 0, 0) };
    case 3:
      return { n: new THREE.Vector3(0, 0, -1), r: new THREE.Vector3(-1, 0, 0) };
    default:
      return { n: new THREE.Vector3(0, 1, 0), r: new THREE.Vector3(1, 0, 0) };
  }
}

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

function buildSigns(signs: Sign[], disposables: { dispose(): void }[]): THREE.Group {
  const out = new THREE.Group();
  for (const vertical of [false, true]) {
    const list = signs.filter((s) => (s.kind === "strip") === vertical);
    if (!list.length) continue;
    const cw = vertical ? 96 : 384;
    const ch = vertical ? 384 : 96;
    const keys = [...new Set(list.map((s) => `${s.text}|${s.color}`))];
    const cols = Math.floor(2048 / cw);
    const rows = Math.ceil(keys.length / cols);
    const H = Math.min(4096, THREE.MathUtils.ceilPowerOfTwo(rows * ch));
    const c = document.createElement("canvas");
    c.width = 2048;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 2048, H);
    const cell = new Map<string, [number, number]>();
    keys.forEach((k, i) => {
      const [text, color] = k.split("|") as [string, string];
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * ch;
      const t = textTexture(text, hex(Number(color)), { w: cw, h: ch, vertical });
      ctx.drawImage(t.image as HTMLCanvasElement, x, y);
      t.dispose();
      // Frame.
      ctx.strokeStyle = hex(Number(color));
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
      ctx.globalAlpha = 1;
      cell.set(k, [x, y]);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    disposables.push(tex);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const s of list) {
      const [cx, cy] = cell.get(`${s.text}|${s.color}`)!;
      const { n, r } = faceBasis(s.face);
      const up = new THREE.Vector3(0, 1, 0);
      const ctr = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(n, 0.03);
      const hw = s.w / 2;
      const hh = s.h / 2;
      const base = pos.length / 3;
      const corners = [
        ctr.clone().addScaledVector(r, -hw).addScaledVector(up, -hh),
        ctr.clone().addScaledVector(r, hw).addScaledVector(up, -hh),
        ctr.clone().addScaledVector(r, hw).addScaledVector(up, hh),
        ctr.clone().addScaledVector(r, -hw).addScaledVector(up, hh),
      ];
      for (const p of corners) pos.push(p.x, p.y, p.z);
      const u0 = cx / 2048;
      const u1 = (cx + cw) / 2048;
      const v0 = 1 - (cy + ch) / H;
      const v1 = 1 - cy / H;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    disposables.push(g);
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(2.2, 2.2, 2.2), side: THREE.DoubleSide });
    disposables.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 1;
    out.add(mesh);
  }
  return out;
}

function buildHolos(signs: Sign[], disposables: { dispose(): void }[]) {
  const group = new THREE.Group();
  const mats: THREE.ShaderMaterial[] = [];
  for (const s of signs) {
    const t = textTexture(s.text, hex(s.color), { w: 256, h: 512, vertical: s.h > s.w * 1.3 });
    disposables.push(t);
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: t }, uTime: { value: 0 }, uColor: { value: new THREE.Color(s.color) }, uSeed: { value: Math.random() * 10 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D uMap; uniform float uTime; uniform vec3 uColor; uniform float uSeed; varying vec2 vUv;
        void main(){
          vec2 uv=vUv; float g = step(0.97, fract(sin(floor(uTime*6.0+uSeed)*91.3)*437.5));
          uv.x += g*0.03*sin(uv.y*80.0);
          vec4 tx = texture2D(uMap, uv);
          float scan = 0.65 + 0.35*sin(uv.y*220.0 - uTime*6.0);
          float edge = smoothstep(0.0,0.08,uv.x)*smoothstep(1.0,0.92,uv.x);
          vec3 c = tx.rgb*1.8*scan + uColor*0.12*edge;
          float flick = 0.85+0.15*sin(uTime*23.0+uSeed);
          gl_FragColor = vec4(c*flick, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    mats.push(m);
    disposables.push(m);
    const g = new THREE.PlaneGeometry(s.w, s.h);
    disposables.push(g);
    const mesh = new THREE.Mesh(g, m);
    const { n } = faceBasis(s.face);
    mesh.position.set(s.x + n.x * 0.15, s.y, s.z + n.z * 0.15);
    mesh.lookAt(mesh.position.clone().add(n));
    group.add(mesh);
  }
  return { group, update: (t: number) => mats.forEach((m) => (m.uniforms.uTime!.value = t)) };
}

function buildGlows(map: MapData, disposables: { dispose(): void }[], quality: Quality): THREE.Points {
  const T = getTextures();
  const pos: number[] = [];
  const col: number[] = [];
  const size: number[] = [];
  const c = new THREE.Color();
  for (const l of map.lights) {
    pos.push(l.x, l.y, l.z);
    c.setHex(l.color);
    col.push(c.r, c.g, c.b);
    size.push(3 + l.intensity * 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
  disposables.push(g);
  const m = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: T.glow }, uScale: { value: window.innerHeight / 2 }, uStrength: { value: quality === "low" ? 0.6 : 0.85 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; varying float vF; uniform float uScale;
      void main(){
        vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
        float d = -mv.z;
        // Fade halos that are very close (they'd flood the screen) or very far.
        vF = smoothstep(3.0, 14.0, d) * (1.0 - smoothstep(140.0, 260.0, d));
        gl_PointSize = min(size*uScale/max(1.0,d), 220.0);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uStrength; varying vec3 vC; varying float vF;
      void main(){ vec4 t=texture2D(uMap, gl_PointCoord); gl_FragColor=vec4(vC*t.a*uStrength*1.3*vF, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  disposables.push(m);
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

function buildSky(disposables: { dispose(): void }[]): THREE.Mesh {
  const g = new THREE.SphereGeometry(900, 32, 16);
  const m = new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vD;
      float h(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453); }
      void main(){
        float y = vD.y;
        vec3 top = vec3(0.012,0.01,0.03);
        vec3 mid = vec3(0.06,0.02,0.10);
        vec3 hor = vec3(0.32,0.06,0.28);
        vec3 c = mix(hor, mid, smoothstep(-0.02,0.18,y));
        c = mix(c, top, smoothstep(0.18,0.7,y));
        // City glow at the horizon.
        c += vec3(0.6,0.15,0.5)*exp(-abs(y)*14.0)*0.5 + vec3(0.1,0.4,0.6)*exp(-abs(y-0.02)*30.0)*0.2;
        // Stars.
        vec3 sp = floor(vD*420.0);
        float s = step(0.9975, h(sp)) * smoothstep(0.15,0.5,y);
        c += vec3(s)*0.9;
        // Moon.
        vec3 md = normalize(vec3(0.45,0.38,-0.8));
        float d = dot(vD, md);
        c += vec3(0.9,0.85,1.0)*smoothstep(0.9993,0.9996,d) + vec3(0.3,0.2,0.5)*pow(max(d,0.0),300.0)*0.8;
        gl_FragColor = vec4(c,1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  disposables.push(g, m);
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function buildSkyline(disposables: { dispose(): void }[], quality: Quality): THREE.InstancedMesh {
  const n = quality === "low" ? 140 : 260;
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vW; varying vec3 vN; varying float vSeed;
      void main(){ vec4 w = modelMatrix*instanceMatrix*vec4(position,1.0); vW=w.xyz; vN=normal; vSeed=instanceMatrix[3].x*0.137+instanceMatrix[3].z*0.71; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uCam; varying vec3 vW; varying vec3 vN; varying float vSeed;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec3 base = vec3(0.025,0.022,0.045);
        vec3 c = base;
        if (abs(vN.y) < 0.5) {
          float u = abs(vN.x) > 0.5 ? vW.z : vW.x;
          vec2 cell = floor(vec2(u/2.6, vW.y/3.4));
          vec2 f = fract(vec2(u/2.6, vW.y/3.4));
          float win = step(0.18,f.x)*step(f.x,0.82)*step(0.25,f.y)*step(f.y,0.75);
          float r = h(cell + vSeed);
          float lit = step(0.62, r);
          vec3 wc = mix(vec3(1.0,0.75,0.45), vec3(0.4,0.9,1.0), step(0.85,r));
          wc = mix(wc, vec3(1.0,0.4,0.9), step(0.95,r));
          c += win*lit*wc*0.9;
        }
        float d = length(vW.xz - uCam.xz);
        float fog = 1.0 - exp(-d*0.0028);
        c = mix(c, vec3(0.09,0.03,0.12), clamp(fog,0.0,0.85));
        gl_FragColor = vec4(c,1.0);
      }`,
    toneMapped: false,
  });
  disposables.push(g, m);
  const mesh = new THREE.InstancedMesh(g, m, n);
  const mat = new THREE.Matrix4();
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 250 + rnd() * 330;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // Keep the bay side (south-east) more open.
    const h = (x > 100 && z > 100 ? 0.4 : 1) * (40 + rnd() * rnd() * 220);
    const w = 18 + rnd() * 30;
    const d = 18 + rnd() * 30;
    mat.compose(new THREE.Vector3(x, -3, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    mesh.setMatrixAt(i, mat);
  }
  mesh.frustumCulled = false;
  return mesh;
}

function buildRain(disposables: { dispose(): void }[], quality: Quality) {
  const n = quality === "high" ? 6000 : quality === "medium" ? 3500 : 1500;
  const pos = new Float32Array(n * 2 * 3);
  const top = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 60;
    const y = Math.random() * 30;
    const z = Math.random() * 60;
    pos.set([x, y, z, x, y, z], i * 6);
    top[i * 2] = 0;
    top[i * 2 + 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("top", new THREE.BufferAttribute(top, 1));
  disposables.push(g);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } },
    vertexShader: `attribute float top; uniform float uTime; uniform vec3 uCam; varying float vA;
      void main(){
        vec3 p = position;
        p.y = mod(p.y - uTime*22.0, 30.0);
        p.x = uCam.x + mod(p.x - uCam.x, 60.0) - 30.0;
        p.z = uCam.z + mod(p.z - uCam.z, 60.0) - 30.0;
        p.y += uCam.y - 12.0;
        p += vec3(0.35, 0.9, 0.1) * top;
        vA = 0.35 + 0.65*top;
        gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(0.55,0.7,1.0)*0.28*vA, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  disposables.push(m);
  const mesh = new THREE.LineSegments(g, m);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(t: number, cam: THREE.Vector3) {
      m.uniforms.uTime!.value = t;
      m.uniforms.uCam!.value.copy(cam);
    },
  };
}

/** Neon-tinted environment map so wet surfaces pick up colourful reflections. */
export function makeEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06040c);
  const add = (color: number, x: number, y: number, z: number, w: number, h: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  add(0xff2bd6, 8, 3, 2, 6, 3);
  add(0x22e5ff, -8, 2, -3, 5, 4);
  add(0xff8a1f, 2, 4, 9, 4, 2);
  add(0x9b5cff, -3, 6, 8, 8, 2);
  add(0x2a1040, 0, 12, 0, 30, 30);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.04);
  pm.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}
