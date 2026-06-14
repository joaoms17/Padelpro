"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface Props {
  formationPct: Record<string, number>;
}

const FORMATION_LABELS: Record<string, string> = {
  both_net: "Ambos na rede",
  both_back: "Ambos atrás",
  t1_net_t2_back: "Eq1 rede / Eq2 atrás",
  t1_back_t2_net: "Eq1 atrás / Eq2 rede",
  mixed: "Misto",
};

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#d97706", "#7c3aed"];

export function FormationChart({ formationPct }: Props) {
  const data = Object.entries(formationPct)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({
      name: FORMATION_LABELS[key] || key,
      value,
    }));

  if (data.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-4">Sem dados de formação.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={3}
          dataKey="value"
          label={({ value }) => `${value}%`}
          labelLine={false}
        >
          {data.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => [`${value}%`, "Tempo"]}
          contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px" }}
          labelStyle={{ color: "#d1d5db" }}
          itemStyle={{ color: "#9ca3af" }}
        />
        <Legend
          formatter={(value) => <span style={{ color: "#9ca3af", fontSize: "12px" }}>{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
