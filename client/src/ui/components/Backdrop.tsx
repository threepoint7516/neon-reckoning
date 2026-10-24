import { useMemo } from "react";

/** Sunny menu backdrop: drifting clouds, a colourful town and green hills (pure CSS/SVG). */
export function Backdrop() {
  const town = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cols = ["#ff8a80", "#ffd166", "#7bdff2", "#b2f7ef", "#8fd3a8", "#ffb4a2", "#95d5b2", "#f7a072", "#80cbe8"];
    const out: { x: number; w: number; h: number; c: string; roof: boolean }[] = [];
    let x = 0;
    while (x < 1600) {
      const w = 40 + rnd() * 70;
      const h = 50 + rnd() * rnd() * 170;
      out.push({ x, w, h, c: cols[Math.floor(rnd() * cols.length)]!, roof: rnd() < 0.35 });
      x += w + 4 + rnd() * 10;
    }
    return out;
  }, []);
  const clouds = useMemo(
    () => [
      { top: 10, w: 180, h: 46, dur: 70, delay: -10 },
      { top: 22, w: 120, h: 32, dur: 55, delay: -40 },
      { top: 6, w: 240, h: 56, dur: 90, delay: -65 },
      { top: 30, w: 150, h: 38, dur: 75, delay: -20 },
    ],
    [],
  );
  return (
    <div className="backdrop" aria-hidden>
      <div className="stars" />
      <div className="sun" />
      {clouds.map((c, i) => (
        <div key={i} className="cloud" style={{ top: `${c.top}%`, width: c.w, height: c.h, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} />
      ))}
      <svg className="skyline" viewBox="0 0 1600 240" preserveAspectRatio="xMidYMax slice">
        {town.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={240 - b.h} width={b.w} height={b.h} rx={6} fill={b.c} stroke="#1f2a44" strokeWidth={3} />
            {b.roof && <polygon points={`${b.x - 4},${240 - b.h} ${b.x + b.w / 2},${240 - b.h - 26} ${b.x + b.w + 4},${240 - b.h}`} fill="#ff595e" stroke="#1f2a44" strokeWidth={3} strokeLinejoin="round" />}
            {Array.from({ length: Math.floor(b.h / 34) }).map((_, j) => (
              <rect key={j} x={b.x + b.w / 2 - 10} y={240 - b.h + 12 + j * 34} width={20} height={16} rx={3} fill={(i + j) % 3 ? "#ffd56b" : "#2b3a5c"} stroke="#1f2a44" strokeWidth={2} />
            ))}
          </g>
        ))}
      </svg>
      <div className="hills" />
    </div>
  );
}
