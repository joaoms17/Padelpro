"use client";

import { useMemo } from "react";
import type { MatchReport } from "@/lib/api";

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

interface Segment {
  kind: "rally" | "pause";
  start: number;
  end: number;
  pct: number;
}

export function RallyTimeline({ report }: { report: MatchReport }) {
  const duration = report.duration_s ?? 0;
  const rallies = report.rallies ?? [];
  const stats = report.rally_stats;

  const segments = useMemo<Segment[]>(() => {
    if (duration <= 0) return [];
    const sorted = [...rallies]
      .filter((r) => r.end_s > r.start_s)
      .sort((a, b) => a.start_s - b.start_s);

    const segs: Segment[] = [];
    let cursor = 0;
    for (const r of sorted) {
      const start = Math.max(0, Math.min(duration, r.start_s));
      const end = Math.max(0, Math.min(duration, r.end_s));
      if (start > cursor) {
        segs.push({ kind: "pause", start: cursor, end: start, pct: ((start - cursor) / duration) * 100 });
      }
      if (end > start) {
        segs.push({ kind: "rally", start, end, pct: ((end - start) / duration) * 100 });
        cursor = Math.max(cursor, end);
      }
    }
    if (cursor < duration) {
      segs.push({ kind: "pause", start: cursor, end: duration, pct: ((duration - cursor) / duration) * 100 });
    }
    return segs;
  }, [rallies, duration]);

  return (
    <div className="space-y-5">
      {/* Strip */}
      {segments.length > 0 ? (
        <div className="flex h-4 rounded-full overflow-hidden bg-navy-800 border border-gray-800">
          {segments.map((s, i) => (
            <div
              key={i}
              className={s.kind === "rally" ? "bg-brand" : "bg-navy-700"}
              style={{ width: `${s.pct}%` }}
              title={
                s.kind === "rally"
                  ? `Ponto ${formatTime(s.start)} – ${formatTime(s.end)}`
                  : `Pausa ${formatTime(s.start)} – ${formatTime(s.end)}`
              }
            />
          ))}
        </div>
      ) : (
        <div className="text-gray-400 text-sm">Sem dados de pontos.</div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Pontos" value={String(stats.total_rallies ?? 0)} />
          <Stat label="Duração média" value={`${(stats.avg_duration_s ?? 0).toFixed(1)}s`} />
          <Stat label="Tempo de jogo" value={formatTime(stats.total_play_time_s ?? 0)} />
          <Stat
            label="% tempo útil"
            value={`${Math.round(stats.play_time_pct ?? 0)}%`}
            highlight
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className={`text-2xl font-extrabold tabular-nums ${highlight ? "text-brand" : "text-gray-200"}`}>
        {value}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
