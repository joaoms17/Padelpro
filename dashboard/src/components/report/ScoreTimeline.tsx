"use client";

import { type MatchReport } from "@/lib/api";

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function ScoreBadge({
  time,
  s1,
  s2,
  isFirst,
}: {
  time: number;
  s1: number;
  s2: number;
  isFirst?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-[3.5rem]">
      <span className="text-xs font-mono text-gray-400 tabular-nums">
        {isFirst ? "início" : formatTime(time)}
      </span>
      <div className="flex flex-col items-center rounded-lg border border-white/10 bg-navy-800 px-3 py-2 gap-0.5">
        <span className="text-sm font-bold tabular-nums" style={{ color: "#00E0A4" }}>
          {s1}
        </span>
        <span className="text-xs text-gray-500">–</span>
        <span className="text-sm font-bold tabular-nums" style={{ color: "#54A7FF" }}>
          {s2}
        </span>
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div className="flex items-center self-center mt-5">
      <div className="h-px w-4 bg-white/20" />
    </div>
  );
}

export function ScoreTimeline({ report }: { report: MatchReport }) {
  const timeline = report.score_timeline ?? [];

  if (timeline.length === 0) {
    return <p className="text-sm text-gray-400">Sem linha de resultado.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-xs font-semibold mb-1">
        <span style={{ color: "#00E0A4" }}>Equipa 1</span>
        <span className="text-gray-500">/</span>
        <span style={{ color: "#54A7FF" }}>Equipa 2</span>
      </div>
      <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
        <ScoreBadge time={0} s1={0} s2={0} isFirst />
        {timeline.map((entry, i) => (
          <div key={i} className="flex items-stretch">
            <Connector />
            <ScoreBadge
              time={entry.t_s}
              s1={entry.team1_games}
              s2={entry.team2_games}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
