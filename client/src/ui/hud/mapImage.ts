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
  x.fillStyle = "#cbd9b8";
  x.fillRect(0, 0, w, h);
  for (const wr of map.water) {
    x.fillStyle = "#4cc9f0";
    x.fillRect((wr.minX - minX) * scale, (wr.minZ - minZ) * scale, (wr.maxX - wr.minX) * scale, (wr.maxZ - wr.minZ) * scale);
  }
  for (const r of map.roads) {
    x.fillStyle = "#8a93a3";
    x.fillRect((r.minX - minX) * scale, (r.minZ - minZ) * scale, (r.maxX - r.minX) * scale, (r.maxZ - r.minZ) * scale);
  }
  const boxes = [...map.boxes].filter((b) => !(b.flags & BoxFlag.DECOR) && b.mat !== Mat.BARRIER && b.maxY > 0.3).sort((a, b) => a.maxY - b.maxY);
  for (const b of boxes) {
    if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
    // Buildings keep their real (bright) colour; taller ones get a stronger outline.
    const hgt = Math.min(1, Math.max(0, b.maxY / 30));
    const rx = (b.minX - minX) * scale;
    const rz = (b.minZ - minZ) * scale;
    const rw = Math.max(1, (b.maxX - b.minX) * scale);
    const rh = Math.max(1, (b.maxZ - b.minZ) * scale);
    x.fillStyle = b.flags & BoxFlag.BULLET_PASS ? "rgba(255,255,255,0.6)" : `#${b.color.toString(16).padStart(6, "0")}`;
    x.fillRect(rx, rz, rw, rh);
    if (b.maxY > 2 && rw > 2 && rh > 2) {
      x.strokeStyle = `rgba(31,42,68,${0.2 + hgt * 0.5})`;
      x.lineWidth = 1;
      x.strokeRect(rx + 0.5, rz + 0.5, rw - 1, rh - 1);
    }
  }
  const img = { canvas: c, minX, minZ, scale };
  cache.set(key, img);
  return img;
}
