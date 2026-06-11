"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { STROKE_LABELS } from "@/lib/utils";

const COLOURS = ["#16a34a","#2563eb","#dc2626","#d97706","#7c3aed","#0891b2","#6b7280"];

export function ShotChart({ shots }: { shots: Record<string, number> }) {
  const data = Object.entries(STROKE_LABELS).map(([key, label]) => ({
    name: label,
    count: shots[key] ?? 0,
    key,
  })).filter((d) => d.count > 0);

  if (data.length === 0) return <div className="text-gray-400 text-sm">Sem pancadas</div>;

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 40 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip formatter={(v) => [v, "pancadas"]} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={COLOURS[i % COLOURS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
