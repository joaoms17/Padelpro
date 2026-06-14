"use client";

import { useEffect, useRef, useState } from "react";
import {
  getReportStatus,
  getReport,
  reportTrainingDataUrl,
  reportCondensedUrl,
  type MatchReport,
} from "@/lib/api";
import { ScoreCard } from "@/components/report/ScoreCard";
import { MatchHeatmap } from "@/components/report/MatchHeatmap";
import { ShotCountsTable } from "@/components/report/ShotCountsTable";
import { FormationDonut } from "@/components/report/FormationDonut";
import { RallyTimeline } from "@/components/report/RallyTimeline";
import { KeyFramesGallery } from "@/components/report/KeyFramesGallery";
import { ScoreTimeline } from "@/components/report/ScoreTimeline";
import { PlayerOutcomeCards } from "@/components/report/PlayerOutcomeCards";

type View =
  | { state: "loading" }
  | { state: "processing"; phase?: string }
  | { state: "error"; message: string }
  | { state: "done"; report: MatchReport };

const POLL_MS = 3000;

export default function Page({ params }: { params: { rid: string } }) {
  const { rid } = params;
  const [view, setView] = useState<View>({ state: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const status = await getReportStatus(rid);
        if (cancelled) return;

        if (status.status === "error") {
          setView({ state: "error", message: status.error || "O processamento falhou." });
          return;
        }
        if (status.status === "done") {
          try {
            const report = await getReport(rid);
            if (!cancelled) setView({ state: "done", report });
          } catch (e) {
            if (!cancelled) setView({ state: "error", message: String(e) });
          }
          return;
        }
        // still processing
        setView({ state: "processing", phase: status.phase });
        timer.current = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!cancelled) setView({ state: "error", message: String(e) });
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [rid]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl sm:text-4xl font-bold text-white">Relatório do jogo</h1>
        <p className="text-gray-400 max-w-2xl leading-relaxed">
          A leitura do Gemini sobre o vídeo todo — posições, resultado, pancadas e formações.
          Valida a precisão e usa estes dados para treinar o nosso próprio modelo.
        </p>
      </header>

      {view.state === "loading" && <Spinner text="A carregar o relatório…" />}

      {view.state === "processing" && (
        <Spinner text={view.phase || "O Gemini está a analisar o vídeo…"} sub="Isto pode demorar alguns minutos. A página atualiza sozinha." />
      )}

      {view.state === "error" && (
        <div className="card p-6 border border-red-500/50 bg-red-500/10">
          <h2 className="text-lg font-semibold text-red-300 mb-1">Ocorreu um erro</h2>
          <p className="text-sm text-red-200/80 break-words">{view.message}</p>
        </div>
      )}

      {view.state === "done" && <ReportBody report={view.report} rid={rid} />}
    </div>
  );
}

function Spinner({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="card p-10 flex flex-col items-center justify-center text-center gap-4">
      <div className="h-10 w-10 rounded-full border-2 border-gray-700 border-t-brand animate-spin" />
      <div className="space-y-1">
        <p className="text-gray-200 font-medium">{text}</p>
        {sub && <p className="text-sm text-gray-500">{sub}</p>}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold text-white mb-4">{children}</h2>;
}

function ReportBody({ report, rid }: { report: MatchReport; rid: string }) {
  return (
    <div className="space-y-6">
      {/* 1. Match summary */}
      {report.match_summary && (
        <section className="card p-5 border-l-2 border-brand/50 bg-brand/5">
          <p className="text-sm text-gray-300 leading-relaxed italic">{report.match_summary}</p>
          {report.confidence != null && (
            <div className="mt-2 text-xs text-gray-500">Confiança da IA: {Math.round(report.confidence * 100)}%</div>
          )}
        </section>
      )}

      {/* 2. Score + validation */}
      <ScoreCard report={report} />

      {/* 2b. Score timeline */}
      {(report.score_timeline?.length ?? 0) > 0 && (
        <section className="card p-6">
          <SectionTitle>Resultado jogo a jogo</SectionTitle>
          <ScoreTimeline report={report} />
        </section>
      )}

      {/* 3. Player outcome breakdown */}
      {(report.shots?.length ?? 0) > 0 && (
        <section className="card p-6">
          <SectionTitle>Qualidade por jogador</SectionTitle>
          <PlayerOutcomeCards report={report} />
        </section>
      )}

      {/* 4 + 5 — heatmap and shot counts side by side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="card p-6">
          <SectionTitle>Mapa de calor</SectionTitle>
          <MatchHeatmap report={report} />
        </section>

        <section className="card p-6">
          <SectionTitle>Pancadas por jogador</SectionTitle>
          <ShotCountsTable report={report} />
        </section>
      </div>

      {/* 5. Formations */}
      <section className="card p-6">
        <SectionTitle>Formações</SectionTitle>
        <FormationDonut report={report} />
      </section>

      {/* 6. Rally timeline */}
      <section className="card p-6">
        <SectionTitle>Pontos e tempo útil</SectionTitle>
        <RallyTimeline report={report} />
      </section>

      {/* 7. Key frames */}
      <section className="card p-6">
        <SectionTitle>Momentos-chave</SectionTitle>
        <KeyFramesGallery report={report} />
      </section>

      {/* 8. Footer CTAs */}
      <section className="card p-6">
        <div className="flex flex-wrap gap-3">
          <a className="btn-primary px-4 py-2" href={`/annotate/${rid}`}>
            ✋ Contribuir para treino
          </a>
          {report.condensed_available && (
            <a className="btn-ghost px-4 py-2" href={reportCondensedUrl(rid)} download>
              ✂️ Descarregar tempo útil
            </a>
          )}
          <a className="btn-ghost px-4 py-2" href="/modelo">
            📈 Evolução do modelo
          </a>
          <a className="btn-ghost px-4 py-2" href={reportTrainingDataUrl(rid)} download>
            ⬇️ Dados de treino (YOLO/CSV)
          </a>
        </div>
      </section>
    </div>
  );
}
