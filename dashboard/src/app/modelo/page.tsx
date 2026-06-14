"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTrainingStatus,
  getTrainingTest,
  triggerBallRetrain,
  triggerPlayerRetrain,
  getAnnotateRetrainStatus,
  type TrainingStatus,
  type TrainingTestResult,
} from "@/lib/api";
import { LevelMeter } from "@/components/training/LevelMeter";
import { TrackCard } from "@/components/training/TrackCard";

type RetrainState = { status: string; detail?: string };
type RetrainMap = Record<string, RetrainState>;

const TEST_CHIP: Record<
  TrainingTestResult["status"],
  { label: string; className: string }
> = {
  ready: {
    label: "Pronto a testar",
    className: "bg-brand/15 text-brand border border-brand/30",
  },
  trainable: {
    label: "Pronto a treinar",
    className: "bg-yellow-400/10 text-yellow-300 border border-yellow-400/30",
  },
  collecting: {
    label: "A recolher dados",
    className: "bg-gray-800 text-gray-400 border border-gray-700",
  },
};

export default function ModeloPage() {
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [test, setTest] = useState<TrainingTestResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrain, setRetrain] = useState<RetrainMap>({});

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getTrainingStatus(), getTrainingTest()])
      .then(([s, t]) => {
        if (!alive) return;
        setStatus(s);
        setTest(t.results);
      })
      .catch(() => {
        if (alive) {
          setError(
            "Não foi possível contactar o servidor de treino. Verifica a ligação e tenta novamente.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll retrain status every 3s while anything is running.
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await getAnnotateRetrainStatus();
        let anyRunning = false;
        setRetrain((prev) => {
          const next: RetrainMap = { ...prev };
          for (const key of Object.keys(s)) {
            next[key] = { status: s[key].status, detail: s[key].detail };
            if (s[key].status === "running") anyRunning = true;
          }
          return next;
        });
        if (!anyRunning) {
          stopPolling();
          // Refresh progress so newly trained models / levels show up.
          getTrainingStatus().then(setStatus).catch(() => undefined);
          getTrainingTest()
            .then((t) => setTest(t.results))
            .catch(() => undefined);
        }
      } catch {
        // Transient failure — keep polling.
      }
    }, 3000);
  }, [stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const handleTrain = useCallback(
    async (key: "ball" | "player") => {
      setRetrain((prev) => ({ ...prev, [key]: { status: "running" } }));
      try {
        if (key === "ball") await triggerBallRetrain();
        else await triggerPlayerRetrain();
      } catch (e) {
        // 409 = already running — just keep polling for its status.
        const msg = String(e);
        if (!/409/.test(msg)) {
          setRetrain((prev) => ({
            ...prev,
            [key]: { status: "error", detail: "Não foi possível iniciar o treino." },
          }));
          return;
        }
      }
      startPolling();
    },
    [startPolling],
  );

  if (error) {
    return (
      <div className="card p-10 text-center text-red-400">{error}</div>
    );
  }

  if (!status || !test) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-400">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
        <span className="text-sm">A carregar o teu progresso…</span>
      </div>
    );
  }

  const remaining =
    status.overall_next_at != null
      ? Math.max(0, status.overall_next_at - status.overall_count)
      : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-white">O teu modelo</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-400">
          Cada jogo que analisas e cada frame que confirmas gera dados para treinar o
          NOSSO modelo — para deixarmos de depender do Gemini. Aqui vês o teu progresso
          por níveis e podes treinar e testar o teu modelo.
        </p>
      </header>

      {/* Overall progress */}
      <section className="card p-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Progresso global
            </div>
            <div className="mt-1 text-4xl font-extrabold text-white">
              Nível{" "}
              <span className="text-brand">{status.overall_level}</span>{" "}
              <span className="text-gray-500">/ {status.max_level}</span>
            </div>
          </div>
          <div className="flex gap-6">
            <Stat label="Imagens" value={status.total_images} />
            <Stat label="Frames de jogo" value={status.match_frames} />
          </div>
        </div>

        <LevelMeter
          count={status.overall_count}
          thresholds={status.thresholds}
          level={status.overall_level}
        />

        <p className="text-sm text-gray-400">
          <span className="font-semibold text-gray-200 tabular-nums">
            {status.overall_count.toLocaleString("pt-PT")}
          </span>{" "}
          amostras ·{" "}
          {remaining == null ? (
            <span className="font-semibold text-brand-light">
              nível máximo atingido 🎉
            </span>
          ) : (
            <>
              faltam{" "}
              <span className="font-semibold text-gray-300 tabular-nums">
                {remaining.toLocaleString("pt-PT")}
              </span>{" "}
              para o nível seguinte
            </>
          )}
        </p>
      </section>

      {/* Per-track cards */}
      <section>
        <h2 className="mb-3 text-lg font-bold text-gray-200">Modelos por tarefa</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {status.tracks.map((track) => (
            <TrackCard
              key={track.key}
              track={track}
              retrainState={retrain[track.key]}
              onTrain={
                track.key === "ball" || track.key === "player"
                  ? () => handleTrain(track.key as "ball" | "player")
                  : undefined
              }
            />
          ))}
        </div>
      </section>

      {/* Test section */}
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-200">
            Testar o nosso modelo
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Estado de cada modelo: se já dá para testar contra o Gemini, se está pronto
            a treinar, ou se ainda anda a recolher dados.
          </p>
        </div>

        <div className="divide-y divide-gray-800/70">
          {test.map((r) => {
            const chip = TEST_CHIP[r.status];
            return (
              <div
                key={r.key}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-gray-200">{r.label}</div>
                  <div className="text-sm text-gray-500">{r.message}</div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${chip.className}`}
                >
                  {chip.label}
                </span>
              </div>
            );
          })}
        </div>

        <p className="rounded-2xl border border-gray-800 bg-navy-900/60 p-3 text-xs text-gray-500">
          Nota: a comparação real de inferência contra o Gemini exige um checkpoint
          treinado (e GPU). Enquanto não houver pesos treinados, não inventamos números —
          mostramos apenas o que já foi recolhido e o que falta.
        </p>
      </section>

      {/* Footer CTAs */}
      <div className="flex flex-wrap gap-3">
        <a className="btn-primary px-4 py-2" href="/">
          ⚡ Analisar um jogo
        </a>
        <a className="btn-ghost px-4 py-2" href="/ajuda">
          Como funciona
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-right">
      <div className="text-xl font-bold text-gray-200 tabular-nums">
        {value.toLocaleString("pt-PT")}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
