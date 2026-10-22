import { useMemo } from "react";

/** Animated synthwave skyline used behind all menus (pure CSS/SVG). */
export function Backdrop() {
  const buildings = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out: { x: number; w: number; h: number; c: string; lit: number[] }[] = [];
    let x = 0;
    while (x < 1600) {
      const w = 30 + rnd() * 70;
      const h = 60 + rnd() * rnd() * 180;
      const lit: number[] = [];
      for (let i = 0; i < 14; i++) lit.push(rnd());
      out.push({ x, w, h, c: rnd() < 0.5 ? "#140d26" : "#0f0a1e", lit });
      x += w + rnd() * 6;
    }
    return out;
  }, []);
  return (
    <div className="backdrop" aria-hidden>
      <div className="sun" />
      <svg className="skyline" viewBox="0 0 1600 240" preserveAspectRatio="xMidYMax slice">
        {buildings.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={240 - b.h} width={b.w} height={b.h} fill={b.c} />
            <rect x={b.x} y={240 - b.h} width={b.w} height={2} fill={i % 3 === 0 ? "#ff2bd6" : i % 3 === 1 ? "#22e5ff" : "#9b5cff"} opacity={0.8} />
            {b.lit.map((l, j) =>
              l > 0.72 ? <rect key={j} x={b.x + 5 + (j % 3) * (b.w / 3.4)} y={240 - b.h + 10 + Math.floor(j / 3) * 14} width={4} height={6} fill={l > 0.93 ? "#22e5ff" : "#ffc68a"} opacity={0.75} /> : null,
            )}
          </g>
        ))}
      </svg>
      <div className="grid" />
    </div>
  );
}
