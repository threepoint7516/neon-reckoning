import * as THREE from "three";
import { Mat, BoxFlag, REGION } from "@neon/shared";
import type { Box, MapData, MatId, Sign } from "@neon/shared";
import { getTextures, textTexture } from "./textures";
import type { Quality } from "../../state/settings";
import type { Lighting } from "./sky";

/** UV tile size in metres per material. */
const TILE: Partial<Record<MatId, [number, number]>> = {
  [Mat.CONCRETE]: [4, 4], [Mat.METAL]: [3, 3], [Mat.FACADE]: [8, 8], [Mat.CONTAINER]: [3, 2.6], [Mat.ASPHALT]: [10, 10],
  [Mat.GROUND]: [10, 10], [Mat.WOOD]: [2, 2], [Mat.DIRT]: [6, 6], [Mat.PANEL]: [4, 4], [Mat.ROCK]: [5, 5], [Mat.FENCE]: [2, 2],
  [Mat.TRIM]: [1, 1], [Mat.GLASS]: [2, 2], [Mat.NEON]: [1, 1], [Mat.BARRIER]: [6, 6], [Mat.BRICK]: [2.4, 1.2], [Mat.TILE]: [1.6, 1.6],
  [Mat.GRASS]: [3, 3], [Mat.LEAF]: [2, 2], [Mat.AWNING]: [1.6, 1.6], [Mat.PAINT]: [3, 3], [Mat.PAD]: [1.7, 1.7],
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
    const shade = n[1] === 1 ? 1.04 : n[0] !== 0 ? 0.95 : 1;
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
  materials: Map<MatId, THREE.Material>;
  update(t: number, cam: THREE.Vector3, light: Lighting): void;
  setArena(b: { minX: number; minZ: number; maxX: number; maxZ: number } | null): void;
  dispose(): void;
}

export function buildWorld(map: MapData, quality: Quality, envMap: THREE.Texture | null, shadows: boolean, rain: boolean): WorldView {
  const T = getTextures();
  const group = new THREE.Group();
  group.name = "world";
  const disposables: { dispose(): void }[] = [];

  // Cartoon look: toon shading with crisp light bands, bright vertex colours.
  const toon = (o: THREE.MeshToonMaterialParameters) => {
    const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: T.toon, ...o });
    disposables.push(m);
    return m;
  };
  const materials = new Map<MatId, THREE.Material>();
  materials.set(Mat.CONCRETE, toon({ map: T.concrete }));
  materials.set(Mat.METAL, toon({ map: T.metal }));
  const facade = toon({ map: T.facade, emissiveMap: T.facadeEmissive, emissive: new THREE.Color(1, 0.95, 0.85), emissiveIntensity: 0 });
  materials.set(Mat.FACADE, facade);
  materials.set(Mat.CONTAINER, toon({ map: T.container }));
  materials.set(Mat.ASPHALT, toon({ map: T.asphalt }));
  materials.set(Mat.GROUND, materials.get(Mat.ASPHALT)!);
  materials.set(Mat.WOOD, toon({ map: T.wood }));
  materials.set(Mat.DIRT, toon({ map: T.dirt }));
  materials.set(Mat.PANEL, toon({ map: T.panel }));
  materials.set(Mat.ROCK, toon({ map: T.rock }));
  materials.set(Mat.TRIM, toon({}));
  materials.set(Mat.BRICK, toon({ map: T.brick }));
  materials.set(Mat.TILE, toon({ map: T.tile }));
  materials.set(Mat.GRASS, toon({ map: T.grass }));
  materials.set(Mat.LEAF, toon({ map: T.leaf }));
  materials.set(Mat.AWNING, toon({ map: T.awning, side: THREE.DoubleSide }));
  materials.set(Mat.PAINT, toon({ map: T.paint }));
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2, envMap, depthWrite: false });
  materials.set(Mat.GLASS, glass);
  const fence = new THREE.MeshToonMaterial({ map: T.fence, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, gradientMap: T.toon });
  materials.set(Mat.FENCE, fence);
  const neon = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(1, 1, 1) });
  materials.set(Mat.NEON, neon);
  const barrier = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; uniform float uNight; varying vec3 vW;
      void main(){
        float u = (abs(fract(vW.x*0.25)-0.5) < 0.03 || abs(fract(vW.z*0.25)-0.5)<0.03) ? 1.0 : 0.0;
        float h = abs(fract(vW.y*0.25 - uTime*0.15)-0.5) < 0.02 ? 1.0 : 0.0;
        float fade = smoothstep(26.0, 0.0, vW.y);
        float a = (0.05 + 0.3*max(u,h)) * fade * (0.6 + 0.6*uNight);
        gl_FragColor = vec4(vec3(0.45,0.85,1.0)*a*1.6, a);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  materials.set(Mat.BARRIER, barrier);
  // Jump pads: bright discs with chevrons that pulse upward.
  const pad = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; varying vec3 vN; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vN=normal; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; varying vec3 vW; varying vec3 vN;
      void main(){
        vec2 c = fract(vW.xz / 1.7 + 0.5) - 0.5;
        float r = length(c);
        float ring = smoothstep(0.02,0.0,abs(fract(r*4.0 - uTime*1.5)-0.5)-0.18);
        vec3 base = mix(vec3(0.1,0.85,0.55), vec3(0.95,1.0,0.6), ring);
        if (vN.y < 0.5) base = vec3(0.15,0.7,0.5);
        gl_FragColor = vec4(base*1.3, 1.0);
      }`,
    toneMapped: false,
  });
  materials.set(Mat.PAD, pad);
  disposables.push(glass, fence, neon, barrier, pad);

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
    const mesh = new THREE.Mesh(geo, materials.get(mat) ?? materials.get(Mat.PAINT)!);
    mesh.matrixAutoUpdate = false;
    if (shadows && mat !== Mat.NEON && mat !== Mat.BARRIER && mat !== Mat.GLASS && mat !== Mat.PAD) {
      mesh.castShadow = mat !== Mat.GRASS && mat !== Mat.ASPHALT;
      mesh.receiveShadow = true;
    }
    if (mat === Mat.GLASS || mat === Mat.BARRIER) mesh.renderOrder = 2;
    group.add(mesh);
  }

  // Ladders: yellow rails and rungs.
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
      for (const u of [u0, u1]) pushBox(a, { ...rail(u), mat: Mat.METAL, color: 0xffca3a, flags: BoxFlag.DECOR }, [1, 1]);
      for (let y = l.minY + 0.3; y < top + 0.6; y += 0.35) {
        const rung = alongX
          ? { minX: u0, maxX: u1, minY: y, maxY: y + 0.05, minZ: mid - 0.03, maxZ: mid + 0.03 }
          : { minX: mid - 0.03, maxX: mid + 0.03, minY: y, maxY: y + 0.05, minZ: u0, maxZ: u1 };
        pushBox(a, { ...rung, mat: Mat.METAL, color: 0xffd166, flags: BoxFlag.DECOR }, [1, 1]);
      }
    }
    if (a.pos.length) {
      const geo = toGeometry(a);
      disposables.push(geo);
      group.add(new THREE.Mesh(geo, materials.get(Mat.METAL)!));
    }
  }

  const signs = buildSigns(map.signs.filter((s) => s.kind !== "holo"), disposables);
  group.add(signs.group);
  const holo = buildHolos(map.signs.filter((s) => s.kind === "holo"), disposables);
  group.add(holo.group);
  const glow = buildGlows(map, disposables, quality);
  group.add(glow);

  // Water: bright turquoise by day, deep blue with glints at night.
  const waterMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uNight: { value: 0 } }]),
    vertexShader: `${fogVert}
      varying vec3 vW;
      void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vec4 mvPosition=viewMatrix*w; gl_Position=projectionMatrix*mvPosition;
      ${THREE.ShaderChunk.fog_vertex}
      }`,
    fragmentShader: `${fogFrag}
      uniform float uTime; uniform float uNight; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = vW.xz*0.12;
        float a = n(p + uTime*0.12) * n(p*2.1 - uTime*0.15);
        float caustic = smoothstep(0.38,0.5,a) * (1.0 - smoothstep(0.5,0.62,a));
        float sparkle = step(0.996, h(floor(vW.xz*1.5) + floor(uTime*4.0)));
        vec3 day = vec3(0.12,0.72,0.82) + vec3(0.6,0.95,1.0)*caustic*0.35 + vec3(1.0)*sparkle*0.8;
        vec3 night = vec3(0.03,0.12,0.28) + vec3(0.3,0.7,1.0)*caustic*0.25 + vec3(0.7,0.9,1.0)*sparkle*0.6;
        gl_FragColor = vec4(mix(day, night, uNight),1.0);
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
  {
    const g = new THREE.PlaneGeometry(1400, 1400);
    g.rotateX(-Math.PI / 2);
    disposables.push(g);
    const m = new THREE.Mesh(g, waterMat);
    m.position.set(0, -2.5, 0);
    group.add(m);
  }

  const skyline = buildSkyline(disposables, quality);
  group.add(skyline);
  const rainView = rain ? buildRain(disposables, quality) : null;
  if (rainView) group.add(rainView.mesh);

  // Arena boundary (soft force field around the active district).
  let arena: THREE.Mesh | null = null;
  const setArena = (b: { minX: number; minZ: number; maxX: number; maxZ: number } | null) => {
    if (arena) {
      group.remove(arena);
      arena.geometry.dispose();
      arena = null;
    }
    if (!b) return;
    const a = newArrays();
    const t = 0.05;
    for (const box of [
      { minX: b.minX - t, maxX: b.maxX + t, minZ: b.minZ - t, maxZ: b.minZ + t },
      { minX: b.minX - t, maxX: b.maxX + t, minZ: b.maxZ - t, maxZ: b.maxZ + t },
      { minX: b.minX - t, maxX: b.minX + t, minZ: b.minZ, maxZ: b.maxZ },
      { minX: b.maxX - t, maxX: b.maxX + t, minZ: b.minZ, maxZ: b.maxZ },
    ])
      pushBox(a, { ...box, minY: -1, maxY: 30, mat: Mat.BARRIER, color: 0xffffff, flags: 0 }, [6, 6]);
    arena = new THREE.Mesh(toGeometry(a), barrier);
    arena.renderOrder = 3;
    group.add(arena);
  };

  const neonBase = new THREE.Color(1, 1, 1);
  return {
    group,
    materials,
    setArena,
    update(t, cam, light) {
      const night = light.night;
      barrier.uniforms.uTime!.value = t;
      barrier.uniforms.uNight!.value = night;
      pad.uniforms.uTime!.value = t;
      waterMat.uniforms.uTime!.value = t;
      waterMat.uniforms.uNight!.value = night;
      facade.emissiveIntensity = night * 1.25 + light.dusk * 0.3;
      neon.color.copy(neonBase).multiplyScalar(1 + night * 1.8);
      signs.setNight(night);
      holo.update(t, night);
      (glow.material as THREE.ShaderMaterial).uniforms.uNight!.value = night;
      if (rainView) rainView.update(t, cam);
      const sm = skyline.material as THREE.ShaderMaterial;
      sm.uniforms.uCam!.value.copy(cam);
      sm.uniforms.uNight!.value = night;
      sm.uniforms.uFog!.value.copy(light.horizon);
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

/** Shop signs: coloured boards with white lettering by day that glow at night. */
function buildSigns(signs: Sign[], disposables: { dispose(): void }[]) {
  const group = new THREE.Group();
  const mats: THREE.MeshBasicMaterial[] = [];
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
    const cell = new Map<string, [number, number]>();
    keys.forEach((k, i) => {
      const [text, color] = k.split("|") as [string, string];
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * ch;
      ctx.fillStyle = hex(Number(color));
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 6;
      ctx.strokeRect(x + 5, y + 5, cw - 10, ch - 10);
      const t = textTexture(text, "#ffffff", { w: cw, h: ch, vertical, glow: false });
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowOffsetY = 3;
      ctx.drawImage(t.image as HTMLCanvasElement, x, y);
      ctx.restore();
      t.dispose();
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
      const ctr = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(n, 0.04);
      const hw = s.w / 2;
      const hh = s.h / 2;
      const base = pos.length / 3;
      for (const p of [
        ctr.clone().addScaledVector(r, -hw).addScaledVector(up, -hh),
        ctr.clone().addScaledVector(r, hw).addScaledVector(up, -hh),
        ctr.clone().addScaledVector(r, hw).addScaledVector(up, hh),
        ctr.clone().addScaledVector(r, -hw).addScaledVector(up, hh),
      ])
        pos.push(p.x, p.y, p.z);
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
    const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false });
    disposables.push(m);
    mats.push(m);
    group.add(new THREE.Mesh(g, m));
  }
  return {
    group,
    setNight(night: number) {
      // Slightly toned down in daylight, glowing brighter (and blooming) at night.
      for (const m of mats) m.color.setScalar(0.92 + night * 0.9);
    },
  };
}

function buildHolos(signs: Sign[], disposables: { dispose(): void }[]) {
  const group = new THREE.Group();
  const mats: THREE.ShaderMaterial[] = [];
  for (const s of signs) {
    const t = textTexture(s.text, "#ffffff", { w: 256, h: 512, vertical: s.h > s.w * 1.3 });
    disposables.push(t);
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: t }, uTime: { value: 0 }, uColor: { value: new THREE.Color(s.color) }, uNight: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D uMap; uniform float uTime; uniform vec3 uColor; uniform float uNight; varying vec2 vUv;
        void main(){
          vec4 tx = texture2D(uMap, vUv);
          float scan = 0.8 + 0.2*sin(vUv.y*120.0 - uTime*4.0);
          vec3 c = mix(uColor, vec3(1.0), tx.a) ;
          float a = (0.55 + 0.45*tx.a) * scan;
          gl_FragColor = vec4(c * (1.0 + uNight*0.8), a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
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
  return {
    group,
    update: (t: number, night: number) =>
      mats.forEach((m) => {
        m.uniforms.uTime!.value = t;
        m.uniforms.uNight!.value = night;
      }),
  };
}

/** Warm halos around lamps & windows — only visible after dusk. */
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
    uniforms: { uMap: { value: T.glow }, uScale: { value: window.innerHeight / 2 }, uStrength: { value: quality === "low" ? 0.6 : 0.85 }, uNight: { value: 0 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; varying float vF; uniform float uScale;
      void main(){
        vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
        float d = -mv.z;
        vF = smoothstep(3.0, 14.0, d) * (1.0 - smoothstep(140.0, 260.0, d));
        gl_PointSize = min(size*uScale/max(1.0,d), 220.0);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uStrength; uniform float uNight; varying vec3 vC; varying float vF;
      void main(){ vec4 t=texture2D(uMap, gl_PointCoord); gl_FragColor=vec4(vC*t.a*uStrength*1.3*vF*uNight, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  disposables.push(m);
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

/** Distant pastel skyline; windows reflect the sky by day and light up at night. */
function buildSkyline(disposables: { dispose(): void }[], quality: Quality): THREE.InstancedMesh {
  const n = quality === "low" ? 140 : 260;
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uNight: { value: 0 }, uFog: { value: new THREE.Color(0xc4ecff) } },
    vertexShader: `varying vec3 vW; varying vec3 vN; varying float vSeed;
      void main(){ vec4 w = modelMatrix*instanceMatrix*vec4(position,1.0); vW=w.xyz; vN=normal; vSeed=instanceMatrix[3].x*0.137+instanceMatrix[3].z*0.71; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uCam; uniform float uNight; uniform vec3 uFog; varying vec3 vW; varying vec3 vN; varying float vSeed;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      void main(){
        float pick = h(vec2(vSeed, 3.1));
        vec3 pastel = mix(vec3(1.0,0.75,0.7), vec3(0.65,0.85,1.0), pick);
        pastel = mix(pastel, vec3(1.0,0.92,0.65), step(0.66, pick));
        vec3 base = mix(pastel, vec3(0.12,0.16,0.3), uNight);
        vec3 c = base * (abs(vN.y) > 0.5 ? 1.05 : abs(vN.x) > 0.5 ? 0.9 : 1.0);
        if (abs(vN.y) < 0.5) {
          float u = abs(vN.x) > 0.5 ? vW.z : vW.x;
          vec2 f = fract(vec2(u/2.6, vW.y/3.4));
          vec2 cell = floor(vec2(u/2.6, vW.y/3.4));
          float win = step(0.2,f.x)*step(f.x,0.8)*step(0.25,f.y)*step(f.y,0.75);
          float r = h(cell + vSeed);
          vec3 dayWin = vec3(0.7,0.88,1.0);
          vec3 nightWin = mix(vec3(1.0,0.82,0.5), vec3(0.6,0.9,1.0), step(0.85,r)) * step(0.55, r);
          c = mix(c, mix(dayWin, nightWin, uNight), win * (uNight > 0.5 ? 1.0 : 0.6));
        }
        float d = length(vW.xz - uCam.xz);
        float fog = 1.0 - exp(-d*0.0026);
        c = mix(c, uFog, clamp(fog,0.0,0.8));
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
    const h = (x > 100 && z > 100 ? 0.4 : 1) * (30 + rnd() * rnd() * 160);
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
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(0.7,0.8,1.0)*0.28*vA, 1.0); }`,
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

/** Soft sky environment so glass picks up bright reflections. */
export function makeEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd6ff);
  const add = (color: number, x: number, y: number, z: number, w: number, h: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  add(0xffffff, 0, 12, 0, 30, 30);
  add(0xffe8b0, 8, 3, 2, 8, 4);
  add(0x7ccf5a, 0, -8, 0, 30, 30);
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
