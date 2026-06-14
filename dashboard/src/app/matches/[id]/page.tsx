"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  getStatus,
  getReport,
  frameUrl,
  trainingDataUrl,
  type MatchStatus,
  type AnalysisReport,
} from "@/lib/api";
import { CourtHeatmap } from "@/components/CourtHeatmap";
import { ShotBreakdown } from "@/components/ShotBreakdown";
import { FormationChart } from "@/components/FormationChart";
import { ScoreTimeline } from "@/components/ScoreTimeline";

const PLAYER_COLORS = ["#16a34a", "#2563eb", "#dc2626", "#d97706"];

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    queued:      { label: "Na fila",       className: "bg-gray-700 text-gray-300" },
    downloading: { label: "A descarregar", className: "bg-yellow-900/60 text-yellow-300" },
    uploading:   { label: "A enviar",      className: "bg-blue-900/60 text-blue-300" },
    analyzing:   { label: "A analisar",    className: "bg-purple-900/60 text-purple-300" },
    done:        { label: "Concluído",     className: "bg-green-900/60 text-green-300" },
    error:       { label: "Erro",          className: "bg-red-900/60 text-red-300" },
  };
  const { label, className } = config[status] ?? { label: status, className: "bg-gray-700 text-gray-300" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function progressMessage(status: string, progress: string | null | undefined): string {
  if (progress) return progress;
  const messages: Record<string, string> = {
    queued:      "Na fila…",
    downloading: "A descarregar vídeo…",
    uploading:   "A enviar para Gemini…",
    analyzing:   "Gemini a analisar…",
    done:        "Análise concluída!",
    error:       "Erro na análise.",
  };
  return messages[status] ?? status;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Inline RallyTimeline — horizontal strip where green = rally, gray = break
function RallyTimeline({
  rallies,
  duration_s,
}: {
  rallies: AnalysisReport["rallies"];
  duration_s: number;
}) {
  if (!rallies || rallies.length === 0 || duration_s <= 0) return null;

  const sorted = [...rallies].sort((a, b) => a.start_s - b.start_s);
  type Seg = { start: number; end: number; isRally: boolean };
  const segments: Seg[] = [];
  let cursor = 0;

  for (const r of sorted) {
    if (r.start_s > cursor) {
      segments.push({ start: cursor, end: r.start_s, isRally: false });
    }
    segments.push({ start: r.start_s, end: r.end_s, isRally: true });
    cursor = r.end_s;
  }
  if (cursor < duration_s) {
    segments.push({ start: cursor, end: duration_s, isRally: false });
  }

  return (
    <div className="flex w-full h-4 rounded overflow-hidden gap-px">
      {segments.map((seg, i) => {
        const widthPct = ((seg.end - seg.start) / duration_s) * 100;
        return (
          <div
            key={i}
            title={`${seg.isRally ? "Rally" : "Pausa"} ${seg.start.toFixed(1)}s–${seg.end.toFixed(1)}s`}
            className={seg.isRally ? "bg-green-500" : "bg-gray-700"}
            style={{ width: `${widthPct}%` }}
          />
        );
      })}
    </div>
  );
}

export default function MatchDetailPage({ params }: { params: { id: string } }) {
  const matchId = params.id;
  const [status, setStatus] = useState<MatchStatus | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await getStatus(matchId);
      setStatus(s);
      if (s.status === "done" && !report) {
        const r = await getReport(matchId);
        setReport(r);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [matchId, report]);

  useEffect(() => {
    refresh();
    const iv = setInterval(() => {
      if (status?.status && !["done", "error"].includes(status.status)) {
        refresh();
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [refresh, status?.status]);

  if (loading) {
    return <div className="text-gray-400 py-16 text-center">A carregar…</div>;
  }

  const isDone = status?.status === "done";
  const isError = status?.status === "error";
  const isProcessing = status?.status && !["done", "error"].includes(status.status);

  return (
    <div className="space-y-8">
      {/* Breadcrumb + status */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/matches" className="text-gray-500 hover:text-gray-300 text-sm">
          ← Jogos
        </Link>
        <span className="text-gray-700">/</span>
        <span className="font-mono text-sm text-gray-400">{matchId.slice(0, 8)}…</span>
        {status && <StatusBadge status={status.status} />}
      </div>

      {/* Processing state */}
      {isProcessing && (
        <div className="flex items-center gap-3 bg-blue-950/50 border border-blue-800 rounded-xl px-5 py-4">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-blue-300 text-sm">
            {progressMessage(status!.status, status!.progress)}
          </span>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="bg-red-950/50 border border-red-800 rounded-xl px-5 py-4 text-red-300 text-sm">
          {status?.error_message || "Erro desconhecido."}
        </div>
      )}

      {/* Report */}
      {isDone && report && (
        <>
          {/* Header */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 space-y-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">
                  {report.final_score.detail || "Resultado não disponível"}
                </h2>
                <p className="text-gray-400 text-sm">{report.match_summary}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-gray-500 mb-0.5">Confiança</div>
                  <div
                    className={`text-lg font-bold ${
                      report.confidence >= 0.7
                        ? "text-green-400"
                        : report.confidence >= 0.4
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {Math.round(report.confidence * 100)}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500 mb-0.5">Duração</div>
                  <div className="text-lg font-bold text-white">
                    {formatTime(report.duration_s)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Court Heatmap */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Mapa de posições</h3>
            <CourtHeatmap
              positions={report.player_positions}
              playerColors={PLAYER_COLORS}
            />
          </div>

          {/* Shot Breakdown */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Pancadas por jogador</h3>
            <ShotBreakdown shotCounts={report.shot_counts} />
          </div>

          {/* Formation + Score in grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Formações</h3>
              <FormationChart formationPct={report.formation_pct} />
            </div>
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Evolução da pontuação</h3>
              <ScoreTimeline timeline={report.score_timeline} />
            </div>
          </div>

          {/* Tempo de jogo / Rally section */}
          {report.rally_stats && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 space-y-4">
              <h3 className="text-lg font-semibold text-white">Tempo de jogo</h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Rallies</div>
                  <div className="text-2xl font-bold text-white">{report.rally_stats.total_rallies}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Duração média</div>
                  <div className="text-2xl font-bold text-white">{report.rally_stats.avg_duration_s.toFixed(1)}s</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Tempo em jogo</div>
                  <div className="text-2xl font-bold text-white">{report.rally_stats.total_play_time_s.toFixed(0)}s</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">% jogo activo</div>
                  <div className="text-2xl font-bold text-green-400">{report.rally_stats.play_time_pct.toFixed(1)}%</div>
                </div>
              </div>

              {/* Rally timeline strip */}
              {report.rallies && report.rallies.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-2">Linha do tempo — verde = rally, cinza = pausa</div>
                  <RallyTimeline rallies={report.rallies} duration_s={report.duration_s} />
                </div>
              )}
            </div>
          )}

          {/* Key Frames */}
          {report.key_frames.length > 0 && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Momentos-chave</h3>
              <div className="space-y-3">
                {report.key_frames.map((kf, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-4 p-3 bg-gray-800/50 rounded-lg"
                  >
                    <img
                      src={frameUrl(matchId, idx)}
                      alt={`Frame ${idx}`}
                      className="w-24 h-14 object-cover rounded-md flex-shrink-0 bg-gray-700"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-gray-500">
                          {formatTime(kf.time_s)}
                        </span>
                        {kf.all_players_visible && (
                          <span className="text-xs bg-green-900/60 text-green-300 px-1.5 py-0.5 rounded">
                            4 jogadores
                          </span>
                        )}
                        {kf.ball_visible && (
                          <span className="text-xs bg-blue-900/60 text-blue-300 px-1.5 py-0.5 rounded">
                            bola visível
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-300 truncate">{kf.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Training data download */}
          <div className="flex justify-end">
            <a
              href={trainingDataUrl(matchId)}
              download
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors border border-gray-600"
            >
              Descarregar dados de treino (YOLO)
            </a>
          </div>
        </>
      )}
    </div>
  );
}
