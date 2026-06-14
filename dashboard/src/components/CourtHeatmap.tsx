"use client";

interface Position {
  court_x: number;
  court_y: number;
  player: number;
}

interface Props {
  positions: Position[];
  playerColors: string[];
}

const GRID_X = 20;
const GRID_Y = 10;
const COURT_W = 300;
const COURT_H = 400;
const PADDING = 20;

export function CourtHeatmap({ positions, playerColors }: Props) {
  // Build density grids per player
  const grids: Record<number, number[][]> = {};
  for (let p = 1; p <= 4; p++) {
    grids[p] = Array.from({ length: GRID_Y }, () => new Array(GRID_X).fill(0));
  }

  let maxCount = 1;
  for (const pos of positions) {
    const p = pos.player;
    if (p < 1 || p > 4) continue;
    const gx = Math.min(GRID_X - 1, Math.floor(pos.court_x * GRID_X));
    const gy = Math.min(GRID_Y - 1, Math.floor(pos.court_y * GRID_Y));
    grids[p][gy][gx]++;
    if (grids[p][gy][gx] > maxCount) maxCount = grids[p][gy][gx];
  }

  const cellW = COURT_W / GRID_X;
  const cellH = COURT_H / GRID_Y;

  const svgW = COURT_W + PADDING * 2;
  const svgH = COURT_H + PADDING * 2;

  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="rounded-lg overflow-hidden"
      >
        {/* Court background */}
        <rect
          x={PADDING}
          y={PADDING}
          width={COURT_W}
          height={COURT_H}
          fill="#166534"
          stroke="white"
          strokeWidth="2"
        />

        {/* Heatmap cells */}
        {[1, 2, 3, 4].map((player) => {
          const color = playerColors[player - 1] || "#ffffff";
          return grids[player].map((row, gy) =>
            row.map((count, gx) => {
              if (count === 0) return null;
              const opacity = Math.min(0.85, (count / maxCount) * 0.85 + 0.1);
              return (
                <rect
                  key={`${player}-${gy}-${gx}`}
                  x={PADDING + gx * cellW}
                  y={PADDING + gy * cellH}
                  width={cellW}
                  height={cellH}
                  fill={color}
                  opacity={opacity}
                />
              );
            })
          );
        })}

        {/* Court lines */}
        {/* Outer boundary */}
        <rect
          x={PADDING}
          y={PADDING}
          width={COURT_W}
          height={COURT_H}
          fill="none"
          stroke="white"
          strokeWidth="2"
        />

        {/* Net line at 50% */}
        <line
          x1={PADDING}
          y1={PADDING + COURT_H / 2}
          x2={PADDING + COURT_W}
          y2={PADDING + COURT_H / 2}
          stroke="white"
          strokeWidth="2"
        />

        {/* Service boxes — top half */}
        {/* Top horizontal service line at 25% */}
        <line
          x1={PADDING}
          y1={PADDING + COURT_H * 0.25}
          x2={PADDING + COURT_W}
          y2={PADDING + COURT_H * 0.25}
          stroke="white"
          strokeWidth="1"
          strokeOpacity="0.7"
        />
        {/* Vertical center line top half */}
        <line
          x1={PADDING + COURT_W / 2}
          y1={PADDING}
          x2={PADDING + COURT_W / 2}
          y2={PADDING + COURT_H / 2}
          stroke="white"
          strokeWidth="1"
          strokeOpacity="0.7"
        />

        {/* Service boxes — bottom half */}
        {/* Bottom horizontal service line at 75% */}
        <line
          x1={PADDING}
          y1={PADDING + COURT_H * 0.75}
          x2={PADDING + COURT_W}
          y2={PADDING + COURT_H * 0.75}
          stroke="white"
          strokeWidth="1"
          strokeOpacity="0.7"
        />
        {/* Vertical center line bottom half */}
        <line
          x1={PADDING + COURT_W / 2}
          y1={PADDING + COURT_H / 2}
          x2={PADDING + COURT_W / 2}
          y2={PADDING + COURT_H}
          stroke="white"
          strokeWidth="1"
          strokeOpacity="0.7"
        />

        {/* Net label */}
        <text
          x={PADDING + COURT_W / 2}
          y={PADDING + COURT_H / 2 - 6}
          textAnchor="middle"
          fill="white"
          fontSize="10"
          opacity="0.6"
        >
          REDE
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 justify-center">
        {[1, 2, 3, 4].map((player) => (
          <div key={player} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: playerColors[player - 1] || "#fff" }}
            />
            <span className="text-xs text-gray-400">Jogador {player}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
