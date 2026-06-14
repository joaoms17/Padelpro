"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listReports, type ReportHistoryEntry } from "@/lib/api";

function formatDuration(s?: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("pt-PT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    done: "bg-brand/10 text-brand border border-brand/30",
    processing: "bg-blue-500/10 text-blue-300 border border-blue-500/30",
    error: "bg-red-500/10 text-red-300 border border-red-500/30",
  };
  const labels: Record<string, string> = {
    done: "Concluído",
    processing: "A processar",
    error: "Erro",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${styles[status] ?? "bg-gray-800 text-gray-400"}`}>
      {labels[status] ?? status}
    </span>
  );
}

function MatchCard({ entry }: { entry: ReportHistoryEntry }) {
  const score = entry.final_score;
  return (
    <Link href={`/relatorio/${entry.rid}`} className="block card p-5 hover:border-brand/40 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={entry.status} />
            {entry.filename && (
              <span className="text-xs text-gray-500 truncate max-w-[180px]">{entry.filename}</span>
            )}
          </div>
          {score?.detail && (
            <div className="text-lg font-bold text-white tabular-nums">{score.detail}</div>
          )}
          {entry.match_summary && (
            <p className="text-sm text-gray-400 line-clamp-2">{entry.match_summary}</p>
          )}
        </div>
        <div className="flex-shrink-0 text-right space-y-1">
          {entry.duration_s != null && (
            <div className="text-sm font-medium text-gray-200">{formatDuration(entry.duration_s)}</div>
          )}
          {entry.confidence != null && (
            <div className="text-xs text-gray-500">{Math.round(entry.confidence * 100)}% conf.</div>
          )}
          <div className="text-xs text-gray-600">{formatDate(entry.updated_at)}</div>
        </div>
      </div>
    </Link>
  );
}

export default function HistoricoPage() {
  const [entries, setEntries] = useState<ReportHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listReports()
      .then(setEntries)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl sm:text-4xl font-bold text-white">Histórico de jogos</h1>
        <p className="text-gray-400">Todos os relatórios gerados nesta instância.</p>
      </header>

      {error && (
        <div className="card p-5 border border-red-500/50 bg-red-500/10 text-red-300 text-sm">{error}</div>
      )}

      {entries === null && !error && (
        <div className="card p-10 flex items-center justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-gray-700 border-t-brand animate-spin" />
        </div>
      )}

      {entries !== null && entries.length === 0 && (
        <div className="card p-10 text-center text-gray-500">
          Nenhum relatório ainda.{" "}
          <Link href="/" className="text-brand underline">Analisa um jogo</Link>.
        </div>
      )}

      {entries !== null && entries.length > 0 && (
        <div className="space-y-3">
          {entries.map((e) => <MatchCard key={e.rid} entry={e} />)}
        </div>
      )}
    </div>
  );
}
