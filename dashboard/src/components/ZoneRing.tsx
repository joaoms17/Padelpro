"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

export function ZoneRing({
  attack, defense, transition,
}: {
  attack: number; defense: number; transition: number;
}) {
  const data = [
    { name: "Ataque",    value: Math.round(attack),     fill: "#16a34a" },
    { name: "Defesa",    value: Math.round(defense),    fill: "#dc2626" },
    { name: "Transição", value: Math.round(transition), fill: "#d97706" },
  ].filter((d) => d.value > 0);

  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
             innerRadius={40} outerRadius={60} paddingAngle={2}>
          {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
        </Pie>
        <Tooltip formatter={(v) => [`${v}%`]} />
        <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
