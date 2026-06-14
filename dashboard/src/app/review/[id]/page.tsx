"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  getReviewData,
  submitReview,
  reviewVideoUrl,
  type ReviewData,
  type ReviewItem,
  type Correction,
} from "@/lib/api";
import { GeminiInsights } from "@/components/GeminiInsights";

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

type Verdict = Correction["verdict"];

interface RowState {
  verdict: Verdict | null;
  correctedType: string;
  outcome: string;
  correctedPlayerId: number | null;
}

export default function ReviewPage({ params }: { params: { id: string } }) {
  const rid = params.id;
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [missed, setMissed] = useState<Correction[]>([]);
  const [missedPlayer, setMissedPlayer] = useState(1);
  const [missedType, setMissedType] = useState("smash");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ saved: number } | null>(null);
  const [selected, setSelected] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    getReviewData(rid)
      .then((d) => {
        setData(d);
        setRows(d.items.map((item) => ({
          verdict: null,
          correctedType: d.stroke_classes.find((c) => c !== item.stroke_type) ?? "smash",
          outcome: "",
          correctedPlayerId: null,
        })));
      })
      .catch((e) => setError(String(e)));
  }, [rid]);

  const seekTo = useCallback((ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, ms / 1000 - 1.2);
    v.play().catch(() => {});
    // play ~2.5s around the stroke, then pause
    const stopAt = ms / 1000 + 1.3;
    const onTime = () => {
      if (v.currentTime >= stopAt) {
        v.pause();
        v.removeEventListener("timeupdate", onTime);
      }
    };
    v.addEventListener("timeupdate", onTime);
  }, []);

  const setVerdict = (i: number, verdict: Verdict) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, verdict: row.verdict === verdict ? null : verdict } : row)));

  // Keyboard-first validation: navigate with j/k or arrows, judge with 1/2/3,
  // replay with space. Verdicts auto-advance to keep the reviewer in flow.
  useEffect(() => {
    if (!data) return;
    const items = data.items;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (items.length === 0) return;

      const select = (i: number) => {
        const clamped = Math.max(0, Math.min(items.length - 1, i));
        setSelected(clamped);
        seekTo(items[clamped].ts_ms);
      };
      const judge = (v: Verdict) => {
        setVerdict(selected, v);
        if (v !== "wrong_class" && selected < items.length - 1) select(selected + 1);
      };

      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); select(selected + 1); break;
        case "k": case "ArrowUp":   e.preventDefault(); select(selected - 1); break;
        case " ": case "Enter":     e.preventDefault(); seekTo(items[selected].ts_ms); break;
        case "1": case "c": judge("correct"); break;
        case "2": case "w": judge("wrong_class"); break;
        case "3": case "x": judge("not_a_shot"); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [data, selected, seekTo]);

  const setCorrectedType = (i: number, t: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, correctedType: t } : row)));

  const setOutcome = (i: number, v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, outcome: v } : row)));

  const setCorrectPlayer = (i: number, p: number, originalId: number) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, correctedPlayerId: p === originalId ? null : p } : row)));

  const addMissed = () => {
    const v = videoRef.current;
    if (!v) return;
    setMissed((m) => [
      ...m,
      {
        ts_ms: v.currentTime * 1000,
        player_id: missedPlayer,
        verdict: "missed",
        corrected_type: missedType,
      },
    ]);
  };

  const reviewed = rows.filter((r) => r.verdict !== null).length;

  const handleSubmit = async () => {
    if (!data) return;
    setSubmitting(true);
    setError(null);
    try {
      const corrections: Correction[] = data.items
        .map((item, i) => ({ item, row: rows[i] }))
        .filter(({ row }) => row.verdict !== null)
        .map(({ item, row }) => ({
          ts_ms: item.ts_ms,
          player_id: item.player_id,
          verdict: row.verdict as Verdict,
          predicted_type: item.stroke_type,
          corrected_type: row.verdict === "wrong_class" ? row.correctedType : null,
          frame_idx: item.frame_idx,
        }));
      const res = await submitReview(rid, [...corrections, ...missed]);
      setSubmitted({ saved: res.saved });
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !data) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-red-400">Sem análise para rever neste ID.</p>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-300">← Voltar</Link>
      </div>
    );
  }
  if (!data) return <div className="text-gray-400 py-16 text-center">A carregar…</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Início</Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-lg font-bold text-white">Rever batidas</h1>
        <span className="text-xs text-gray-500">
          {reviewed + missed.length}/{data.items.length} revistas · corrige análise Gemini
        </span>
        <Link href={`/annotate/${rid}`} className="ml-auto text-xs text-blue-400 hover:text-blue-300 border border-blue-800 rounded-lg px-3 py-1">
          🎯 Anotar bola e resultados
        </Link>
      </div>

      <p className="text-sm text-gray-400">
        Clica numa batida para a ver no vídeo. Marca <span className="text-green-400">✓ certa</span>,{" "}
        <span className="text-yellow-400">✎ tipo errado</span> (e escolhe o tipo certo) ou{" "}
        <span className="text-red-400">✗ não foi batida</span>. As correções validam e melhoram a análise Gemini.
      </p>
      <p className="text-xs text-gray-600">
        Teclado: <kbd className="px-1 bg-gray-800 rounded">j</kbd>/<kbd className="px-1 bg-gray-800 rounded">k</kbd> navegar ·{" "}
        <kbd className="px-1 bg-gray-800 rounded">espaço</kbd> repetir ·{" "}
        <kbd className="px-1 bg-gray-800 rounded">1</kbd> certa ·{" "}
        <kbd className="px-1 bg-gray-800 rounded">2</kbd> tipo errado ·{" "}
        <kbd className="px-1 bg-gray-800 rounded">3</kbd> não foi batida — avança sozinho.
      </p>

      {data.gemini && (
        <GeminiInsights
          gemini={data.gemini}
          shots={data.items.map((it) => ({ type: it.stroke_type, outcome: it.outcome ?? undefined }))}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Video */}
        <div className="space-y-3">
          {data.video_available ? (
            <video
              ref={videoRef}
              src={reviewVideoUrl(rid)}
              controls
              className="w-full rounded-xl border border-gray-700 bg-black sticky top-4"
            />
          ) : (
            <div className="rounded-xl border border-gray-700 bg-gray-900 p-8 text-center text-sm text-gray-500">
              Vídeo já não está disponível — revisão às cegas pelos timestamps.
            </div>
          )}

          {/* Missed-stroke capture */}
          {data.video_available && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 space-y-2">
              <div className="text-sm font-medium text-gray-300">Batida não detetada?</div>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="text-gray-500">Pausa o vídeo no impacto, depois:</span>
                <select
                  value={missedPlayer}
                  onChange={(e) => setMissedPlayer(Number(e.target.value))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-gray-200"
                >
                  {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Jogador {p}</option>)}
                </select>
                <select
                  value={missedType}
                  onChange={(e) => setMissedType(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-gray-200"
                >
                  {data.stroke_classes.map((c) => (
                    <option key={c} value={c}>{STROKE_LABELS[c] ?? c}</option>
                  ))}
                </select>
                <button
                  onClick={addMissed}
                  className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm"
                >
                  + Adicionar aqui
                </button>
              </div>
              {missed.length > 0 && (
                <ul className="text-xs text-gray-400 space-y-1">
                  {missed.map((m, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span>
                        {fmtTime(m.ts_ms)} — Jogador {m.player_id} — {STROKE_LABELS[m.corrected_type ?? ""] ?? m.corrected_type}
                      </span>
                      <button
                        onClick={() => setMissed((mm) => mm.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-300"
                      >
                        remover
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Stroke list */}
        <div className="space-y-2 max-h-[75vh] overflow-y-auto pr-1">
          {data.items.length === 0 && (
            <p className="text-gray-500 text-sm">Nenhuma batida detetada nesta análise.</p>
          )}
          {data.items.map((item, i) => (
            <StrokeRow
              key={`${item.player_id}-${item.ts_ms}`}
              item={item}
              row={rows[i]}
              isSelected={i === selected}
              strokeClasses={data.stroke_classes}
              outcome={rows[i]?.outcome ?? ""}
              correctedPlayerId={rows[i]?.correctedPlayerId ?? null}
              originalPlayerId={item.player_id}
              onSeek={() => { setSelected(i); seekTo(item.ts_ms); }}
              onVerdict={(v) => setVerdict(i, v)}
              onType={(t) => setCorrectedType(i, t)}
              onOutcome={(v) => setOutcome(i, v)}
              onPlayer={(p) => setCorrectPlayer(i, p, item.player_id)}
            />
          ))}
        </div>
      </div>

      {/* Submit + retrain */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl px-5 py-4 flex items-center gap-4 flex-wrap">
        <button
          onClick={handleSubmit}
          disabled={submitting || (reviewed === 0 && missed.length === 0)}
          className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium"
        >
          {submitting ? "A submeter…" : `Submeter ${reviewed + missed.length} correções`}
        </button>

        {submitted && (
          <span className="text-sm text-green-400">
            ✓ {submitted.saved} correções guardadas
          </span>
        )}

        {submitted && (
          <Link
            href={`/annotate/${rid}`}
            className="px-4 py-2 bg-blue-800 hover:bg-blue-700 text-white rounded-lg text-sm font-medium ml-auto"
          >
            🎯 Anotar bola e resultados
          </Link>
        )}

        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  );
}

function StrokeRow({
  item,
  row,
  isSelected,
  strokeClasses,
  outcome,
  correctedPlayerId,
  originalPlayerId,
  onSeek,
  onVerdict,
  onType,
  onOutcome,
  onPlayer,
}: {
  item: ReviewItem;
  row: RowState;
  isSelected: boolean;
  strokeClasses: string[];
  outcome: string;
  correctedPlayerId: number | null;
  originalPlayerId: number;
  onSeek: () => void;
  onVerdict: (v: Verdict) => void;
  onType: (t: string) => void;
  onOutcome: (v: string) => void;
  onPlayer: (p: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isSelected]);
  const verdictBtn = (v: Verdict, label: string, active: string, idle: string) => (
    <button
      onClick={(e) => { e.stopPropagation(); onVerdict(v); }}
      className={`px-2.5 py-1 rounded-lg text-sm font-medium transition-colors ${row.verdict === v ? active : idle}`}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      onClick={onSeek}
      className={`bg-gray-900 border rounded-xl px-4 py-3 cursor-pointer ${
        isSelected ? "border-blue-500" : row.verdict ? "border-gray-500" : "border-gray-700"
      }`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onSeek} className="font-mono text-sm text-blue-400 hover:text-blue-300">
          ▶ {fmtTime(item.ts_ms)}
        </button>
        <span className="text-sm text-gray-300">Jogador {item.player_id}</span>
        <span className="text-sm font-medium text-white">
          {STROKE_LABELS[item.stroke_type] ?? item.stroke_type}
        </span>
        {item.confidence != null && (
          <span className={`text-xs ${item.confidence < 0.6 ? "text-yellow-400" : "text-gray-500"}`}>
            {(item.confidence * 100).toFixed(0)}%
          </span>
        )}
        {item.audio_onset === true && <span title="Confirmada por áudio" className="text-xs">🔊</span>}
        {item.audio_onset === false && <span title="Sem som de impacto" className="text-xs opacity-40">🔇</span>}

        <div className="ml-auto flex items-center gap-1.5">
          {verdictBtn("correct", "✓", "bg-green-700 text-white", "bg-gray-800 text-green-400 hover:bg-gray-700")}
          {verdictBtn("wrong_class", "✎", "bg-yellow-600 text-white", "bg-gray-800 text-yellow-400 hover:bg-gray-700")}
          {verdictBtn("not_a_shot", "✗", "bg-red-700 text-white", "bg-gray-800 text-red-400 hover:bg-gray-700")}
        </div>
        <div className="flex items-center gap-1.5 ml-1" onClick={(e) => e.stopPropagation()}>
          <select
            value={outcome}
            onChange={(e) => onOutcome(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-400 max-w-[110px]"
          >
            <option value="">resultado?</option>
            <option value="winner">Winner</option>
            <option value="unforced_error">Erro n.f.</option>
            <option value="forced_error">Erro f.</option>
            <option value="let">Let</option>
            <option value="continuation">Continua</option>
          </select>
          <select
            value={correctedPlayerId ?? originalPlayerId}
            onChange={(e) => onPlayer(Number(e.target.value))}
            className={`bg-gray-800 border rounded px-1.5 py-0.5 text-xs max-w-[50px] ${correctedPlayerId !== null ? "border-yellow-600 text-yellow-300" : "border-gray-700 text-gray-500"}`}
          >
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>J{p}</option>)}
          </select>
        </div>
      </div>

      {row.verdict === "wrong_class" && (
        <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-gray-500">Tipo certo:</span>
          <select
            value={row.correctedType}
            onChange={(e) => onType(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-gray-200"
          >
            {strokeClasses
              .filter((c) => c !== item.stroke_type)
              .map((c) => (
                <option key={c} value={c}>{STROKE_LABELS[c] ?? c}</option>
              ))}
          </select>
        </div>
      )}
    </div>
  );
}
