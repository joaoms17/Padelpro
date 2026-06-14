"use client";

import { useEffect, useState } from "react";
import type { MatchReport } from "@/lib/api";

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function confidenceColor(pct: number): string {
  if (pct >= 70) return "text-brand";
  if (pct >= 40) return "text-amber-400";
  return "text-red-400";
}

type ScoreOk = "yes" | "no" | null;

export function ScoreCard({ report }: { report: MatchReport }) {
  const { rid, final_score, confidence, duration_s, match_summary } = report;
  const confPct = Math.round((confidence ?? 0) * 100);
  const key = `padelpro_score_ok_${rid}`;
  const [scoreOk, setScoreOk] = useState<ScoreOk>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v === "yes" || v === "no") setScoreOk(v);
    } catch {
      // ignore
    }
  }, [key]);

  const choose = (v: "yes" | "no") => {
    setScoreOk(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // ignore
    }
  };

  return (
    <section className="card p-6 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        {/* Big score */}
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-gray-500">Resultado</div>
          <div className="text-4xl sm:text-5xl font-extrabold text-white leading-none">
            {final_score?.detail || "—"}
          </div>
          <div className="text-gray-400 text-sm">
            Sets{" "}
            <span className="text-gray-200 font-semibold tabular-nums">
              {final_score?.team1_sets ?? 0}–{final_score?.team2_sets ?? 0}
            </span>
          </div>
        </div>

        {/* Confidence */}
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-gray-500">Confiança</div>
          <div className={`text-3xl font-extrabold tabular-nums ${confidenceColor(confPct)}`}>
            {confPct}%
          </div>
        </div>

        {/* Duration */}
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-gray-500">Duração</div>
          <div className="text-3xl font-extrabold text-gray-200 tabular-nums">
            {formatTime(duration_s)}
          </div>
        </div>
      </div>

      {match_summary && (
        <p className="text-gray-400 leading-relaxed">{match_summary}</p>
      )}

      {/* Validation row */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 pt-5">
        <span className="text-sm text-gray-200 font-medium">O Gemini acertou no resultado?</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => choose("yes")}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-colors border ${
              scoreOk === "yes"
                ? "bg-brand text-navy-950 border-brand"
                : "bg-gray-800/80 hover:bg-gray-700 border-gray-700 text-gray-200"
            }`}
          >
            👍 Sim
          </button>
          <button
            type="button"
            onClick={() => choose("no")}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-colors border ${
              scoreOk === "no"
                ? "bg-red-500 text-white border-red-500"
                : "bg-gray-800/80 hover:bg-gray-700 border-gray-700 text-gray-200"
            }`}
          >
            👎 Não
          </button>
        </div>
        {scoreOk && (
          <span className="text-xs text-gray-500">
            {scoreOk === "yes" ? "Marcaste como correto." : "Marcaste como incorreto."}
          </span>
        )}
      </div>
    </section>
  );
}
