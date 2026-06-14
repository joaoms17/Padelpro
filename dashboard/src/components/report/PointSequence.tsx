"use client";

import type { MatchReport } from "@/lib/api";

export function PointSequence({ report }: { report: MatchReport }) {
  const rallies = report.rallies ?? [];
  if (rallies.length === 0) return null;

  let aWins = 0;
  let bWins = 0;
  for (const r of rallies) {
    if (r.winner_team === 1) aWins++;
    else if (r.winner_team === 2) bWins++;
  }

  // Group into "runs" for momentum context
  const runs: { team: number | null; start: number; len: number }[] = [];
  for (let i = 0; i < rallies.length; ) {
    const team = rallies[i].winner_team ?? null;
    let j = i;
    while (j < rallies.length && (rallies[j].winner_team ?? null) === team) j++;
    runs.push({ team, start: i, len: j - i });
    i = j;
  }
  const maxRun = Math.max(...runs.map((r) => r.len));

  return (
    <div className="space-y-3">
      {/* Totals row */}
      <div className="flex gap-6 text-sm">
        <span>
          <span className="font-semibold text-brand">Equipa A</span>
          <span className="ml-1.5 text-gray-400">{aWins} pts</span>
        </span>
        <span>
          <span className="font-semibold" style={{ color: "#FF7A59" }}>Equipa B</span>
          <span className="ml-1.5 text-gray-400">{bWins} pts</span>
        </span>
        {maxRun >= 3 && (
          <span className="text-gray-500 text-xs self-center">
            Maior série: {maxRun} pts seguidos
          </span>
        )}
      </div>

      {/* Strip */}
      <div className="flex flex-wrap gap-1">
        {rallies.map((r, i) => {
          const isA = r.winner_team === 1;
          const isB = r.winner_team === 2;
          return (
            <div
              key={i}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
              style={{
                backgroundColor: isA ? "#00E0A4" : isB ? "#FF7A59" : "#1F2937",
                color: isA || isB ? "#000" : "#6B7280",
              }}
              title={`Rally ${i + 1}: ${isA ? "Equipa A" : isB ? "Equipa B" : "?"} ganhou`}
            >
              {isA ? "A" : isB ? "B" : "·"}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand" />
          Equipa A ganhou
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#FF7A59" }} />
          Equipa B ganhou
        </span>
      </div>
    </div>
  );
}
