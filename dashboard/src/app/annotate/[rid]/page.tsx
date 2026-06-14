"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  getAnnotationData,
  getAnnotationFrame,
  submitAnnotations,
  type AnnotationData,
  type AnnotationSubmission,
} from "@/lib/api";
import { FrameStepper } from "@/components/annotate/FrameStepper";
import { BallMarker, type Ball } from "@/components/annotate/BallMarker";
import { ChecklistItem } from "@/components/annotate/ChecklistItem";

const OUTCOME_OPTS = [
  { v: "winner", l: "Winner" },
  { v: "unforced_error", l: "Erro não forçado" },
  { v: "forced_error", l: "Erro forçado" },
  { v: "let", l: "Let" },
  { v: "continuation", l: "Continuação" },
];

const STROKE_LABELS: Record<string, string> = {
  forehand_volley: "Vólei de direita",
  backhand_volley: "Vólei de esquerda",
  bandeja: "Bandeja",
  vibora: "Víbora",
  smash: "Smash",
  serve: "Serviço",
  other: "Outro",
};

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function strokeLabel(t: string): string {
  return STROKE_LABELS[t] ?? t;
}

// Per-frame annotation. `ball === undefined` means not yet decided,
// `null` means explicitly "no ball visible", an object means placed.
interface FrameAnn {
  ball?: Ball | null;
  outcome?: string;
  correctedPlayerId?: number;
}

// Natural dimensions of the frame image, kept per ts_ms for the submission
// payload (frame_w / frame_h come from getAnnotationFrame, not the rendered size).
type Dims = { w: number; h: number };

export default function AnnotatePage({ params }: { params: { rid: string } }) {
  const { rid } = params;

  const [data, setData] = useState<AnnotationData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  indexRef.current = index;
  const [anns, setAnns] = useState<Record<number, FrameAnn>>({});

  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const dimsRef = useRef<Record<number, Dims>>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<
    { balls: number; outcomes: number; player_ids: number } | null
  >(null);

  // ---- load shots ----
  useEffect(() => {
    getAnnotationData(rid).then(setData).catch((e) => setErr(String(e)));
  }, [rid]);

  const shot = data?.shots[index];

  // ---- fetch the frame image for the current shot, revoking the old URL ----
  useEffect(() => {
    if (!data || !shot) return;
    let url: string | null = null;
    let cancelled = false;

    setFrameSrc(null);
    setFrameError(false);
    setFrameLoading(true);

    getAnnotationFrame(rid, shot.ts_ms)
      .then(({ blob, width, height }) => {
        if (cancelled) return;
        dimsRef.current[index] = { w: width, h: height };
        url = URL.createObjectURL(blob);
        setFrameSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFrameError(true);
      })
      .finally(() => {
        if (!cancelled) setFrameLoading(false);
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [rid, data, shot, index]);

  // ---- per-frame mutators ----
  const setAnn = useCallback(
    <K extends keyof FrameAnn>(key: K, val: FrameAnn[K]) => {
      const i = indexRef.current;
      setAnns((prev) => ({ ...prev, [i]: { ...prev[i], [key]: val } }));
    },
    [],
  );

  const placeBall = useCallback((b: Ball) => setAnn("ball", b), [setAnn]);
  const markNoBall = useCallback(() => setAnn("ball", null), [setAnn]);
  const clearBall = useCallback(() => setAnn("ball", undefined), [setAnn]);
  const setOutcome = useCallback((v: string) => setAnn("outcome", v), [setAnn]);
  const setPlayer = useCallback(
    (p: number) => setAnn("correctedPlayerId", p),
    [setAnn],
  );

  const total = data?.shots.length ?? 0;
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setIndex((i) => Math.min(total - 1, i + 1)),
    [total],
  );
  const jump = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(total - 1, i))),
    [total],
  );

  // ---- "done" = every checklist step decided for this frame ----
  const isDone = useCallback(
    (i: number) => {
      const a = anns[i];
      return !!a && a.ball !== undefined && !!a.outcome;
    },
    [anns],
  );

  const doneFlags = useMemo(
    () => Array.from({ length: total }, (_, i) => isDone(i)),
    [total, isDone],
  );

  // ---- keyboard: ←/→ move, Enter confirm & advance ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "Enter") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goPrev, goNext]);

  // ---- accumulated totals across all frames ----
  const totals = useMemo(() => {
    if (!data) return { balls: 0, outcomes: 0, player_ids: 0 };
    let balls = 0;
    let outcomes = 0;
    let player_ids = 0;
    Object.entries(anns).forEach(([i, a]) => {
      const idx = Number(i);
      const s = data.shots[idx];
      if (!s) return;
      if (a.ball) balls += 1;
      if (a.outcome) outcomes += 1;
      if (
        a.correctedPlayerId !== undefined &&
        a.correctedPlayerId !== s.player_id
      )
        player_ids += 1;
    });
    return { balls, outcomes, player_ids };
  }, [anns, data]);

  const hasAnything =
    totals.balls > 0 || totals.outcomes > 0 || totals.player_ids > 0;

  // ---- submit everything in one call ----
  const handleSubmit = useCallback(async () => {
    if (!data) return;
    setSubmitting(true);
    setErr(null);
    try {
      const body: AnnotationSubmission = { balls: [], outcomes: [], player_ids: [] };
      Object.entries(anns).forEach(([i, a]) => {
        const idx = Number(i);
        const s = data.shots[idx];
        if (!s) return;
        if (a.ball) {
          const dims = dimsRef.current[idx] ?? { w: 0, h: 0 };
          body.balls.push({
            ts_ms: s.ts_ms,
            x_norm: a.ball.x_norm,
            y_norm: a.ball.y_norm,
            radius_norm: a.ball.radius_norm,
            frame_w: dims.w,
            frame_h: dims.h,
          });
        }
        if (a.outcome) {
          body.outcomes.push({
            ts_ms: s.ts_ms,
            player_id: a.correctedPlayerId ?? s.player_id,
            outcome: a.outcome,
          });
        }
        if (
          a.correctedPlayerId !== undefined &&
          a.correctedPlayerId !== s.player_id
        ) {
          body.player_ids.push({
            ts_ms: s.ts_ms,
            original_player_id: s.player_id,
            corrected_player_id: a.correctedPlayerId,
          });
        }
      });
      const result = await submitAnnotations(rid, body);
      setSubmitResult(result);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }, [anns, data, rid]);

  // ---- loading / error / empty states ----
  if (err && !data) {
    return (
      <div className="py-20 text-center space-y-3">
        <p className="text-red-400">Não foi possível carregar este ID.</p>
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-300"
        >
          ← Início
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-20 text-center text-gray-400">A carregar…</div>
    );
  }

  if (data.shots.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="card grid place-items-center p-12 text-center">
          <div className="max-w-md space-y-2">
            <p className="text-gray-200 font-semibold">Sem batidas para validar</p>
            <p className="text-sm text-gray-400">
              Esta análise não tem batidas detetadas, por isso não há nada para
              anotar aqui. Faz uma análise primeiro e volta para ajudar a treinar
              o modelo.
            </p>
            <Link
              href="/"
              className="btn-ghost mt-3 inline-block px-4 py-2 text-sm"
            >
              Analisar jogo
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const ann: FrameAnn = anns[index] ?? {};
  const currentShot = data.shots[index]!;
  const effectivePlayer = ann.correctedPlayerId ?? currentShot.player_id;
  const playerChanged =
    ann.correctedPlayerId !== undefined &&
    ann.correctedPlayerId !== currentShot.player_id;

  return (
    <div className="space-y-6">
      <Header />

      <FrameStepper
        index={index}
        total={total}
        doneFlags={doneFlags}
        onPrev={goPrev}
        onNext={goNext}
        onJump={jump}
      />

      {/* main per-frame panel: image large, checklist beside it */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Image */}
        <div className="space-y-3">
          <div className="relative">
            <BallMarker
              src={frameError ? null : frameSrc}
              ball={ann.ball}
              disabled={frameLoading || frameError || !frameSrc}
              onPlace={placeBall}
            />
            {frameLoading && (
              <div className="absolute inset-0 grid place-items-center rounded-2xl bg-navy-950/60">
                <span className="flex items-center gap-2 text-sm text-info">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  A extrair frame…
                </span>
              </div>
            )}
          </div>

          {/* ball controls under the image */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {ann.ball ? (
              <>
                <span className="tag-insight">bola marcada ✓</span>
                <button onClick={clearBall} className="btn-ghost px-3 py-1 text-xs">
                  Mover bola
                </button>
              </>
            ) : ann.ball === null ? (
              <>
                <span className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-400">
                  bola não visível
                </span>
                <button onClick={clearBall} className="btn-ghost px-3 py-1 text-xs">
                  Afinal marcar
                </button>
              </>
            ) : (
              <button
                onClick={markNoBall}
                disabled={frameLoading}
                className="btn-ghost px-3 py-1 text-xs disabled:opacity-40"
              >
                Bola não visível
              </button>
            )}
            <span className="ml-auto font-mono text-xs text-gray-500">
              {fmtTime(currentShot.ts_ms)}
            </span>
          </div>
        </div>

        {/* Checklist card */}
        <div className="card space-y-3 p-4 sm:p-5">
          <div>
            <h2 className="text-base font-bold text-gray-100">
              O que preciso nesta imagem
            </h2>
            <p className="text-xs text-gray-500">
              Valida os três pontos e avança com <kbd className="kbd">Enter</kbd>.
            </p>
          </div>

          {/* 1 — Bola */}
          <ChecklistItem
            step={1}
            title="Bola"
            done={ann.ball !== undefined}
            hint="Clica na bola na imagem, ou marca como não visível."
          >
            <p className="text-xs text-gray-400">
              {ann.ball
                ? "Bola marcada — clica novamente na imagem para ajustar."
                : ann.ball === null
                  ? "Sem bola visível neste frame."
                  : "À espera: clica na bola (ponto lima) na imagem."}
            </p>
          </ChecklistItem>

          {/* 2 — Jogadores */}
          <ChecklistItem
            step={2}
            title="Jogador que bateu"
            done
            hint={
              playerChanged
                ? `Corrigido de J${currentShot.player_id} para J${effectivePlayer}.`
                : `O modelo diz que foi o J${currentShot.player_id}. Confirma ou corrige.`
            }
          >
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4].map((p) => {
                const active = effectivePlayer === p;
                return (
                  <button
                    key={p}
                    onClick={() => setPlayer(p)}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                      active
                        ? "bg-info text-navy-950"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    J{p}
                  </button>
                );
              })}
            </div>
          </ChecklistItem>

          {/* 3 — Tipo de jogada / resultado */}
          <ChecklistItem
            step={3}
            title="Tipo de jogada e resultado"
            done={!!ann.outcome}
            hint={`Jogada detetada: ${strokeLabel(currentShot.stroke_type)}.`}
          >
            <div className="flex flex-wrap gap-2">
              {OUTCOME_OPTS.map((o) => {
                const active = ann.outcome === o.v;
                return (
                  <button
                    key={o.v}
                    onClick={() => setOutcome(o.v)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                      active
                        ? "bg-brand text-navy-950"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {o.l}
                  </button>
                );
              })}
            </div>
          </ChecklistItem>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={goPrev}
              disabled={index <= 0}
              className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
            >
              ← Anterior
            </button>
            <button
              onClick={goNext}
              disabled={index >= total - 1}
              className="btn-primary px-5 py-2 text-sm disabled:opacity-40"
            >
              Seguinte →
            </button>
          </div>
        </div>
      </div>

      {/* sticky footer: totals + save all */}
      <div className="sticky bottom-4 z-10">
        <div className="card flex flex-wrap items-center gap-4 p-4 sm:px-5">
          {submitResult ? (
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <span className="tag-insight">Guardado ✓</span>
              <span className="text-sm text-gray-300">
                {submitResult.balls} bolas · {submitResult.outcomes} resultados ·{" "}
                {submitResult.player_ids} IDs corrigidos. Obrigado por treinar o
                modelo!
              </span>
              <Link
                href="/modelo"
                className="btn-primary ml-auto px-4 py-2 text-sm"
              >
                Ver evolução do modelo →
              </Link>
            </div>
          ) : (
            <>
              <span className="text-sm text-gray-300">
                Bolas: <span className="font-bold text-accent">{totals.balls}</span>{" "}
                · Resultados:{" "}
                <span className="font-bold text-brand">{totals.outcomes}</span> ·
                IDs corrigidos:{" "}
                <span className="font-bold text-info">{totals.player_ids}</span>
              </span>
              {err && <span className="text-sm text-red-400">{err}</span>}
              <button
                onClick={handleSubmit}
                disabled={submitting || !hasAnything}
                className="btn-primary ml-auto px-6 py-2.5 text-sm"
              >
                {submitting ? "A guardar…" : "Guardar tudo"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-extrabold text-white sm:text-3xl">
        Contribuir para o treino
      </h1>
      <p className="max-w-3xl text-sm text-gray-400">
        Confirma o que se vê em cada imagem. Cada frame que validas ensina o
        nosso modelo. Marca a bola, confirma os jogadores e o tipo de jogada —
        tudo no mesmo ecrã.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>
          <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> mudar de frame
        </span>
        <span className="text-gray-700">·</span>
        <span>
          <kbd className="kbd">Enter</kbd> confirmar e avançar
        </span>
      </div>
    </div>
  );
}
