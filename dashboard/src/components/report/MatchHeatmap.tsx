"use client";

import { useMemo } from "react";
import type { MatchReport } from "@/lib/api";

// Players 1,2 = Equipa A (near / camera side); 3,4 = Equipa B (far side).
const TEAM_COLORS: Record<number, string> = {
  1: "#00E0A4",
  2: "#54A7FF",
  3: "#E8FF3D",
  4: "#FF7A59",
};

const COLS = 10;
const ROWS = 16;
const PAD = 18;
const COURT_W = 220;
const COURT_H = 340;
const SVG_W = COURT_W + PAD * 2;
const SVG_H = COURT_H + PAD * 2;

const GAUSS_SIGMA = 1.3; // smaller sigma → tighter blobs, less cross-team bleed

type PP = MatchReport["player_positions"][number];

function buildGrid(positions: PP[]): number[][] {
  const grid: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  for (const p of positions) {
    const cx = Math.min(0.999, Math.max(0, p.court_x));
    const cy = Math.min(0.999, Math.max(0, p.court_y));
    const gc = cx * COLS;
    const gr = cy * ROWS;
    const radius = Math.ceil(GAUSS_SIGMA * 3);
    for (let r = Math.max(0, Math.floor(gr) - radius); r <= Math.min(ROWS - 1, Math.floor(gr) + radius); r++) {
      for (let c = Math.max(0, Math.floor(gc) - radius); c <= Math.min(COLS - 1, Math.floor(gc) + radius); c++) {
        const dr = r + 0.5 - gr;
        const dc = c + 0.5 - gc;
        grid[r][c] += Math.exp(-(dr * dr + dc * dc) / (2 * GAUSS_SIGMA * GAUSS_SIGMA));
      }
    }
  }
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  if (max > 0) for (const row of grid) for (let c = 0; c < COLS; c++) row[c] /= max;
  return grid;
}

interface MiniCourtProps {
  title: string;
  players: { pid: number; label: string }[];
  grids: (number[][] | null)[];
  allColors: Record<number, string>;
}

function MiniCourt({ title, players, grids, allColors }: MiniCourtProps) {
  const cellW = COURT_W / COLS;
  const cellH = COURT_H / ROWS;
  const netY = PAD + COURT_H / 2;
  const serviceFrac = 6.95 / 10 / 2;
  const svcTopY = netY - COURT_H * serviceFrac;
  const svcBotY = netY + COURT_H * serviceFrac;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{title}</div>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full max-w-[200px] h-auto" role="img">
        {/* Court surface */}
        <rect x={PAD} y={PAD} width={COURT_W} height={COURT_H} rx={8} fill="#0B1B2E" stroke="#173654" strokeWidth={1.5} />

        {/* Heat cells for each player */}
        {players.map(({ pid }) => {
          const grid = grids[pid - 1];
          if (!grid) return null;
          const color = allColors[pid];
          return grid.map((rowVals, r) =>
            rowVals.map((v, c) => {
              if (v <= 0.03) return null;
              return (
                <rect
                  key={`p${pid}-${r}-${c}`}
                  x={PAD + c * cellW}
                  y={PAD + r * cellH}
                  width={cellW}
                  height={cellH}
                  fill={color}
                  opacity={Math.min(0.75, Math.pow(v, 0.6) * 0.75)}
                />
              );
            }),
          );
        })}

        {/* Service lines */}
        <line x1={PAD} y1={svcTopY} x2={PAD + COURT_W} y2={svcTopY} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
        <line x1={PAD} y1={svcBotY} x2={PAD + COURT_W} y2={svcBotY} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
        <line x1={PAD + COURT_W / 2} y1={svcTopY} x2={PAD + COURT_W / 2} y2={svcBotY} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />

        {/* Net */}
        <line x1={PAD} y1={netY} x2={PAD + COURT_W} y2={netY} stroke="#54A7FF" strokeWidth={2.5} strokeDasharray="6 4" />
        <text x={PAD + COURT_W / 2} y={netY - 5} textAnchor="middle" fontSize={9} fontWeight={700} letterSpacing={2} fill="#54A7FF">
          REDE
        </text>
      </svg>

      {/* Per-player legend */}
      <div className="flex gap-3">
        {players.map(({ pid, label }) => (
          <div key={pid} className="flex items-center gap-1 text-xs text-gray-400">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: allColors[pid] }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MatchHeatmap({ report }: { report: MatchReport }) {
  const positions = report.player_positions ?? [];

  const grids = useMemo(
    () => [1, 2, 3, 4].map((pid) => buildGrid(positions.filter((p) => p.player === pid))),
    [positions],
  );

  if (positions.length === 0) {
    return <div className="text-gray-400 text-sm">Sem dados de posição.</div>;
  }

  const getLabel = (pid: number) => {
    const p = report.players?.find((pl) => pl.player === pid);
    return p?.shirt_color ? `J${pid} (${p.shirt_color})` : `J${pid}`;
  };

  return (
    <div className="flex flex-col sm:flex-row gap-6 justify-center">
      <MiniCourt
        title="Equipa A (câmara)"
        players={[
          { pid: 1, label: getLabel(1) },
          { pid: 2, label: getLabel(2) },
        ]}
        grids={grids}
        allColors={TEAM_COLORS}
      />
      <MiniCourt
        title="Equipa B (fundo)"
        players={[
          { pid: 3, label: getLabel(3) },
          { pid: 4, label: getLabel(4) },
        ]}
        grids={grids}
        allColors={TEAM_COLORS}
      />
    </div>
  );
}
