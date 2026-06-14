"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getFleetQuality, type FleetQuality, type QualityReport } from "@/lib/api";

type Health = "good" | "warn" | "bad";

const HEALTH_STYLE: Record<Health, string> = {
  good: "text-green-400",
  warn: "text-yellow-400",
  bad: "text-red-400",
};

function rate(value: number | undefined, good: number, warn: number, invert = false): Health {
  if (value == null) return "warn";
  if (invert) {
    if (value <= good) return "good";
    if (value <= warn) return "warn";
    return "bad";
  }
  if (value >= good) return "good";
  if (value >= warn) return "warn";
  return "bad";
}

function fmtDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString("pt-PT", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function QualidadePage() {
  const [data, setData] = useState<FleetQuality | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFleetQuality().then(setData).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="py-16 text-center text-red-400">{error}</div>;
  if (!data) return <div className="py-16 text-center text-gray-400">A carregar…</div>;

  const s = data.summary;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Saúde da deteção e tracking</h1>
        <p className="text-sm text-gray-500 mt-1">
          Telemetria de deteção, tracking e calibração de todos os jogos processados
          ({data.n_matches}). É aqui que vês regressões do pipeline de visão — não só
          num clip de teste. (Os tipos de pancada vêm da IA, não são medidos aqui.)
        </p>
      </div>

      {data.n_matches === 0 ? (
        <div className="card p-10 text-center text-gray-500 space-y-2">
          <p>Ainda não há relatórios de qualidade.</p>
          <p className="text-sm">
            Cada jogo processado escreve um <code className="text-gray-400">quality_report.json</code> —
            <Link href="/" className="text-brand hover:underline"> analisa um jogo</Link> para começar.
          </p>
        </div>
      ) : (
        <>
          {/* Fleet summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <SummaryCard
              label="Frames c/ 4 jogadores"
              value={s["detection.pct_frames_with_expected_players"]}
              suffix="%"
              health={rate(s["detection.pct_frames_with_expected_players"], 80, 50)}
            />
            <SummaryCard
              label="Confiança da deteção"
              value={s["detection.mean_detection_confidence"]}
              health={rate(s["detection.mean_detection_confidence"], 0.7, 0.55)}
            />
            <SummaryCard
              label="Tracks por minuto"
              value={s["tracking.tracks_per_minute"]}
              health={rate(s["tracking.tracks_per_minute"], 6, 12, true)}
              hint="ideal ≈ 4 (1 por jogador); alto = IDs a partir"
            />
            <SummaryCard
              label="Velocidades impossíveis"
              value={s["physics.pct_implausible_speed"]}
              suffix="%"
              health={rate(s["physics.pct_implausible_speed"], 1, 5, true)}
              hint="> 8 m/s — erro de tracking/calibração"
            />
            <SummaryCard
              label="Impactos c/ som"
              value={s["strokes.pct_with_audio_onset"]}
              suffix="%"
              health={rate(s["strokes.pct_with_audio_onset"], 70, 40)}
              hint="cobertura de deteção de impactos por áudio — não é classificação de tipo (isso é da IA)"
            />
            <SummaryCard
              label="Fator tempo real"
              value={s["performance.realtime_factor"]}
              suffix="×"
              health={rate(s["performance.realtime_factor"], 1.5, 4, true)}
              hint="1× = processa à velocidade do vídeo"
            />
          </div>

          {/* Per-match table */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-3">Jogo</th>
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">4 jogadores</th>
                  <th className="px-4 py-3">Conf.</th>
                  <th className="px-4 py-3">Tracks/min</th>
                  <th className="px-4 py-3">Vel. imposs.</th>
                  <th className="px-4 py-3">Teleports</th>
                  <th className="px-4 py-3">Impactos</th>
                  <th className="px-4 py-3">c/ som</th>
                  <th className="px-4 py-3">Calibração</th>
                  <th className="px-4 py-3">Tempo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {data.reports.map((r) => <Row key={r.match_id + r.generated_at} r={r} />)}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-600">
            Verde = saudável · amarelo = a vigiar · vermelho = investigar. As métricas de
            física (velocidades, teleports) não precisam de anotações — são o canário das
            regressões de tracking e calibração.
          </p>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, suffix = "", health, hint }: {
  label: string;
  value: number | undefined;
  suffix?: string;
  health: Health;
  hint?: string;
}) {
  return (
    <div className="card p-4" title={hint}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${HEALTH_STYLE[health]}`}>
        {value != null ? `${value}${suffix}` : "—"}
      </div>
    </div>
  );
}

function Cell({ value, suffix = "", health }: { value: number | string | undefined; suffix?: string; health?: Health }) {
  return (
    <td className={`px-4 py-2.5 whitespace-nowrap ${health ? HEALTH_STYLE[health] : "text-gray-300"}`}>
      {value != null ? `${value}${suffix}` : "—"}
    </td>
  );
}

function Row({ r }: { r: QualityReport }) {
  const det = r.detection;
  const trk = r.tracking;
  const phy = r.physics;
  const str = r.strokes;
  const cal = r.homography_quality;
  return (
    <tr className="hover:bg-gray-800/30 transition-colors">
      <td className="px-4 py-2.5">
        <Link href={`/matches/${r.match_id}`} className="font-mono text-xs text-blue-400 hover:text-blue-300">
          {r.match_id.slice(0, 8)}…
        </Link>
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(r.generated_at)}</td>
      <Cell value={det?.pct_frames_with_expected_players} suffix="%"
            health={rate(det?.pct_frames_with_expected_players, 80, 50)} />
      <Cell value={det?.mean_detection_confidence}
            health={rate(det?.mean_detection_confidence, 0.7, 0.55)} />
      <Cell value={trk?.tracks_per_minute}
            health={rate(trk?.tracks_per_minute, 6, 12, true)} />
      <Cell value={phy?.pct_implausible_speed} suffix="%"
            health={phy ? rate(phy.pct_implausible_speed, 1, 5, true) : undefined} />
      <Cell value={phy?.teleport_count}
            health={phy ? rate(phy.teleport_count, 0, 5, true) : undefined} />
      <Cell value={str?.n_events} />
      <Cell value={str?.pct_with_audio_onset} suffix="%"
            health={str && str.n_events > 0 ? rate(str.pct_with_audio_onset, 70, 40) : undefined} />
      <td className="px-4 py-2.5">
        {cal ? (
          <span className={HEALTH_STYLE[cal.rating === "good" ? "good" : cal.rating === "ok" ? "warn" : "bad"]}>
            {cal.rating}
          </span>
        ) : <span className="text-gray-600">—</span>}
      </td>
      <Cell value={r.performance?.realtime_factor} suffix="×"
            health={rate(r.performance?.realtime_factor, 1.5, 4, true)} />
    </tr>
  );
}
