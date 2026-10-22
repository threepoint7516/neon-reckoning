import { getFrontierMap, Mat, BoxFlag } from "@neon/shared";

export interface MapImage {
  canvas: HTMLCanvasElement;
  minX: number;
  minZ: number;
  scale: number; // pixels per metre
}

const cache = new Map<string, MapImage>();

/** Top-down render of the collision geometry, shaded by height. */
export function mapImage(minX: number, minZ: number, maxX: number, maxZ: number, scale: number): MapImage {
  const key = `${minX},${minZ},${maxX},${maxZ},${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map = getFrontierMap();
  const w = Math.ceil((maxX - minX) * scale);
  const h = Math.ceil((maxZ - minZ) * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.fillStyle = "#0a0816";
  x.fillRect(0, 0, w, h);
  for (const wr of map.water) {
    x.fillStyle = "#06223a";
    x.fillRect((wr.minX - minX) * scale, (wr.minZ - minZ) * scale, (wr.maxX - wr.minX) * scale, (wr.maxZ - wr.minZ) * scale);
  }
  for (const r of map.roads) {
    x.fillStyle = "#1c1830";
    x.fillRect((r.minX - minX) * scale, (r.minZ - minZ) * scale, (r.maxX - r.minX) * scale, (r.maxZ - r.minZ) * scale);
  }
  const boxes = [...map.boxes].filter((b) => !(b.flags & BoxFlag.DECOR) && b.mat !== Mat.BARRIER && b.maxY > 0.3).sort((a, b) => a.maxY - b.maxY);
  for (const b of boxes) {
    if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
    const hgt = Math.min(1, Math.max(0, b.maxY / 30));
    const l = 22 + hgt * 48;
    x.fillStyle = b.flags & BoxFlag.BULLET_PASS ? "rgba(140,160,200,0.5)" : `hsl(258, 30%, ${l}%)`;
    x.fillRect((b.minX - minX) * scale, (b.minZ - minZ) * scale, Math.max(1, (b.maxX - b.minX) * scale), Math.max(1, (b.maxZ - b.minZ) * scale));
  }
  const img = { canvas: c, minX, minZ, scale };
  cache.set(key, img);
  return img;
}
