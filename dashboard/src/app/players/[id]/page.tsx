"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getProgression, type ProgressionPoint } from "@/lib/api";
import { ProgressionChart } from "@/components/ProgressionChart";

const PLAYER_COLOURS = ["#16a34a", "#2563eb", "#dc2626", "#d97706"];

const METRICS: Array<{ key: string; label: string; unit: string; scale?: number }> = [
  { key: "distance_m",     label: "Distância percorrida", unit: "m"   },
  { key: "avg_speed_ms",   label: "Velocidade média",      unit: "m/s" },
  { key: "max_speed_ms",   label: "Velocidade máxima",     unit: "m/s" },
  { key: "attack_pct",     label: "% Ataque",              unit: "%",  scale: 100 },
  { key: "defense_pct",    label: "% Defesa",              unit: "%",  scale: 100 },
  { key: "sync_score",     label: "Sincronização",          unit: "%",  scale: 100 },
];

export default function PlayerDetailPage({ params }: { params: { id: string } }) {
  const playerId = parseInt(params.id, 10);
  const colour = PLAYER_COLOURS[(playerId - 1) % PLAYER_COLOURS.length];

  const [histories, setHistories] = useState<Record<string, ProgressionPoint[]>>({});

  useEffect(() => {
    METRICS.forEach(({ key, scale }) => {
      getProgression(playerId, key)
        .then((d) => {
          const pts = scale
            ? d.history.map((p) => ({ ...p, value: p.value * scale }))
            : d.history;
          setHistories((prev) => ({ ...prev, [key]: pts }));
        })
        .catch(() => setHistories((prev) => ({ ...prev, [key]: [] })));
    });
  }, [playerId]);

  const loaded = Object.keys(histories).length === METRICS.length;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <Link href="/players" className="text-gray-500 hover:text-gray-300 text-sm">
          ← Jogadores
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-white text-sm">Jogador {playerId}</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl"
          style={{ backgroundColor: colour }}
        >
          P{playerId}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Jogador {playerId}</h1>
          <p className="text-sm text-gray-400">Evolução entre sessões</p>
        </div>
      </div>

      {/* Metric charts */}
      {!loaded ? (
        <div className="text-gray-400 py-12 text-center">A carregar dados…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {METRICS.map(({ key, label, unit }) => (
            <div key={key} className="bg-gray-900 border border-gray-700 rounded-xl p-4">
              <div className="text-sm font-medium text-gray-300 mb-3">{label}</div>
              <ProgressionChart
                history={histories[key] ?? []}
                label={label}
                unit={unit}
                colour={colour}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
