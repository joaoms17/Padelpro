"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { listMatches, type MatchStatus } from "@/lib/api";

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    queued:     { label: "Na fila",       className: "bg-gray-700 text-gray-300" },
    downloading:{ label: "A descarregar", className: "bg-yellow-900/60 text-yellow-300" },
    uploading:  { label: "A enviar",      className: "bg-blue-900/60 text-blue-300" },
    analyzing:  { label: "A analisar",    className: "bg-purple-900/60 text-purple-300" },
    done:       { label: "Concluído",     className: "bg-green-900/60 text-green-300" },
    error:      { label: "Erro",          className: "bg-red-900/60 text-red-300" },
  };
  const { label, className } = config[status] ?? { label: status, className: "bg-gray-700 text-gray-300" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Jogos</h1>
        <Link
          href="/"
          className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Analisar novo jogo
        </Link>
      </div>

      {matches.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">🎾</div>
          <p>Ainda não há jogos.</p>
          <Link href="/" className="text-brand hover:underline text-sm mt-2 inline-block">
            Analisar primeiro jogo
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {matches.map((m) => (
            <Link
              key={m.match_id}
              href={m.status === "done" ? `/matches/${m.match_id}` : "#"}
              className={`flex items-center justify-between bg-gray-900 border border-gray-700 rounded-xl px-5 py-4 transition-colors group ${
                m.status === "done" ? "hover:border-gray-500 cursor-pointer" : "cursor-default"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="text-sm font-mono text-gray-400">
                  {m.match_id.slice(0, 8)}…
                </div>
                <StatusBadge status={m.status} />
                {m.progress && (
                  <span className="text-xs text-gray-500">{m.progress}</span>
                )}
              </div>
              {m.status === "done" ? (
                <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
                  Ver análise →
                </span>
              ) : null}
              {m.error_message && (
                <span className="text-xs text-red-400 truncate max-w-xs">
                  {m.error_message}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
