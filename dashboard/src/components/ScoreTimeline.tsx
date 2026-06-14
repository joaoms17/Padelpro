"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface TimelinePoint {
  time_s: number;
  team1_games: number;
  team2_games: number;
}

interface Props {
  timeline: TimelinePoint[];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ScoreTimeline({ timeline }: Props) {
  if (timeline.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-4">Sem dados de pontuação.</p>;
  }

  const data = timeline.map((t) => ({
    time: formatTime(t.time_s),
    "Equipa 1": t.team1_games,
    "Equipa 2": t.team2_games,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="time"
          tick={{ fill: "#6b7280", fontSize: 11 }}
          interval={Math.floor(data.length / 6)}
        />
        <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1f2937",
            border: "1px solid #374151",
            borderRadius: "8px",
          }}
          labelStyle={{ color: "#d1d5db" }}
          itemStyle={{ color: "#9ca3af" }}
        />
        <Legend
          formatter={(value) => (
            <span style={{ color: "#9ca3af", fontSize: "12px" }}>{value}</span>
          )}
        />
        <Line
          type="stepAfter"
          dataKey="Equipa 1"
          stroke="#16a34a"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="stepAfter"
          dataKey="Equipa 2"
          stroke="#2563eb"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
