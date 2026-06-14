"use client";

import type { MatchReport } from "@/lib/api";

function parseHHMMSS(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function fmtMin(t: string): string {
  const s = parseHHMMSS(t);
  if (s === 0) return "0s";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m${sec > 0 ? ` ${sec}s` : ""}` : `${sec}s`;
}

const PHASE_COLORS = {
  ATAQUE: "#00E0A4",
  TRANSIÇÃO: "#E8FF3D",
  DEFESA: "#FF7A59",
} as const;

const PHASE_LABELS: Record<string, string> = {
  ATAQUE: "Ataque",
  TRANSIÇÃO: "Transição",
  DEFESA: "Defesa",
};

export function PhaseBreakdown({ report }: { report: MatchReport }) {
  const resumo = report.resumo;
  if (!resumo?.tempo_por_fase) return null;

  const teams: Array<{ key: "A" | "B"; label: string }> = [
    { key: "A", label: "Equipa A" },
    { key: "B", label: "Equipa B" },
  ];

  return (
    <div className="space-y-4">
      {teams.map(({ key, label }) => {
        const phases = resumo.tempo_por_fase[key];
        const total = parseHHMMSS(phases.ATAQUE) + parseHHMMSS(phases.TRANSIÇÃO) + parseHHMMSS(phases.DEFESA);

        return (
          <div key={key} className="rounded-xl bg-[#0B1B2E] border border-gray-800 p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-200">{label}</div>

            {/* Bar */}
            <div className="flex h-3 rounded-full overflow-hidden bg-gray-800">
              {(["ATAQUE", "TRANSIÇÃO", "DEFESA"] as const).map((phase) => {
                const s = parseHHMMSS(phases[phase]);
                const pct = total > 0 ? (s / total) * 100 : 0;
                if (pct < 0.5) return null;
                return (
                  <div
                    key={phase}
                    style={{ width: `${pct}%`, backgroundColor: PHASE_COLORS[phase] }}
                    title={`${PHASE_LABELS[phase]}: ${fmtMin(phases[phase])} (${Math.round(pct)}%)`}
                  />
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(["ATAQUE", "TRANSIÇÃO", "DEFESA"] as const).map((phase) => {
                const s = parseHHMMSS(phases[phase]);
                const pct = total > 0 ? Math.round((s / total) * 100) : 0;
                return (
                  <div key={phase} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PHASE_COLORS[phase] }} />
                    <span>{PHASE_LABELS[phase]}</span>
                    <span className="text-gray-500">{fmtMin(phases[phase])} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {resumo.duracao_util && (
        <div className="text-xs text-gray-500 text-right">
          Tempo útil: <span className="text-gray-400">{resumo.duracao_util}</span>
          {resumo.total_rallies > 0 && (
            <span className="ml-3">Rallies: <span className="text-gray-400">{resumo.total_rallies}</span></span>
          )}
        </div>
      )}
    </div>
  );
}
