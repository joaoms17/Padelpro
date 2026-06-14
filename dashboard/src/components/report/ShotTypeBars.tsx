"use client";

import type { MatchReport } from "@/lib/api";

const SHOT_COLORS: Record<string, string> = {
  forehand:  "#00E0A4",
  backhand:  "#54A7FF",
  volley:    "#E8FF3D",
  smash:     "#FF7A59",
  bandeja:   "#FFB347",
  vibora:    "#D16FFF",
  serve:     "#7EE8FA",
  lob:       "#FFF176",
  other:     "#6B7280",
};

const SHOT_LABELS: Record<string, string> = {
  forehand:  "Direita",
  backhand:  "Esquerda",
  volley:    "Voleio",
  smash:     "Remate",
  bandeja:   "Bandeja",
  vibora:    "Víbora",
  serve:     "Serviço",
  lob:       "Globo",
  other:     "Outra",
};

const ORDER = ["forehand", "backhand", "volley", "smash", "bandeja", "vibora", "serve", "lob", "other"];

function playerLabel(report: MatchReport, pid: number): string {
  const p = report.players?.find((pl) => pl.player === pid);
  return p?.shirt_color ? `J${pid} · ${p.shirt_color}` : `J${pid}`;
}

export function ShotTypeBars({ report }: { report: MatchReport }) {
  const sc = report.shot_counts ?? {};

  const players = [1, 2, 3, 4]
    .map((pid) => {
      const counts = sc[`player_${pid}`] ?? {};
      const total = Object.values(counts).reduce((a: number, b) => a + (b as number), 0);
      return { pid, counts, total };
    })
    .filter((p) => p.total > 0);

  if (players.length === 0) return <div className="text-gray-400 text-sm">Sem pancadas.</div>;

  const usedTypes = ORDER.filter((t) => players.some((p) => (p.counts[t] ?? 0) > 0));

  return (
    <div className="space-y-5">
      {players.map(({ pid, counts, total }) => (
        <div key={pid} className="space-y-1.5">
          <div className="flex justify-between items-baseline">
            <span className="text-sm font-semibold text-gray-200">{playerLabel(report, pid)}</span>
            <span className="text-xs text-gray-500">{total} pancadas</span>
          </div>

          {/* Stacked bar */}
          <div className="flex h-4 rounded overflow-hidden gap-[1px] bg-gray-800">
            {usedTypes.map((t) => {
              const n = counts[t] ?? 0;
              if (n === 0) return null;
              const pct = (n / total) * 100;
              return (
                <div
                  key={t}
                  style={{ width: `${pct}%`, backgroundColor: SHOT_COLORS[t] }}
                  title={`${SHOT_LABELS[t]}: ${n} (${Math.round(pct)}%)`}
                  className="min-w-[2px] transition-all"
                />
              );
            })}
          </div>

          {/* Per-type breakdown */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {usedTypes.map((t) => {
              const n = counts[t] ?? 0;
              if (n === 0) return null;
              const pct = Math.round((n / total) * 100);
              return (
                <span key={t} className="text-[10px] text-gray-500 flex items-center gap-0.5">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: SHOT_COLORS[t] }}
                  />
                  {SHOT_LABELS[t]} <span className="text-gray-400 ml-0.5">{n}</span>
                  <span className="text-gray-600 ml-0.5">({pct}%)</span>
                </span>
              );
            })}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-gray-800">
        {usedTypes.map((t) => (
          <span key={t} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: SHOT_COLORS[t] }} />
            {SHOT_LABELS[t]}
          </span>
        ))}
      </div>
    </div>
  );
}
