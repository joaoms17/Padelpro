"use client";

import { useMemo } from "react";
import type { MatchReport } from "@/lib/api";

const PLAYER_COLORS = ["#00E0A4", "#54A7FF", "#E8FF3D", "#FF7A59"];

// Court drawing area (the playable rectangle), inside an SVG with padding.
const COLS = 12;
const ROWS = 18;
const PAD = 24;
const COURT_W = 300;
const COURT_H = 440;
const SVG_W = COURT_W + PAD * 2;
const SVG_H = COURT_H + PAD * 2;

type PlayerPosition = MatchReport["player_positions"][number];

const GAUSS_SIGMA = 1.8; // Gaussian spread in cells — makes sparse data render as blobs

/** Build a COLS×ROWS density grid (0..1) for a single player's positions. */
function buildGrid(positions: PlayerPosition[]): number[][] {
  const grid: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));

  for (const p of positions) {
    const cx = Math.min(0.999, Math.max(0, p.court_x));
    const cy = Math.min(0.999, Math.max(0, p.court_y));
    const gc = cx * COLS; // fractional column
    const gr = cy * ROWS; // fractional row

    const radius = Math.ceil(GAUSS_SIGMA * 3);
    const r0 = Math.max(0, Math.floor(gr) - radius);
    const r1 = Math.min(ROWS - 1, Math.floor(gr) + radius);
    const c0 = Math.max(0, Math.floor(gc) - radius);
    const c1 = Math.min(COLS - 1, Math.floor(gc) + radius);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dr = r + 0.5 - gr;
        const dc = c + 0.5 - gc;
        grid[r][c] += Math.exp(-(dr * dr + dc * dc) / (2 * GAUSS_SIGMA * GAUSS_SIGMA));
      }
    }
  }

  let max = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] > max) max = grid[r][c];

  if (max > 0)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        grid[r][c] /= max;

  return grid;
}

export function MatchHeatmap({ report }: { report: MatchReport }) {
  const positions = report.player_positions ?? [];

  const grids = useMemo(() => {
    return [1, 2, 3, 4].map((pid) =>
      buildGrid(positions.filter((p) => p.player === pid)),
    );
  }, [positions]);

  const cellW = COURT_W / COLS;
  const cellH = COURT_H / ROWS;

  // Court line geometry (service line at ITF 6.95 m of a 10 m half-court).
  const netY = PAD + COURT_H / 2;
  const serviceFrac = 6.95 / 10 / 2; // fraction of full court depth from net
  const svcTopY = netY - COURT_H * serviceFrac;
  const svcBotY = netY + COURT_H * serviceFrac;

  if (positions.length === 0) {
    return <div className="text-gray-400 text-sm">Sem dados de posição.</div>;
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full max-w-[340px] h-auto"
        role="img"
        aria-label="Mapa de calor do campo"
      >
        {/* Court surface */}
        <rect
          x={PAD}
          y={PAD}
          width={COURT_W}
          height={COURT_H}
          rx={10}
          fill="#0B1B2E"
          stroke="#173654"
          strokeWidth={2}
        />

        {/* Density cells, per player */}
        {grids.map((grid, pi) =>
          grid.map((rowVals, r) =>
            rowVals.map((v, c) => {
              if (v <= 0.02) return null;
              return (
                <rect
                  key={`p${pi}-${r}-${c}`}
                  x={PAD + c * cellW}
                  y={PAD + r * cellH}
                  width={cellW}
                  height={cellH}
                  fill={PLAYER_COLORS[pi]}
                  opacity={Math.min(0.7, Math.pow(v, 0.7) * 0.7)}
                />
              );
            }),
          ),
        )}

        {/* Service lines */}
        <line x1={PAD} y1={svcTopY} x2={PAD + COURT_W} y2={svcTopY} stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />
        <line x1={PAD} y1={svcBotY} x2={PAD + COURT_W} y2={svcBotY} stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />
        {/* Centre service line (between net and each service line) */}
        <line x1={PAD + COURT_W / 2} y1={svcTopY} x2={PAD + COURT_W / 2} y2={svcBotY} stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />

        {/* Net */}
        <line
          x1={PAD}
          y1={netY}
          x2={PAD + COURT_W}
          y2={netY}
          stroke="#54A7FF"
          strokeWidth={3}
          strokeDasharray="8 5"
        />
        <text
          x={PAD + COURT_W / 2}
          y={netY - 6}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          letterSpacing={2}
          fill="#54A7FF"
        >
          REDE
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
        {PLAYER_COLORS.map((color, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            Jogador {i + 1}
          </div>
        ))}
      </div>
    </div>
  );
}
