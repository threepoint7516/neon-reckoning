import * as THREE from "three";
import { Rng } from "@neon/shared";

// All textures are generated on canvases at startup — no image assets.

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
  glow: THREE.Texture;
  smoke: THREE.Texture;
  spark: THREE.Texture;
}

let cached: TextureSet | null = null;

export function getTextures(): TextureSet {
  if (cached) return cached;
  const rng = new Rng(4242);

  // Concrete: mottled grey with stains and seams.
  const [cc, cx] = canvas(256, 256);
  noise(cx, 256, 256, 170, 40, rng, 2);
  for (let i = 0; i < 30; i++) {
    cx.fillStyle = `rgba(40,30,50,${rng.range(0.03, 0.12)})`;
    cx.beginPath();
    cx.ellipse(rng.range(0, 256), rng.range(0, 256), rng.range(10, 60), rng.range(10, 60), 0, 0, Math.PI * 2);
    cx.fill();
  }
  cx.fillStyle = "rgba(0,0,0,0.25)";
  cx.fillRect(0, 127, 256, 2);
  cx.fillRect(127, 0, 2, 256);

  // Metal: brushed with panel seams and rivets.
  const [mc, mx] = canvas(256, 256);
  noise(mx, 256, 256, 160, 30, rng, 1);
  for (let y = 0; y < 256; y += 2) {
    mx.fillStyle = `rgba(255,255,255,${rng.range(0, 0.05)})`;
    mx.fillRect(0, y, 256, 1);
  }
  mx.strokeStyle = "rgba(0,0,0,0.5)";
  mx.lineWidth = 2;
  mx.strokeRect(2, 2, 252, 252);
  mx.fillStyle = "rgba(0,0,0,0.4)";
  for (const [x, y] of [[10, 10], [246, 10], [10, 246], [246, 246], [128, 10], [128, 246]] as const) {
    mx.beginPath();
    mx.arc(x, y, 3, 0, Math.PI * 2);
    mx.fill();
  }

  // Facade: dark cladding with a window grid; emissive map lights random windows.
  const [fc, fx] = canvas(256, 256);
  const [ec, ex] = canvas(256, 256);
  noise(fx, 256, 256, 120, 20, rng, 4);
  ex.fillStyle = "#000";
  ex.fillRect(0, 0, 256, 256);
  const cols = 4;
  const rows = 4;
  const warm = ["#ffcf8a", "#ffb36b", "#8af3ff", "#ff8ad8", "#c8b8ff", "#fff1c8"];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c * 64 + 10;
      const y = r * 64 + 14;
      fx.fillStyle = "#1a1d28";
      fx.fillRect(x, y, 44, 36);
      fx.fillStyle = "rgba(120,140,180,0.25)";
      fx.fillRect(x, y, 44, 4);
      if (rng.chance(0.42)) {
        const col = rng.pick(warm);
        const g = ex.createLinearGradient(x, y, x, y + 36);
        g.addColorStop(0, col);
        g.addColorStop(1, "rgba(0,0,0,0.6)");
        ex.globalAlpha = rng.range(0.35, 1);
        ex.fillStyle = g;
        ex.fillRect(x, y, 44, 36);
        ex.globalAlpha = 1;
        // Blinds.
        ex.fillStyle = "rgba(0,0,0,0.35)";
        for (let b = 0; b < 36; b += 6) ex.fillRect(x, y + b, 44, 2);
      }
    }
  fx.fillStyle = "rgba(0,0,0,0.5)";
  for (let r = 0; r < rows; r++) fx.fillRect(0, r * 64 + 60, 256, 4);

  // Shipping container: corrugation.
  const [kc, kx] = canvas(256, 256);
  kx.fillStyle = "#b8b8b8";
  kx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    const g = kx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, "#8a8a8a");
    g.addColorStop(0.5, "#e0e0e0");
    g.addColorStop(1, "#8a8a8a");
    kx.fillStyle = g;
    kx.fillRect(x, 0, 16, 256);
  }
  kx.globalAlpha = 0.25;
  noise(kx, 256, 256, 128, 120, rng, 4);
  kx.globalAlpha = 1;
  kx.fillStyle = "rgba(60,20,10,0.35)";
  for (let i = 0; i < 8; i++) kx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(4, 30), rng.range(10, 80));

  // Wet asphalt.
  const [ac, ax] = canvas(256, 256);
  noise(ax, 256, 256, 90, 50, rng, 1);
  for (let i = 0; i < 12; i++) {
    ax.fillStyle = `rgba(20,20,30,${rng.range(0.1, 0.3)})`;
    ax.beginPath();
    ax.ellipse(rng.range(0, 256), rng.range(0, 256), rng.range(10, 50), rng.range(5, 25), rng.range(0, 3), 0, Math.PI * 2);
    ax.fill();
  }

  // Wood planks.
  const [wc, wx] = canvas(128, 128);
  for (let y = 0; y < 128; y += 16) {
    wx.fillStyle = `rgb(${150 + rng.range(-20, 20)},${120 + rng.range(-20, 20)},${90 + rng.range(-15, 15)})`;
    wx.fillRect(0, y, 128, 15);
    wx.fillStyle = "rgba(0,0,0,0.4)";
    wx.fillRect(0, y + 15, 128, 1);
  }
  wx.globalAlpha = 0.25;
  noise(wx, 128, 128, 128, 100, rng, 1);
  wx.globalAlpha = 1;

  // Dirt & rock.
  const [dc, dx] = canvas(128, 128);
  noise(dx, 128, 128, 140, 70, rng, 2);
  const [rc, rx] = canvas(128, 128);
  noise(rx, 128, 128, 150, 90, rng, 3);
  for (let i = 0; i < 20; i++) {
    rx.strokeStyle = "rgba(0,0,0,0.3)";
    rx.beginPath();
    rx.moveTo(rng.range(0, 128), rng.range(0, 128));
    rx.lineTo(rng.range(0, 128), rng.range(0, 128));
    rx.stroke();
  }

  // Sci-fi panels.
  const [pc, px] = canvas(256, 256);
  noise(px, 256, 256, 150, 20, rng, 2);
  px.strokeStyle = "rgba(0,0,0,0.45)";
  px.lineWidth = 3;
  px.strokeRect(4, 4, 120, 248);
  px.strokeRect(132, 4, 120, 120);
  px.strokeRect(132, 132, 120, 120);
  px.fillStyle = "rgba(255,255,255,0.12)";
  px.fillRect(20, 30, 80, 6);
  px.fillRect(150, 150, 30, 30);

  // Chain-link fence (alpha).
  const [nc, nx] = canvas(64, 64);
  nx.clearRect(0, 0, 64, 64);
  nx.strokeStyle = "rgba(200,210,230,1)";
  nx.lineWidth = 2.5;
  nx.beginPath();
  nx.moveTo(0, 0);
  nx.lineTo(64, 64);
  nx.moveTo(64, 0);
  nx.lineTo(0, 64);
  nx.moveTo(-32, 0);
  nx.lineTo(32, 64);
  nx.moveTo(32, 0);
  nx.lineTo(96, 64);
  nx.moveTo(96, 0);
  nx.lineTo(32, 64);
  nx.moveTo(32, 0);
  nx.lineTo(-32, 64);
  nx.stroke();

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
  const [sc, sx] = canvas(128, 128);
  for (let i = 0; i < 14; i++) {
    const r = rng.range(18, 40);
    const x = 64 + rng.range(-22, 22);
    const y = 64 + rng.range(-22, 22);
    const g = sx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    sx.fillStyle = g;
    sx.fillRect(0, 0, 128, 128);
  }

  // Spark (sharp point).
  const [pk, pkx] = canvas(32, 32);
  const sg = pkx.createRadialGradient(16, 16, 0, 16, 16, 16);
  sg.addColorStop(0, "rgba(255,255,255,1)");
  sg.addColorStop(0.3, "rgba(255,255,255,0.8)");
  sg.addColorStop(1, "rgba(255,255,255,0)");
  pkx.fillStyle = sg;
  pkx.fillRect(0, 0, 32, 32);

  cached = {
    concrete: tex(cc), metal: tex(mc), facade: tex(fc), facadeEmissive: tex(ec), container: tex(kc), asphalt: tex(ac), wood: tex(wc),
    dirt: tex(dc), panel: tex(pc), rock: tex(rc), fence: tex(nc), glow: tex(gc, true, false), smoke: tex(sc, true, false), spark: tex(pk, true, false),
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
