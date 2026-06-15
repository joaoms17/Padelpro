"use client";

import { useMemo } from "react";
import type { MatchReport } from "@/lib/api";

// Zone → normalised court coordinates (mirrors gemini_match.py)
const ZONE_Y_NEAR: Record<string, number> = {
  // v3 system (3 zones)
  REDE: 0.40, MEIO: 0.44, FUNDO: 0.05,
  // v2 legacy (10 zones)
  ML1: 0.38, ML2: 0.41, ML3: 0.44,
  VL1: 0.27, VL2: 0.15,
  VF1: 0.05, VF2: 0.05, VF3: 0.05, VF4: 0.05, VF5: 0.05,
};
const ZONE_Y_FAR: Record<string, number> = {
  // v3 system (3 zones)
  REDE: 0.60, MEIO: 0.56, FUNDO: 0.95,
  // v2 legacy (10 zones)
  ML1: 0.62, ML2: 0.59, ML3: 0.56,
  VL1: 0.73, VL2: 0.85,
  VF1: 0.95, VF2: 0.95, VF3: 0.95, VF4: 0.95, VF5: 0.95,
};
const ZONE_X_VF: Record<string, number> = {
  VF1: 0.90, VF2: 0.70, VF3: 0.50, VF4: 0.30, VF5: 0.10,
};
const PLAYER_DEFAULT_X: Record<number, number> = { 1: 0.25, 2: 0.75, 3: 0.25, 4: 0.75 };
const FAR_PLAYERS = new Set([3, 4]);

function zoneToXY(zone: string, pid: number): [number, number] {
  const isFar = FAR_PLAYERS.has(pid);
  const zy = isFar ? ZONE_Y_FAR : ZONE_Y_NEAR;
  const y = zy[zone] ?? (isFar ? 0.75 : 0.25);
  const x = ZONE_X_VF[zone] ?? PLAYER_DEFAULT_X[pid] ?? 0.5;
  return [x, y];
}

const PLAYER_COLORS: Record<number, string> = {
  1: "#00E0A4",
  2: "#54A7FF",
  3: "#E8FF3D",
  4: "#FF7A59",
};

const PAD = 14;
const COURT_W = 160;
const COURT_H = 270;
const SVG_W = COURT_W + PAD * 2;
const SVG_H = COURT_H + PAD * 2;

interface MiniCourtProps {
  pid: number;
  label: string;
  dots: { x: number; y: number; type: string }[];
}

function MiniCourt({ pid, label, dots }: MiniCourtProps) {
  const color = PLAYER_COLORS[pid];
  const netY = PAD + COURT_H / 2;
  const svcFrac = 6.95 / 10 / 2;
  const svcTopY = netY - COURT_H * svcFrac;
  const svcBotY = netY + COURT_H * svcFrac;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="text-xs font-bold text-center" style={{ color }}>{label}</div>
      <div className="text-[10px] text-gray-500 text-center">{dots.length} pancadas</div>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full max-w-[130px] h-auto" role="img" aria-label={`Origem pancadas ${label}`}>
        {/* Court */}
        <rect x={PAD} y={PAD} width={COURT_W} height={COURT_H} rx={6} fill="#0B1B2E" stroke="#173654" strokeWidth={1.5} />
        {/* Court lines */}
        <line x1={PAD} y1={svcTopY} x2={PAD + COURT_W} y2={svcTopY} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        <line x1={PAD} y1={svcBotY} x2={PAD + COURT_W} y2={svcBotY} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        <line x1={PAD + COURT_W / 2} y1={svcTopY} x2={PAD + COURT_W / 2} y2={svcBotY} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        {/* Net */}
        <line x1={PAD} y1={netY} x2={PAD + COURT_W} y2={netY} stroke="#54A7FF" strokeWidth={2} strokeDasharray="5 4" />
        <text x={PAD + COURT_W / 2} y={netY - 4} textAnchor="middle" fontSize={7} fontWeight={700} letterSpacing={1.5} fill="#54A7FF">
          REDE
        </text>
        {/* Shot dots */}
        {dots.map(({ x, y }, i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={4.5}
            fill={color}
            opacity={0.7}
            stroke="#0B1B2E"
            strokeWidth={0.8}
          />
        ))}
        {/* No data placeholder */}
        {dots.length === 0 && (
          <text x={SVG_W / 2} y={SVG_H / 2} textAnchor="middle" fontSize={9} fill="#374151">
            sem dados
          </text>
        )}
      </svg>
    </div>
  );
}

export function ShotOriginMap({ report }: { report: MatchReport }) {
  const shots = report.shots ?? [];
  const withZone = shots.filter((s) => s.zone);

  const dotsByPlayer = useMemo(() => {
    const byPlayer: Record<number, { x: number; y: number; type: string }[]> = {
      1: [], 2: [], 3: [], 4: [],
    };
    for (const s of withZone) {
      const pid = s.player;
      if (!(pid in byPlayer) || !s.zone) continue;
      const [cx, cy] = zoneToXY(s.zone, pid);
      byPlayer[pid].push({
        x: PAD + cx * COURT_W,
        y: PAD + cy * COURT_H,
        type: s.type,
      });
    }
    return byPlayer;
  }, [withZone]);

  // Show component even if zone data is sparse — MiniCourt shows "sem dados"
  const hasAny = shots.length > 0;
  if (!hasAny) return null;

  const getLabel = (pid: number) => {
    const p = report.players?.find((pl) => pl.player === pid);
    return p?.shirt_color ? `J${pid} · ${p.shirt_color}` : `J${pid}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Equipa A — câmara</div>
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map((pid) => (
            <MiniCourt key={pid} pid={pid} label={getLabel(pid)} dots={dotsByPlayer[pid]} />
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Equipa B — fundo</div>
        <div className="grid grid-cols-2 gap-4">
          {[3, 4].map((pid) => (
            <MiniCourt key={pid} pid={pid} label={getLabel(pid)} dots={dotsByPlayer[pid]} />
          ))}
        </div>
      </div>
      <p className="text-[10px] text-gray-600">
        Cada ponto = zona de execução da pancada conforme identificada pelo Gemini.
      </p>
    </div>
  );
}
