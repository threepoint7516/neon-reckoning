import * as THREE from "three";
import { Rng } from "@neon/shared";

// All textures are generated on canvases at startup — no image assets.
// Base textures are light patterns; per-box vertex colours supply the hue.

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, base: number, amp: number, rng: Rng, size = 1): void {
  for (let y = 0; y < h; y += size)
    for (let x = 0; x < w; x += size) {
      const v = Math.max(0, Math.min(255, base + (rng.next() - 0.5) * amp));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, size, size);
    }
}

export interface TextureSet {
  concrete: THREE.Texture;
  metal: THREE.Texture;
  facade: THREE.Texture;
  facadeEmissive: THREE.Texture;
  container: THREE.Texture;
  asphalt: THREE.Texture;
  wood: THREE.Texture;
  dirt: THREE.Texture;
  panel: THREE.Texture;
  rock: THREE.Texture;
  fence: THREE.Texture;
  brick: THREE.Texture;
  tile: THREE.Texture;
  grass: THREE.Texture;
  leaf: THREE.Texture;
  awning: THREE.Texture;
  paint: THREE.Texture;
  glow: THREE.Texture;
  smoke: THREE.Texture;
  spark: THREE.Texture;
  toon: THREE.Texture;
}

let cached: TextureSet | null = null;

export function getTextures(): TextureSet {
  if (cached) return cached;
  const rng = new Rng(4242);

  // Concrete: soft, light, a few stains.
  const [cc, cx] = canvas(256, 256);
  noise(cx, 256, 256, 222, 22, rng, 2);
  for (let i = 0; i < 18; i++) {
    cx.fillStyle = `rgba(120,110,100,${rng.range(0.03, 0.08)})`;
    cx.beginPath();
    cx.ellipse(rng.range(0, 256), rng.range(0, 256), rng.range(10, 50), rng.range(10, 50), 0, 0, Math.PI * 2);
    cx.fill();
  }
  cx.fillStyle = "rgba(0,0,0,0.12)";
  cx.fillRect(0, 127, 256, 2);
  cx.fillRect(127, 0, 2, 256);

  // Metal: brushed, light, panel seams.
  const [mc, mx] = canvas(256, 256);
  noise(mx, 256, 256, 210, 18, rng, 1);
  for (let y = 0; y < 256; y += 2) {
    mx.fillStyle = `rgba(255,255,255,${rng.range(0, 0.08)})`;
    mx.fillRect(0, y, 256, 1);
  }
  mx.strokeStyle = "rgba(0,0,0,0.22)";
  mx.lineWidth = 2;
  mx.strokeRect(2, 2, 252, 252);

  // Facade: plaster with white-framed, sky-reflecting windows; emissive map
  // lights a random subset of them warmly at night.
  const [fc, fx] = canvas(256, 256);
  const [ec, ex] = canvas(256, 256);
  noise(fx, 256, 256, 232, 12, rng, 4);
  ex.fillStyle = "#000";
  ex.fillRect(0, 0, 256, 256);
  const warm = ["#ffd59a", "#ffc070", "#fff0c8", "#ffe2a8", "#bfe8ff", "#ffb0d0"];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const x = c * 64 + 12;
      const y = r * 64 + 14;
      fx.fillStyle = "#ffffff";
      fx.fillRect(x - 4, y - 4, 48, 44);
      const g = fx.createLinearGradient(x, y, x + 40, y + 36);
      g.addColorStop(0, "#d6f0ff");
      g.addColorStop(0.5, "#8ec8f2");
      g.addColorStop(1, "#b9e0ff");
      fx.fillStyle = g;
      fx.fillRect(x, y, 40, 36);
      fx.fillStyle = "rgba(255,255,255,0.7)";
      fx.fillRect(x + 4, y + 4, 10, 3);
      fx.fillStyle = "#ffffff";
      fx.fillRect(x + 19, y, 2, 36);
      if (rng.chance(0.55)) {
        ex.globalAlpha = rng.range(0.55, 1);
        ex.fillStyle = rng.pick(warm);
        ex.fillRect(x, y, 40, 36);
        ex.globalAlpha = 1;
        ex.fillStyle = "rgba(0,0,0,0.25)";
        ex.fillRect(x + 19, y, 2, 36);
      }
    }
  fx.fillStyle = "rgba(0,0,0,0.08)";
  for (let r = 0; r < 4; r++) fx.fillRect(0, r * 64 + 60, 256, 3);

  // Container: corrugation.
  const [kc, kx] = canvas(256, 256);
  for (let x = 0; x < 256; x += 16) {
    const g = kx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, "#c8c8c8");
    g.addColorStop(0.5, "#ffffff");
    g.addColorStop(1, "#c8c8c8");
    kx.fillStyle = g;
    kx.fillRect(x, 0, 16, 256);
  }

  // Asphalt: mid grey with speckles.
  const [ac, ax] = canvas(256, 256);
  noise(ax, 256, 256, 196, 40, rng, 1);

  // Wood planks (light).
  const [wc, wx] = canvas(128, 128);
  for (let y = 0; y < 128; y += 16) {
    const v = 225 + rng.range(-15, 15);
    wx.fillStyle = `rgb(${v},${v - 8},${v - 20})`;
    wx.fillRect(0, y, 128, 15);
    wx.fillStyle = "rgba(90,60,30,0.35)";
    wx.fillRect(0, y + 15, 128, 1);
    for (let k = 0; k < 3; k++) {
      wx.fillStyle = "rgba(120,80,40,0.12)";
      wx.fillRect(rng.range(0, 128), y + rng.range(2, 12), rng.range(10, 40), 1);
    }
  }

  // Dirt & rock.
  const [dc, dx] = canvas(128, 128);
  noise(dx, 128, 128, 210, 40, rng, 2);
  const [rc, rx] = canvas(128, 128);
  noise(rx, 128, 128, 205, 45, rng, 4);

  // Panels.
  const [pc, px] = canvas(256, 256);
  noise(px, 256, 256, 228, 10, rng, 2);
  px.strokeStyle = "rgba(0,0,0,0.18)";
  px.lineWidth = 3;
  px.strokeRect(4, 4, 120, 248);
  px.strokeRect(132, 4, 120, 120);
  px.strokeRect(132, 132, 120, 120);

  // Fence: wooden slats with gaps (alpha).
  const [nc, nx] = canvas(64, 64);
  nx.clearRect(0, 0, 64, 64);
  nx.fillStyle = "rgba(255,255,255,1)";
  for (let x = 2; x < 64; x += 16) nx.fillRect(x, 0, 10, 64);
  nx.fillRect(0, 10, 64, 6);
  nx.fillRect(0, 44, 64, 6);

  // Brick.
  const [bc, bx] = canvas(256, 256);
  bx.fillStyle = "#f2ebe4";
  bx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 16; row++) {
    const off = row % 2 ? 16 : 0;
    for (let col = -1; col < 8; col++) {
      const v = 215 + rng.range(-25, 25);
      bx.fillStyle = `rgb(${v},${v - 10},${v - 14})`;
      bx.fillRect(col * 32 + off + 2, row * 16 + 2, 28, 12);
    }
  }

  // Tiles.
  const [tc, tx] = canvas(128, 128);
  tx.fillStyle = "#ffffff";
  tx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 32)
    for (let x = 0; x < 128; x += 32) {
      const v = 238 + rng.range(-12, 10);
      tx.fillStyle = `rgb(${v},${v},${v})`;
      tx.fillRect(x + 1, y + 1, 30, 30);
    }

  // Grass: blades of green-ish light noise.
  const [gc2, gx2] = canvas(128, 128);
  noise(gx2, 128, 128, 225, 30, rng, 2);
  for (let i = 0; i < 300; i++) {
    gx2.fillStyle = `rgba(255,255,255,${rng.range(0.1, 0.3)})`;
    gx2.fillRect(rng.range(0, 128), rng.range(0, 128), 1, rng.range(3, 7));
  }

  // Leaves: blobby clusters.
  const [lc, lx] = canvas(128, 128);
  lx.fillStyle = "#d8d8d8";
  lx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) {
    const r = rng.range(6, 16);
    const x = rng.range(0, 128);
    const y = rng.range(0, 128);
    const g = lx.createRadialGradient(x, y - r * 0.3, 1, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(170,170,170,0.0)");
    lx.fillStyle = g;
    lx.beginPath();
    lx.arc(x, y, r, 0, Math.PI * 2);
    lx.fill();
  }

  // Awning stripes (white + tint).
  const [sc2, sx2] = canvas(128, 128);
  for (let x = 0; x < 128; x += 32) {
    sx2.fillStyle = "#ffffff";
    sx2.fillRect(x, 0, 16, 128);
    sx2.fillStyle = "#e6e6e6";
    sx2.fillRect(x + 16, 0, 16, 128);
  }

  // Painted plaster (almost flat).
  const [qc, qx] = canvas(128, 128);
  noise(qx, 128, 128, 240, 8, rng, 4);

  // Radial glow sprite.
  const [gc, gx] = canvas(128, 128);
  const gg = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gg.addColorStop(0, "rgba(255,255,255,1)");
  gg.addColorStop(0.2, "rgba(255,255,255,0.55)");
  gg.addColorStop(0.5, "rgba(255,255,255,0.12)");
  gg.addColorStop(1, "rgba(255,255,255,0)");
  gx.fillStyle = gg;
  gx.fillRect(0, 0, 128, 128);

  // Smoke puff.
  const [smc, smx] = canvas(128, 128);
  for (let i = 0; i < 14; i++) {
    const r = rng.range(18, 40);
    const x = 64 + rng.range(-22, 22);
    const y = 64 + rng.range(-22, 22);
    const g = smx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    smx.fillStyle = g;
    smx.fillRect(0, 0, 128, 128);
  }

  // Spark (sharp point).
  const [pk, pkx] = canvas(32, 32);
  const sg = pkx.createRadialGradient(16, 16, 0, 16, 16, 16);
  sg.addColorStop(0, "rgba(255,255,255,1)");
  sg.addColorStop(0.3, "rgba(255,255,255,0.8)");
  sg.addColorStop(1, "rgba(255,255,255,0)");
  pkx.fillStyle = sg;
  pkx.fillRect(0, 0, 32, 32);

  // Toon ramp: 4 crisp tones for the cartoon look.
  const toonData = new Uint8Array([110, 110, 110, 255, 175, 175, 175, 255, 225, 225, 225, 255, 255, 255, 255, 255]);
  const toon = new THREE.DataTexture(toonData, 4, 1, THREE.RGBAFormat);
  toon.minFilter = toon.magFilter = THREE.NearestFilter;
  toon.generateMipmaps = false;
  toon.needsUpdate = true;

  cached = {
    concrete: tex(cc), metal: tex(mc), facade: tex(fc), facadeEmissive: tex(ec), container: tex(kc), asphalt: tex(ac), wood: tex(wc),
    dirt: tex(dc), panel: tex(pc), rock: tex(rc), fence: tex(nc), brick: tex(bc), tile: tex(tc), grass: tex(gc2), leaf: tex(lc),
    awning: tex(sc2), paint: tex(qc), glow: tex(gc, true, false), smoke: tex(smc, true, false), spark: tex(pk, true, false), toon,
  };
  return cached;
}

/** Text texture for signs, name tags and labels. */
export function textTexture(text: string, color: string, o: { w?: number; h?: number; font?: string; bg?: string; vertical?: boolean; glow?: boolean } = {}): THREE.CanvasTexture {
  const w = o.w ?? 512;
  const h = o.h ?? 128;
  const [c, x] = canvas(w, h);
  if (o.bg) {
    x.fillStyle = o.bg;
    x.fillRect(0, 0, w, h);
  }
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillStyle = color;
  if (o.glow !== false) {
    x.shadowColor = color;
    x.shadowBlur = h * 0.18;
  }
  if (o.vertical) {
    const chars = text.replace(/\s+/g, "").slice(0, 9).split("");
    const fs = Math.min(w * 0.7, (h * 0.92) / chars.length);
    x.font = `900 ${fs}px "Segoe UI", system-ui, sans-serif`;
    chars.forEach((ch, i) => x.fillText(ch, w / 2, (h - chars.length * fs) / 2 + fs * (i + 0.5)));
  } else {
    let fs = h * 0.62;
    x.font = o.font ?? `900 ${fs}px "Segoe UI", system-ui, sans-serif`;
    while (x.measureText(text).width > w * 0.92 && fs > 8) {
      fs -= 2;
      x.font = `900 ${fs}px "Segoe UI", system-ui, sans-serif`;
    }
    x.fillText(text, w / 2, h / 2 + 2);
  }
  const t = tex(c, true, false);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
