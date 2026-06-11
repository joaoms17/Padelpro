"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ProgressionPoint } from "@/lib/api";

interface Props {
  history: ProgressionPoint[];
  label: string;
  unit?: string;
  colour?: string;
}

export function ProgressionChart({ history, label, unit = "", colour = "#16a34a" }: Props) {
  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
        Sem dados ainda
      </div>
    );
  }

  const data = history.map((p) => ({
    date: new Date(p.measured_at).toLocaleDateString("pt-PT", { month: "short", day: "numeric" }),
    value: p.value,
    match_id: p.match_id,
  }));

  const fmt = (v: number) => `${v.toFixed(1)}${unit ? " " + unit : ""}`;

  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={fmt}
        />
        <Tooltip
          contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8 }}
          labelStyle={{ color: "#e5e7eb", fontSize: 12 }}
          formatter={(value: number) => [fmt(value), label]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={colour}
          strokeWidth={2}
          dot={{ r: 3, fill: colour }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
