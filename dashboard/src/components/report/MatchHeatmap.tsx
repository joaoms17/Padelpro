"use client";

import { useMemo } from "react";
import type { MatchReport } from "@/lib/api";

// Players 1,2 = Equipa A (near / camera side); 3,4 = Equipa B (far side).
const PLAYER_COLORS: Record<number, string> = {
  1: "#00E0A4",
  2: "#54A7FF",
  3: "#E8FF3D",
  4: "#FF7A59",
};

const COLS = 8;
const ROWS = 14;
const PAD = 14;
const COURT_W = 180;
const COURT_H = 290;
const SVG_W = COURT_W + PAD * 2;
const SVG_H = COURT_H + PAD * 2;

const GAUSS_SIGMA = 1.2;

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

interface PlayerCourtProps {
  pid: number;
  label: string;
  team: string;
  grid: number[][];
  count: number;
}

function PlayerCourt({ pid, label, team, grid, count }: PlayerCourtProps) {
  const color = PLAYER_COLORS[pid];
  const cellW = COURT_W / COLS;
  const cellH = COURT_H / ROWS;
  const netY = PAD + COURT_H / 2;
  const serviceFrac = 6.95 / 10 / 2;
  const svcTopY = netY - COURT_H * serviceFrac;
  const svcBotY = netY + COURT_H * serviceFrac;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="text-center">
        <div className="text-xs font-bold" style={{ color }}>{label}</div>
        <div className="text-[10px] text-gray-500">{team} · {count} pos.</div>
      </div>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full max-w-[140px] h-auto" role="img" aria-label={`Heatmap ${label}`}>
        {/* Court */}
        <rect x={PAD} y={PAD} width={COURT_W} height={COURT_H} rx={6} fill="#0B1B2E" stroke="#173654" strokeWidth={1.5} />

        {/* Heat cells */}
        {grid.map((rowVals, r) =>
          rowVals.map((v, c) => {
            if (v <= 0.03) return null;
            return (
              <rect
                key={`${r}-${c}`}
                x={PAD + c * cellW}
                y={PAD + r * cellH}
                width={cellW}
                height={cellH}
                fill={color}
                opacity={Math.min(0.8, Math.pow(v, 0.55) * 0.8)}
              />
            );
          }),
        )}

        {/* Court lines */}
        <line x1={PAD} y1={svcTopY} x2={PAD + COURT_W} y2={svcTopY} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
        <line x1={PAD} y1={svcBotY} x2={PAD + COURT_W} y2={svcBotY} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
        <line x1={PAD + COURT_W / 2} y1={svcTopY} x2={PAD + COURT_W / 2} y2={svcBotY} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />

        {/* Net */}
        <line x1={PAD} y1={netY} x2={PAD + COURT_W} y2={netY} stroke="#54A7FF" strokeWidth={2} strokeDasharray="5 4" />
        <text x={PAD + COURT_W / 2} y={netY - 4} textAnchor="middle" fontSize={7} fontWeight={700} letterSpacing={1.5} fill="#54A7FF">
          REDE
        </text>
      </svg>
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
    return p?.shirt_color ? `J${pid} · ${p.shirt_color}` : `J${pid}`;
  };

  const TEAM_LABEL: Record<number, string> = { 1: "Equipa A", 2: "Equipa A", 3: "Equipa B", 4: "Equipa B" };

  return (
    <div className="space-y-4">
      {/* Equipa A: J1 and J2 */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Equipa A — câmara</div>
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map((pid) => (
            <PlayerCourt
              key={pid}
              pid={pid}
              label={getLabel(pid)}
              team={TEAM_LABEL[pid]}
              grid={grids[pid - 1]}
              count={positions.filter((p) => p.player === pid).length}
            />
          ))}
        </div>
      </div>

      {/* Equipa B: J3 and J4 */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Equipa B — fundo</div>
        <div className="grid grid-cols-2 gap-4">
          {[3, 4].map((pid) => (
            <PlayerCourt
              key={pid}
              pid={pid}
              label={getLabel(pid)}
              team={TEAM_LABEL[pid]}
              grid={grids[pid - 1]}
              count={positions.filter((p) => p.player === pid).length}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
