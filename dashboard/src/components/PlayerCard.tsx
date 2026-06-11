"use client";

import { useEffect, useState } from "react";
import { HeatmapGrid } from "./HeatmapGrid";
import { ShotChart } from "./ShotChart";
import { ZoneRing } from "./ZoneRing";
import { getHeatmap, type PlayerStats } from "@/lib/api";

const PLAYER_COLOURS = ["#16a34a", "#2563eb", "#dc2626", "#d97706"];

export function PlayerCard({ matchId, stats }: { matchId: string; stats: PlayerStats }) {
  const [heatmap, setHeatmap] = useState<number[][] | null>(null);
  const [tab, setTab]         = useState<"heatmap" | "shots" | "zones">("heatmap");

  useEffect(() => {
    getHeatmap(matchId, stats.player_id)
      .then(setHeatmap)
      .catch(() => setHeatmap(null));
  }, [matchId, stats.player_id]);

  const colour = PLAYER_COLOURS[(stats.player_id - 1) % PLAYER_COLOURS.length];

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 flex items-center gap-3" style={{ borderLeft: `4px solid ${colour}` }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm"
             style={{ backgroundColor: colour }}>
          P{stats.player_id}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white">Jogador {stats.player_id}</div>
          <div className="text-xs text-gray-400">Sync: {(stats.sync_score * 100).toFixed(0)}%</div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 divide-x divide-gray-700 border-t border-gray-700 text-center">
        <Stat label="Distância" value={`${stats.distance_m.toFixed(0)} m`} />
        <Stat label="Vel. méd." value={`${stats.avg_speed_ms.toFixed(1)} m/s`} />
        <Stat label="Vel. máx." value={`${stats.max_speed_ms.toFixed(1)} m/s`} />
      </div>

      {/* Tab bar */}
      <div className="flex border-t border-gray-700 text-xs">
        {(["heatmap", "shots", "zones"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 capitalize transition-colors ${
              tab === t ? "bg-gray-800 text-white font-medium" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t === "heatmap" ? "Mapa" : t === "shots" ? "Pancadas" : "Zonas"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4 flex-1">
        {tab === "heatmap" && (
          heatmap ? <HeatmapGrid grid={heatmap} /> : <div className="text-gray-500 text-sm">A carregar…</div>
        )}
        {tab === "shots" && <ShotChart shots={stats.shots} />}
        {tab === "zones" && (
          <ZoneRing attack={stats.attack_pct} defense={stats.defense_pct} transition={stats.transition_pct} />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}
