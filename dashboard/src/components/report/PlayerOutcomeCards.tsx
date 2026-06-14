"use client";

import { useMemo } from "react";
import type { MatchReport } from "@/lib/api";

const PLAYER_COLORS = ["#00E0A4", "#54A7FF", "#E8FF3D", "#FF7A59"];

const OUTCOME_LABELS: Record<string, string> = {
  winner: "Vencedor",
  unforced_error: "Erro não forçado",
  forced_error: "Erro forçado",
  let: "Let",
  continuation: "Continuação",
};

interface PlayerStats {
  player: number;
  total: number;
  winner: number;
  unforced_error: number;
  forced_error: number;
  continuation: number;
  winnerPct: number;
  errorPct: number;
}

export function PlayerOutcomeCards({ report }: { report: MatchReport }) {
  const shots = report.shots ?? [];

  const stats = useMemo<PlayerStats[]>(() => {
    const map: Record<number, Record<string, number>> = {};
    for (const s of shots) {
      const p = s.player;
      if (!map[p]) map[p] = {};
      const o = s.outcome || "continuation";
      map[p][o] = (map[p][o] || 0) + 1;
    }
    return [1, 2, 3, 4].map((p) => {
      const counts = map[p] || {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const winner = counts["winner"] || 0;
      const unforced = counts["unforced_error"] || 0;
      const forced = counts["forced_error"] || 0;
      const continuation = counts["continuation"] || 0;
      return {
        player: p,
        total,
        winner,
        unforced_error: unforced,
        forced_error: forced,
        continuation,
        winnerPct: total > 0 ? Math.round((winner / total) * 100) : 0,
        errorPct: total > 0 ? Math.round(((unforced + forced) / total) * 100) : 0,
      };
    });
  }, [shots]);

  const hasData = stats.some((s) => s.total > 0);
  if (!hasData) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => {
        const color = PLAYER_COLORS[s.player - 1];
        if (s.total === 0) return null;
        return (
          <div key={s.player} className="rounded-xl bg-[#0B1B2E] border border-gray-800 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <div>
                <span className="text-sm font-semibold text-gray-100">J{s.player}</span>
                {report.players?.find((p) => p.player === s.player)?.shirt_color && (
                  <span className="ml-1 text-xs text-gray-500">
                    ({report.players!.find((p) => p.player === s.player)!.shirt_color})
                  </span>
                )}
              </div>
            </div>

            <div className="text-xs text-gray-500">{s.total} pancadas</div>

            {/* Winner / error bar */}
            <div className="space-y-1.5">
              <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-800">
                <div className="bg-[#00E0A4]" style={{ width: `${s.winnerPct}%` }} title={`${s.winnerPct}% vencedores`} />
                <div className="bg-[#FF7A59]" style={{ width: `${s.errorPct}%` }} title={`${s.errorPct}% erros`} />
              </div>
              <div className="flex justify-between text-[10px] text-gray-500">
                <span style={{ color: "#00E0A4" }}>✓ {s.winner} ({s.winnerPct}%)</span>
                <span style={{ color: "#FF7A59" }}>✗ {s.unforced_error + s.forced_error} ({s.errorPct}%)</span>
              </div>
            </div>

            {/* Breakdown */}
            <div className="space-y-0.5 text-xs text-gray-400">
              {s.winner > 0 && (
                <div className="flex justify-between">
                  <span>Vencedores</span>
                  <span className="font-medium text-[#00E0A4]">{s.winner}</span>
                </div>
              )}
              {s.unforced_error > 0 && (
                <div className="flex justify-between">
                  <span>Erros n.f.</span>
                  <span className="font-medium text-[#FF7A59]">{s.unforced_error}</span>
                </div>
              )}
              {s.forced_error > 0 && (
                <div className="flex justify-between">
                  <span>Erros forçados</span>
                  <span className="font-medium text-orange-400">{s.forced_error}</span>
                </div>
              )}
              {s.continuation > 0 && (
                <div className="flex justify-between">
                  <span>Continuação</span>
                  <span className="font-medium text-gray-400">{s.continuation}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
