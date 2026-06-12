"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { listMatches, type MatchStatus } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { UploadForm } from "@/components/UploadForm";
import { CondenseForm } from "@/components/CondenseForm";

export default function MatchesPage() {
  const [matches, setMatches] = useState<MatchStatus[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [showCondense, setShowCondense] = useState(false);

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Jogos</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowCondense(!showCondense); setShowUpload(false); }}
            className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            {showCondense ? "Fechar" : "⚡ Analisar jogo"}
          </button>
          <button
            onClick={() => { setShowUpload(!showUpload); setShowCondense(false); }}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 rounded-lg text-sm font-medium transition-colors"
          >
            {showUpload ? "Fechar" : "Pipeline completo (lento)"}
          </button>
        </div>
      </div>

      {showCondense && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-2xl">
          <h2 className="text-lg font-semibold text-white mb-1">⚡ Analisar jogo</h2>
          <CondenseForm />
        </div>
      )}

      {showUpload && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md">
          <h2 className="text-lg font-semibold text-white mb-1">Pipeline completo</h2>
          <p className="text-xs text-yellow-400/80 mb-4">
            ⚠️ Processa o vídeo inteiro frame a frame (vídeo anotado incluído) — demora
            ~20 min para 4 min de vídeo. Para resultados rápidos usa “⚡ Analisar jogo”.
          </p>
          <UploadForm />
        </div>
      )}

      {matches.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">🎾</div>
          <p>Ainda não há jogos. Usa “⚡ Analisar jogo” para começar.</p>
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
                <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">Ver análise →</span>
              )}
              {m.error_message && (
                <span className="text-xs text-red-400 truncate max-w-xs">{m.error_message}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
