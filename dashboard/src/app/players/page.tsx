"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { listPlayers, type PlayerSummary } from "@/lib/api";

const PLAYER_COLOURS = ["#16a34a", "#2563eb", "#dc2626", "#d97706"];

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPlayers()
      .then(setPlayers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400 py-16 text-center">A carregar…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Jogadores</h1>

      {players.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">🏃</div>
          <p>Sem dados de jogadores. Corre o pipeline com --analytics para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {players.map((p) => {
            const colour = PLAYER_COLOURS[(p.player_id - 1) % PLAYER_COLOURS.length];
            return (
              <Link
                key={p.player_id}
                href={`/players/${p.player_id}`}
                className="bg-gray-900 border border-gray-700 hover:border-gray-500 rounded-xl overflow-hidden transition-colors group"
              >
                <div className="p-4 flex items-center gap-3" style={{ borderLeft: `4px solid ${colour}` }}>
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                    style={{ backgroundColor: colour }}
                  >
                    P{p.player_id}
                  </div>
                  <div>
                    <div className="font-semibold text-white">Jogador {p.player_id}</div>
                    <div className="text-xs text-gray-400">
                      {p.match_count} jogo{p.match_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>

                {p.distance_m != null && (
                  <div className="grid grid-cols-2 divide-x divide-gray-700 border-t border-gray-700 text-center">
                    <div className="py-3">
                      <div className="text-base font-bold text-white">{p.distance_m.toFixed(0)} m</div>
                      <div className="text-xs text-gray-400">Distância</div>
                    </div>
                    <div className="py-3">
                      <div className="text-base font-bold text-white">
                        {(p.avg_speed_ms ?? 0).toFixed(1)} m/s
                      </div>
                      <div className="text-xs text-gray-400">Vel. média</div>
                    </div>
                  </div>
                )}

                <div className="px-4 pb-3 pt-2 text-right">
                  <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
                    Ver progressão →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
