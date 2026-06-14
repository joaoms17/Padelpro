"use client";

import { useMemo } from "react";
import type { MatchReport } from "@/lib/api";

function playerLabel(report: MatchReport, playerNum: number): string {
  const p = report.players?.find((pl) => pl.player === playerNum);
  return p?.shirt_color ? `J${playerNum} (${p.shirt_color})` : `Jogador ${playerNum}`;
}

// Type order + PT-PT labels.
const SHOT_LABELS: Record<string, string> = {
  forehand: "Direita",
  backhand: "Esquerda",
  volley: "Voleio",
  smash: "Remate",
  bandeja: "Bandeja",
  vibora: "Víbora",
  serve: "Serviço",
  lob: "Globo",
  other: "Outra",
};

const PLAYERS = ["player_1", "player_2", "player_3", "player_4"] as const;

export function ShotCountsTable({ report }: { report: MatchReport }) {
  const shotCounts = report.shot_counts ?? {};

  const { rows, colTotals, grandTotal } = useMemo(() => {
    const get = (player: string, type: string): number => shotCounts[player]?.[type] ?? 0;

    const rows = Object.keys(SHOT_LABELS)
      .map((type) => {
        const counts = PLAYERS.map((p) => get(p, type));
        const total = counts.reduce((a, b) => a + b, 0);
        return { type, label: SHOT_LABELS[type], counts, total };
      })
      .filter((r) => r.total > 0);

    const colTotals = PLAYERS.map((_, i) => rows.reduce((a, r) => a + r.counts[i], 0));
    const grandTotal = colTotals.reduce((a, b) => a + b, 0);

    return { rows, colTotals, grandTotal };
  }, [shotCounts]);

  if (rows.length === 0) {
    return <div className="text-gray-400 text-sm">Sem pancadas detetadas.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-gray-500 text-xs uppercase tracking-wide">
            <th className="text-left font-medium py-2 pr-3">Pancada</th>
            {PLAYERS.map((_, i) => (
              <th key={i} className="text-right font-medium py-2 px-3 whitespace-nowrap">
                {playerLabel(report, i + 1)}
              </th>
            ))}
            <th className="text-right font-semibold py-2 pl-3 text-gray-400">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowMax = Math.max(...row.counts);
            return (
              <tr key={row.type} className="border-t border-gray-800">
                <td className="py-2 pr-3 text-gray-200 font-medium whitespace-nowrap">{row.label}</td>
                {row.counts.map((c, i) => (
                  <td
                    key={i}
                    className={`py-2 px-3 text-right tabular-nums ${
                      c > 0 && c === rowMax
                        ? "text-brand font-bold bg-brand/5 rounded"
                        : c > 0
                          ? "text-gray-300"
                          : "text-gray-600"
                    }`}
                  >
                    {c}
                  </td>
                ))}
                <td className="py-2 pl-3 text-right tabular-nums text-gray-200 font-semibold">{row.total}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-700">
            <td className="py-2 pr-3 text-gray-400 font-semibold uppercase text-xs tracking-wide">Total</td>
            {colTotals.map((t, i) => (
              <td key={i} className="py-2 px-3 text-right tabular-nums text-gray-200 font-semibold">{t}</td>
            ))}
            <td className="py-2 pl-3 text-right tabular-nums text-brand font-extrabold">{grandTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
