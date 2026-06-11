"use client";

/**
 * Renders a 20×10 court heatmap as a CSS grid.
 * Values are normalised [0, 1] — hot colours = high occupancy.
 */
export function HeatmapGrid({ grid }: { grid: number[][] }) {
  if (!grid || grid.length === 0) return <div className="text-gray-400 text-sm">Sem dados</div>;

  return (
    <div className="relative">
      {/* Court outline */}
      <div
        className="grid border border-white/30 rounded overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(${grid[0].length}, 1fr)`,
          gridTemplateRows:    `repeat(${grid.length}, 1fr)`,
          width: "100%",
          aspectRatio: "1 / 2",
        }}
      >
        {grid.map((row, r) =>
          row.map((val, c) => (
            <div
              key={`${r}-${c}`}
              style={{ backgroundColor: heatColour(val), opacity: 0.85 + val * 0.15 }}
            />
          ))
        )}
      </div>
      {/* Net line */}
      <div className="absolute left-0 right-0 border-t-2 border-cyan-400/70" style={{ top: "50%" }} />
      <div className="absolute -bottom-5 left-0 right-0 flex justify-between text-[10px] text-gray-400">
        <span>Esq</span>
        <span>Dir</span>
      </div>
    </div>
  );
}

function heatColour(v: number): string {
  // black → dark red → orange → yellow → white
  const stops: [number, [number, number, number]][] = [
    [0,    [15,  15,  30]],
    [0.25, [120, 20,  20]],
    [0.5,  [200, 80,  0]],
    [0.75, [230, 180, 0]],
    [1,    [255, 255, 200]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1];
    const [t1, c1] = stops[i];
    if (v <= t1) {
      const t = (v - t0) / (t1 - t0);
      const r = Math.round(c0[0] + t * (c1[0] - c0[0]));
      const g = Math.round(c0[1] + t * (c1[1] - c0[1]));
      const b = Math.round(c0[2] + t * (c1[2] - c0[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(255,255,200)";
}
