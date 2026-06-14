"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { listMatches, retryAnalysis, deleteMatch, type MatchStatus } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";

export default function MatchesPage() {
  const [matches, setMatches] = useState<MatchStatus[]>([]);

  const refresh = useCallback(() => {
    listMatches().then(setMatches).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Jogos analisados</h1>
          <p className="text-sm text-gray-500 mt-1">
            Histórico de análises.{" "}
            Para analisar um jogo novo usa{" "}
            <Link href="/" className="text-brand hover:underline">⚡ Analisar jogo</Link>.
          </p>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">🎾</div>
          <p>
            Ainda não há jogos analisados.{" "}
            <Link href="/" className="text-brand hover:underline">Analisa o teu primeiro jogo</Link>.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {matches.map((m) => (
            <Link
              key={m.match_id}
              href={m.status === "done" ? `/matches/${m.match_id}` : "#"}
              className="flex items-center justify-between bg-gray-900 border border-gray-700 hover:border-gray-500 rounded-xl px-5 py-4 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="text-sm font-mono text-gray-400">{m.match_id.slice(0, 8)}…</div>
                <StatusBadge status={m.status} />
              </div>
              {m.status === "done" && (
                <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
                  Ver análise →
                </span>
              )}
              {m.error_message && (
                <span className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-red-400 truncate max-w-xs">{m.error_message}</span>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      retryAnalysis(m.match_id).then(refresh).catch((err) => alert(String(err)));
                    }}
                    className="px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 rounded-lg text-xs font-medium whitespace-nowrap"
                  >
                    🔁 Reiniciar análise
                  </button>
                </span>
              )}
              {m.status !== "processing" && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    if (!confirm("Apagar este jogo? Remove o vídeo e os resultados.")) return;
                    deleteMatch(m.match_id).then(refresh).catch((err) => alert(String(err)));
                  }}
                  title="Apagar jogo"
                  className="ml-3 px-2 py-1 text-gray-600 hover:text-red-400 hover:bg-red-950/40 rounded-lg text-sm transition-colors"
                >
                  ✕
                </button>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
