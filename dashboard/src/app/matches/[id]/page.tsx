"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getStatus, getPlayerStats, type MatchStatus, type PlayerStats } from "@/lib/api";
import { PlayerCard } from "@/components/PlayerCard";
import { StatusBadge } from "@/components/StatusBadge";

export default function MatchDetailPage({ params }: { params: { id: string } }) {
  const matchId = params.id;
  const [status,  setStatus]  = useState<MatchStatus | null>(null);
  const [stats,   setStats]   = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await getStatus(matchId);
      setStatus(s);
      if (s.status === "done") {
        const data = await getPlayerStats(matchId);
        setStats(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  if (loading) return <div className="text-gray-400 py-16 text-center">A carregar…</div>;

  const isProcessing = status?.status && !["done", "error"].includes(status.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/matches" className="text-gray-500 hover:text-gray-300 text-sm">← Jogos</Link>
        <span className="text-gray-700">/</span>
        <span className="font-mono text-sm text-gray-400">{matchId.slice(0, 8)}…</span>
        {status && <StatusBadge status={status.status} />}
      </div>

      {/* Processing state */}
      {isProcessing && (
        <div className="flex items-center gap-3 bg-blue-950/50 border border-blue-800 rounded-xl px-5 py-4">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-blue-300 text-sm">Pipeline a correr — actualiza automaticamente…</span>
        </div>
      )}

      {status?.error_message && (
        <div className="bg-red-950/50 border border-red-800 rounded-xl px-5 py-4 text-red-300 text-sm">
          {status.error_message}
        </div>
      )}

      {/* Player cards */}
      {stats.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Análise por jogador</h2>
            <div className="flex items-center gap-2">
              <Link
                href={`/review/${matchId}`}
                className="px-4 py-2 bg-green-800 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                ✓ Rever batidas
              </Link>
              <Link
                href={`/matches/${matchId}/clips`}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                📎 Clips
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((s) => (
              <PlayerCard key={s.player_id} matchId={matchId} stats={s} />
            ))}
          </div>

          {/* Sync score */}
          {stats[0] && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl px-5 py-4 flex items-center gap-4">
              <div>
                <div className="text-sm font-medium text-gray-300">Sincronização da dupla</div>
                <div className="text-xs text-gray-500">Correlação de velocidade entre os dois jogadores da mesma equipa</div>
              </div>
              <div className="ml-auto text-2xl font-bold text-white">
                {(stats[0].sync_score * 100).toFixed(0)}%
              </div>
            </div>
          )}
        </>
      )}

      {status?.status === "done" && stats.length === 0 && (
        <p className="text-gray-500 text-sm">
          Analytics não disponíveis. Corre o pipeline com --analytics para ver os dados.
        </p>
      )}
    </div>
  );
}
