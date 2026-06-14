"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { MatchReport } from "@/lib/api";

const FORMATION_LABELS: Record<string, string> = {
  both_net: "Ambos na rede",
  both_back: "Ambos no fundo",
  split_near_net: "1 sobe 1 atrás (perto)",
  split_far_net: "1 sobe 1 atrás (longe)",
  mixed: "Misto",
};

// brand / info / accent / orange / gray
const FORMATION_COLORS: Record<string, string> = {
  both_net: "#00E0A4",
  both_back: "#54A7FF",
  split_near_net: "#E8FF3D",
  split_far_net: "#FF7A59",
  mixed: "#6E8298",
};

interface Slice {
  key: string;
  name: string;
  value: number;
  fill: string;
}

export function FormationDonut({ report }: { report: MatchReport }) {
  const pct = report.formation_pct ?? {};

  const data: Slice[] = Object.keys(FORMATION_LABELS)
    .map((key) => ({
      key,
      name: FORMATION_LABELS[key],
      value: Math.round((pct[key] ?? 0) * 10) / 10,
      fill: FORMATION_COLORS[key],
    }))
    .filter((d) => d.value > 0);

  if (data.length === 0) {
    return <div className="text-gray-400 text-sm">Sem dados de formação.</div>;
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={58}
            outerRadius={88}
            paddingAngle={2}
            stroke="#07111F"
            strokeWidth={2}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number | string) => [`${v}%`, "do tempo"]}
            contentStyle={{
              background: "#0B1B2E",
              border: "1px solid #173654",
              borderRadius: 12,
              fontSize: 12,
            }}
            labelStyle={{ color: "#E9F4FA" }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 w-full">
        {data.map((d) => (
          <li key={d.key} className="flex items-center gap-2 text-sm">
            <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
            <span className="text-gray-300 flex-1">{d.name}</span>
            <span className="text-gray-200 font-semibold tabular-nums">{d.value}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
