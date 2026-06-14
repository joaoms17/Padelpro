"use client";

import type { TrainingTrack } from "@/lib/api";
import { LevelMeter } from "./LevelMeter";

/** Per-model progression card: level, samples, meter and (when applicable) a train button. */
export function TrackCard({
  track,
  onTrain,
  retrainState,
}: {
  track: TrainingTrack;
  onTrain?: () => void;
  retrainState?: { status: string; detail?: string };
}) {
  const trainable = track.key === "ball" || track.key === "player";
  const remaining =
    track.next_at != null ? Math.max(0, track.next_at - track.count) : null;

  return (
    <div className="card card-hover p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-200">{track.label}</h3>
          <p className="mt-0.5 text-sm text-gray-400">
            <span className="font-semibold text-gray-200 tabular-nums">
              {track.count.toLocaleString("pt-PT")}
            </span>{" "}
            amostras
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-bold text-brand">
          Nível {track.level}/{track.max_level}
        </span>
      </div>

      {/* Meter */}
      <LevelMeter
        count={track.count}
        thresholds={track.thresholds}
        level={track.level}
      />

      {/* Next-level hint */}
      <p className="text-xs text-gray-500">
        {remaining == null ? (
          <span className="text-brand-light font-semibold">nível máximo 🎉</span>
        ) : (
          <>
            faltam{" "}
            <span className="font-semibold text-gray-300 tabular-nums">
              {remaining.toLocaleString("pt-PT")}
            </span>{" "}
            para o nível {track.level + 1}
          </>
        )}
      </p>

      {/* Trained chip */}
      {track.model?.trained && (
        <span className="self-start inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/15 px-2.5 py-1 text-xs font-bold text-brand-light">
          Modelo treinado ✓
        </span>
      )}

      {/* Training controls */}
      <div className="mt-auto pt-1">
        {trainable ? (
          <TrainControls
            track={track}
            onTrain={onTrain}
            retrainState={retrainState}
          />
        ) : (
          <p className="text-xs text-gray-500">
            Treina-se a partir das correções em{" "}
            <span className="text-gray-400 font-medium">Rever</span>.
          </p>
        )}
      </div>
    </div>
  );
}

function TrainControls({
  track,
  onTrain,
  retrainState,
}: {
  track: TrainingTrack;
  onTrain?: () => void;
  retrainState?: { status: string; detail?: string };
}) {
  const status = retrainState?.status;
  const running = status === "running";

  if (running) {
    return (
      <div className="flex items-center gap-2 text-sm font-semibold text-brand-light">
        <Spinner />
        <span>A treinar…</span>
      </div>
    );
  }

  if (status === "ok") {
    return (
      <div className="flex items-center gap-2 text-sm font-semibold text-brand">
        <span>Treinado ✓</span>
        {retrainState?.detail && (
          <span className="text-xs font-normal text-gray-500">
            {retrainState.detail}
          </span>
        )}
      </div>
    );
  }

  if (status === "skipped" || status === "error") {
    return (
      <div className="space-y-2">
        <p
          className={`text-xs ${
            status === "error" ? "text-red-400" : "text-yellow-400"
          }`}
        >
          {retrainState?.detail ??
            (status === "error"
              ? "Falhou o treino. Tenta novamente."
              : "Treino ignorado.")}
        </p>
        <TrainButton track={track} onTrain={onTrain} />
      </div>
    );
  }

  // Idle.
  if (!track.can_train) {
    return (
      <p className="text-xs text-gray-500">
        Precisa de pelo menos{" "}
        <span className="font-semibold text-gray-400 tabular-nums">
          {track.min_to_train ?? "—"}
        </span>{" "}
        amostras
      </p>
    );
  }

  return <TrainButton track={track} onTrain={onTrain} />;
}

function TrainButton({
  track,
  onTrain,
}: {
  track: TrainingTrack;
  onTrain?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTrain}
      disabled={!track.can_train}
      className="btn-primary px-3.5 py-1.5 text-sm"
    >
      Treinar agora
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand/30 border-t-brand"
      aria-hidden
    />
  );
}
